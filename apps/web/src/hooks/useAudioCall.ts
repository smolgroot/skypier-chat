import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AudioCallChunk, AudioCallEndReason, AudioCallMediaProfile, AudioCallPhase, AudioCallSignal } from '@skypier/protocol';
import { useCallEarcons } from './useCallEarcons';

const DEFAULT_MEDIA_PROFILE: AudioCallMediaProfile = {
  codec: 'opus',
  sampleRateHz: 48_000,
  channels: 1,
  ptimeMs: 20,
};

export interface ActiveAudioCall {
  callId: string;
  conversationId: string;
  remotePeerId: string;
  remoteDisplayName: string;
  direction: 'incoming' | 'outgoing';
  phase: Exclude<AudioCallPhase, 'idle'>;
  isMuted: boolean;
  remoteMuted: boolean;
  startedAt?: string;
  error?: string;
  endedReason?: AudioCallEndReason;
  mediaProfile: AudioCallMediaProfile;
}

interface HandleIncomingSignalOptions {
  fromPeerId: string;
  remoteDisplayName: string;
  signal: AudioCallSignal;
}

interface StartAudioCallOptions {
  conversationId: string;
  remotePeerId: string;
  remoteDisplayName: string;
}

interface UseAudioCallOptions {
  localPeerId?: string;
  isSessionReady: boolean;
  dialPeerById: (peerId: string) => Promise<string>;
  sendAudioCallSignal: (signal: AudioCallSignal, targetPeerId: string) => Promise<boolean>;
  sendAudioCallChunk: (chunk: AudioCallChunk, targetPeerId: string) => Promise<boolean>;
}

interface PlaybackPipeline {
  callId: string;
  mimeType: string;
  audio: HTMLAudioElement;
  mediaSource: MediaSource;
  sourceBuffer?: SourceBuffer;
  objectUrl: string;
  queue: Uint8Array[];
  queueBytes: number;
  expectedSequence: number;
  pendingBySequence: Map<number, Uint8Array>;
  ended: boolean;
}

const MAX_PLAYBACK_QUEUE_BYTES = 3 * 1024 * 1024; // 3 MB buffered inbound audio
const MAX_PENDING_AUDIO_CHUNKS = 64;

const PREFERRED_RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
] as const;

function chooseRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }

  return PREFERRED_RECORDER_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const slice = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createCallId(): string {
  return `call-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export function useAudioCall(options: UseAudioCallOptions) {
  const { localPeerId, isSessionReady, dialPeerById, sendAudioCallSignal, sendAudioCallChunk } = options;
  const [call, setCall] = useState<ActiveAudioCall | null>(null);
  const activeCallRef = useRef<ActiveAudioCall | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const playbackPipelineRef = useRef<PlaybackPipeline | null>(null);
  const outboundSequenceRef = useRef(0);
  const outboundEnabledRef = useRef(false);
  // Set to true by finalizeCall/endCall so a slow dialPeerById cannot revive the call.
  const startCallAbortRef = useRef(false);
  const { playEarcon, stopLooping } = useCallEarcons();

  useEffect(() => {
    activeCallRef.current = call;
  }, [call]);

  const flushPlaybackQueue = useCallback(() => {
    const pipeline = playbackPipelineRef.current;
    if (!pipeline?.sourceBuffer || pipeline.sourceBuffer.updating) {
      return;
    }

    const nextChunk = pipeline.queue.shift();
    if (nextChunk) {
      pipeline.queueBytes = Math.max(0, pipeline.queueBytes - nextChunk.byteLength);
      try {
        pipeline.sourceBuffer.appendBuffer(Uint8Array.from(nextChunk));
      } catch (error) {
        console.warn('[skypier:audio] Failed to append inbound audio chunk; dropping chunk.', error);
        queueMicrotask(() => {
          flushPlaybackQueue();
        });
      }
      return;
    }

    if (pipeline.ended && pipeline.mediaSource.readyState === 'open') {
      try {
        pipeline.mediaSource.endOfStream();
      } catch {
        // MediaSource can throw if already ended or not open.
      }
    }
  }, []);

  const cleanupPlayback = useCallback(() => {
    const pipeline = playbackPipelineRef.current;
    if (!pipeline) {
      return;
    }

    pipeline.queue.length = 0;
    pipeline.queueBytes = 0;
    pipeline.pendingBySequence.clear();
    pipeline.audio.pause();
    pipeline.audio.src = '';
    URL.revokeObjectURL(pipeline.objectUrl);
    playbackPipelineRef.current = null;
  }, []);

  const drainPendingIntoPlaybackQueue = useCallback((pipeline: PlaybackPipeline, force = false) => {
    while (true) {
      const next = pipeline.pendingBySequence.get(pipeline.expectedSequence);
      if (!next) {
        break;
      }

      pipeline.pendingBySequence.delete(pipeline.expectedSequence);
      pipeline.expectedSequence += 1;
      pipeline.queue.push(next);
      pipeline.queueBytes += next.byteLength;
    }

    if (!force) {
      return;
    }

    const remainingSequences = Array.from(pipeline.pendingBySequence.keys()).sort((a, b) => a - b);
    for (const sequence of remainingSequences) {
      const chunk = pipeline.pendingBySequence.get(sequence);
      if (!chunk) {
        continue;
      }
      pipeline.pendingBySequence.delete(sequence);
      pipeline.queue.push(chunk);
      pipeline.queueBytes += chunk.byteLength;
      pipeline.expectedSequence = Math.max(pipeline.expectedSequence, sequence + 1);
    }
  }, []);

  const ensurePlaybackPipeline = useCallback((callId: string, mimeType: string) => {
    const current = playbackPipelineRef.current;
    if (current && current.callId === callId) {
      return current;
    }

    cleanupPlayback();

    if (typeof window === 'undefined' || typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mimeType)) {
      console.warn('[skypier:audio] MediaSource playback is unavailable for', mimeType);
      return null;
    }

    const mediaSource = new MediaSource();
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute('playsinline', 'true');
    const objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;

    const pipeline: PlaybackPipeline = {
      callId,
      mimeType,
      audio,
      mediaSource,
      objectUrl,
      queue: [],
      queueBytes: 0,
      expectedSequence: 0,
      pendingBySequence: new Map(),
      ended: false,
    };

    mediaSource.addEventListener('sourceopen', () => {
      if (pipeline.sourceBuffer) {
        return;
      }

      try {
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = 'sequence';
        sourceBuffer.addEventListener('updateend', flushPlaybackQueue);
        pipeline.sourceBuffer = sourceBuffer;
        flushPlaybackQueue();
        void audio.play().catch(() => {
          // Playback may require a user gesture depending on browser policy.
        });
      } catch (error) {
        console.warn('[skypier:audio] Failed to create SourceBuffer:', error);
      }
    }, { once: true });

    playbackPipelineRef.current = pipeline;
    return pipeline;
  }, [cleanupPlayback, flushPlaybackQueue]);

  const stopOutgoingAudio = useCallback(async (sendEndMarker = false) => {
    outboundEnabledRef.current = false;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }

    if (sendEndMarker) {
      const current = activeCallRef.current;
      if (current) {
        await sendAudioCallChunk({
          kind: 'end',
          callId: current.callId,
          conversationId: current.conversationId,
          fromPeerId: localPeerId ?? 'unknown',
          sentAt: new Date().toISOString(),
          sequence: outboundSequenceRef.current,
          mimeType: chooseRecorderMimeType() ?? 'audio/webm;codecs=opus',
        }, current.remotePeerId);
      }
    }
  }, [localPeerId, sendAudioCallChunk]);

  const stopLocalAudio = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const finalizeCall = useCallback((reason?: AudioCallEndReason, error?: string) => {
    startCallAbortRef.current = true;
    void stopOutgoingAudio(false);
    stopLocalAudio();
    cleanupPlayback();
    void stopLooping();
    setCall((current) => current ? {
      ...current,
      phase: error ? 'error' : 'ended',
      endedReason: reason,
      error,
    } : current);
  }, [cleanupPlayback, stopLocalAudio, stopOutgoingAudio, stopLooping]);

  const acquireLocalAudio = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support microphone capture.');
    }

    if (localStreamRef.current) {
      return localStreamRef.current;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    localStreamRef.current = stream;
    return stream;
  }, []);

  const sendSignal = useCallback(async (targetPeerId: string, signal: Omit<AudioCallSignal, 'fromPeerId' | 'sentAt'>) => {
    if (!localPeerId) {
      return false;
    }

    return sendAudioCallSignal({
      ...signal,
      fromPeerId: localPeerId,
      sentAt: new Date().toISOString(),
    }, targetPeerId);
  }, [localPeerId, sendAudioCallSignal]);

  const startOutgoingAudio = useCallback(async () => {
    const current = activeCallRef.current;
    const localStream = localStreamRef.current;

    if (!current || current.phase !== 'connected' || !localStream) {
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new Error('This browser does not support MediaRecorder audio streaming.');
    }

    const existingRecorder = mediaRecorderRef.current;
    if (existingRecorder && existingRecorder.state !== 'inactive') {
      return;
    }

    const mimeType = chooseRecorderMimeType();
    const recorder = mimeType
      ? new MediaRecorder(localStream, { mimeType, audioBitsPerSecond: 32_000 })
      : new MediaRecorder(localStream, { audioBitsPerSecond: 32_000 });

    outboundSequenceRef.current = 0;
    outboundEnabledRef.current = true;

    recorder.ondataavailable = (event) => {
      if (!outboundEnabledRef.current || event.data.size === 0) {
        return;
      }

      const activeCall = activeCallRef.current;
      if (!activeCall || activeCall.phase !== 'connected') {
        return;
      }

      void event.data.arrayBuffer().then((arrayBuffer) => {
        const bytes = new Uint8Array(arrayBuffer);
        if (bytes.byteLength === 0) {
          return;
        }

        void sendAudioCallChunk({
          kind: 'chunk',
          callId: activeCall.callId,
          conversationId: activeCall.conversationId,
          fromPeerId: localPeerId ?? 'unknown',
          sentAt: new Date().toISOString(),
          sequence: outboundSequenceRef.current++,
          mimeType: event.data.type || recorder.mimeType || mimeType || 'audio/webm;codecs=opus',
          data: encodeBase64(bytes),
        }, activeCall.remotePeerId);
      }).catch((error) => {
        console.warn('[skypier:audio] Failed to serialize outbound audio chunk:', error);
      });
    };

    recorder.onerror = () => {
      finalizeCall('error', 'Microphone recorder failed during the call.');
    };

    recorder.start(250);
    mediaRecorderRef.current = recorder;
  }, [finalizeCall, localPeerId, sendAudioCallChunk]);

  const startCall = useCallback(async ({ conversationId, remotePeerId, remoteDisplayName }: StartAudioCallOptions) => {
    if (!localPeerId) {
      throw new Error('Local peer identity is not ready yet.');
    }

    if (!isSessionReady) {
      throw new Error('Live session is not connected yet.');
    }

    const existing = activeCallRef.current;
    if (existing && !['ended', 'error'].includes(existing.phase)) {
      throw new Error('Finish the current call before starting another one.');
    }

    const nextCall: ActiveAudioCall = {
      callId: createCallId(),
      conversationId,
      remotePeerId,
      remoteDisplayName,
      direction: 'outgoing',
      phase: 'requesting-media',
      isMuted: false,
      remoteMuted: false,
      mediaProfile: DEFAULT_MEDIA_PROFILE,
    };

    startCallAbortRef.current = false;
    setCall(nextCall);

    try {
      void playEarcon('dial');
      await acquireLocalAudio();
      if (startCallAbortRef.current) return false;

      setCall((current) => current ? { ...current, phase: 'connecting', error: undefined } : current);
      await dialPeerById(remotePeerId);
      if (startCallAbortRef.current) return false;

      const delivered = await sendSignal(remotePeerId, {
        type: 'offer',
        callId: nextCall.callId,
        conversationId,
        mediaProfile: DEFAULT_MEDIA_PROFILE,
      });
      if (startCallAbortRef.current) return false;

      if (!delivered) {
        throw new Error('The remote peer is not reachable for call setup.');
      }

      setCall((current) => current ? { ...current, phase: 'ringing' } : current);
      void playEarcon('ringing-outbound', { loop: true, volume: 0.6 });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start the call.';
      void playEarcon('error');
      finalizeCall('error', message);
      throw error;
    }
  }, [acquireLocalAudio, dialPeerById, finalizeCall, isSessionReady, localPeerId, sendSignal]);

  const acceptCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current || current.direction !== 'incoming') {
      return false;
    }

    try {
      setCall((value) => value ? { ...value, phase: 'requesting-media', error: undefined } : value);
      await acquireLocalAudio();
      setCall((value) => value ? { ...value, phase: 'connecting' } : value);
      await dialPeerById(current.remotePeerId);

      const delivered = await sendSignal(current.remotePeerId, {
        type: 'accept',
        callId: current.callId,
        conversationId: current.conversationId,
        mediaProfile: current.mediaProfile,
      });

      if (!delivered) {
        throw new Error('Could not confirm the call with the remote peer.');
      }

      void stopLooping();
      void playEarcon('connect');
      setCall((value) => value ? {
        ...value,
        phase: 'connected',
        startedAt: value.startedAt ?? new Date().toISOString(),
      } : value);
      return true;
    } catch (error) {
      void stopLooping();
      const message = error instanceof Error ? error.message : 'Unable to answer the call.';
      void playEarcon('error');
      finalizeCall('error', message);
      return false;
    }
  }, [acquireLocalAudio, dialPeerById, finalizeCall, sendSignal]);

  const rejectCall = useCallback(async (reason: AudioCallEndReason = 'declined') => {
    const current = activeCallRef.current;
    if (!current) {
      return false;
    }

    void stopLooping();
    void playEarcon('reject');

    if (current.direction === 'incoming' && ['incoming', 'requesting-media', 'connecting'].includes(current.phase)) {
      await sendSignal(current.remotePeerId, {
        type: 'reject',
        callId: current.callId,
        conversationId: current.conversationId,
        reason,
      });
    }

    finalizeCall(reason);
    return true;
  }, [finalizeCall, sendSignal, playEarcon, stopLooping]);

  const endCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current) {
      return false;
    }

    void stopLooping();
    void playEarcon('hangup');
    startCallAbortRef.current = true;

    // Fire-and-forget — never block on an unreachable peer.
    if (!['ended', 'error'].includes(current.phase)) {
      void sendSignal(current.remotePeerId, {
        type: 'hangup',
        callId: current.callId,
        conversationId: current.conversationId,
        reason: 'hangup',
      }).catch(() => {});
    }

    void stopOutgoingAudio(true);
    stopLocalAudio();
    cleanupPlayback();
    setCall(null); // close the drawer immediately
    return true;
  }, [cleanupPlayback, sendSignal, stopLocalAudio, stopOutgoingAudio, playEarcon, stopLooping]);

  const toggleMute = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current) {
      return false;
    }

    const nextMuted = !current.isMuted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });

    void playEarcon(nextMuted ? 'mute-on' : 'mute-off');
    setCall((value) => value ? { ...value, isMuted: nextMuted } : value);

    await sendSignal(current.remotePeerId, {
      type: 'mute',
      callId: current.callId,
      conversationId: current.conversationId,
      muted: nextMuted,
    });

    return nextMuted;
  }, [sendSignal, playEarcon]);

  const dismissCall = useCallback(() => {
    void stopOutgoingAudio(false);
    stopLocalAudio();
    cleanupPlayback();
    setCall(null);
  }, [cleanupPlayback, stopLocalAudio, stopOutgoingAudio]);

  const handleIncomingSignal = useCallback(async ({ fromPeerId, remoteDisplayName, signal }: HandleIncomingSignalOptions) => {
    const current = activeCallRef.current;

    if (signal.type === 'offer') {
      if (current && !['ended', 'error'].includes(current.phase) && current.callId !== signal.callId) {
        await sendSignal(fromPeerId, {
          type: 'busy',
          callId: signal.callId,
          conversationId: signal.conversationId,
          reason: 'busy',
        });
        return;
      }

      const incomingCall: ActiveAudioCall = {
        callId: signal.callId,
        conversationId: signal.conversationId,
        remotePeerId: fromPeerId,
        remoteDisplayName,
        direction: 'incoming',
        phase: 'incoming',
        isMuted: false,
        remoteMuted: false,
        mediaProfile: signal.mediaProfile ?? DEFAULT_MEDIA_PROFILE,
      };

      setCall(incomingCall);
      void playEarcon('ring', { loop: true, volume: 0.65 });
      await sendSignal(fromPeerId, {
        type: 'ringing',
        callId: signal.callId,
        conversationId: signal.conversationId,
      });
      return;
    }

    if (!current || current.callId !== signal.callId) {
      return;
    }

    switch (signal.type) {
      case 'ringing':
        setCall((value) => value ? { ...value, phase: 'ringing' } : value);
        break;
      case 'accept':
        void stopLooping();
        void playEarcon('connect');
        setCall((value) => value ? {
          ...value,
          phase: 'connected',
          startedAt: value.startedAt ?? new Date().toISOString(),
          error: undefined,
        } : value);
        break;
      case 'reject':
        void stopLooping();
        void playEarcon('reject');
        finalizeCall(signal.reason ?? 'declined');
        break;
      case 'busy':
        void stopLooping();
        void playEarcon('busy', { loop: true, volume: 0.6 });
        finalizeCall('busy');
        break;
      case 'hangup':
        void stopLooping();
        void playEarcon('hangup');
        finalizeCall(signal.reason ?? 'hangup');
        break;
      case 'mute':
        setCall((value) => value ? { ...value, remoteMuted: Boolean(signal.muted) } : value);
        break;
      default:
        break;
    }
  }, [finalizeCall, sendSignal, playEarcon, stopLooping]);

  const handleIncomingAudioChunk = useCallback(({ chunk }: { fromPeerId: string; chunk: AudioCallChunk }) => {
    const current = activeCallRef.current;
    if (!current || current.callId !== chunk.callId) {
      return;
    }

    const pipeline = ensurePlaybackPipeline(chunk.callId, chunk.mimeType);
    if (!pipeline) {
      return;
    }

    if (chunk.kind === 'end') {
      drainPendingIntoPlaybackQueue(pipeline, true);
      pipeline.ended = true;
      flushPlaybackQueue();
      return;
    }

    if (!chunk.data) {
      return;
    }

    const decoded = decodeBase64(chunk.data);
    if (chunk.sequence < pipeline.expectedSequence) {
      return;
    }

    if (pipeline.pendingBySequence.has(chunk.sequence)) {
      return;
    }

    pipeline.pendingBySequence.set(chunk.sequence, decoded);

    if (pipeline.pendingBySequence.size > MAX_PENDING_AUDIO_CHUNKS) {
      const available = Array.from(pipeline.pendingBySequence.keys()).sort((a, b) => a - b);
      if (available.length > 0) {
        pipeline.expectedSequence = available[0];
      }
    }

    drainPendingIntoPlaybackQueue(pipeline, false);

    // Drop oldest queued audio chunks if buffering grows too large.
    while (pipeline.queueBytes > MAX_PLAYBACK_QUEUE_BYTES && pipeline.queue.length > 1) {
      const dropped = pipeline.queue.shift();
      if (!dropped) {
        break;
      }
      pipeline.queueBytes = Math.max(0, pipeline.queueBytes - dropped.byteLength);
    }

    void pipeline.audio.play().catch(() => {
      // Playback may be delayed until the user interacts with the page.
    });
    flushPlaybackQueue();
  }, [drainPendingIntoPlaybackQueue, ensurePlaybackPipeline, flushPlaybackQueue]);

  useEffect(() => {
    return () => {
      void stopOutgoingAudio(false);
      stopLocalAudio();
      cleanupPlayback();
    };
  }, [cleanupPlayback, stopLocalAudio, stopOutgoingAudio]);

  useEffect(() => {
    if (call?.phase === 'connected') {
      void startOutgoingAudio().catch((error) => {
        finalizeCall('error', error instanceof Error ? error.message : 'Failed to start outbound audio.');
      });
      return;
    }

    if (call == null || ['ended', 'error'].includes(call.phase)) {
      void stopOutgoingAudio(false);
    }
  }, [call, finalizeCall, startOutgoingAudio, stopOutgoingAudio]);

  const hasActiveCall = useMemo(
    () => call != null && !['ended', 'error'].includes(call.phase),
    [call],
  );

  return {
    call,
    hasActiveCall,
    localStream: localStreamRef.current,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    dismissCall,
    handleIncomingSignal,
    handleIncomingAudioChunk,
  };
}
