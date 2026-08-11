export interface IntervalTaskOptions {
  intervalMs: number;
  runImmediately?: boolean;
  onError?: (error: unknown) => void;
}

export function runIntervalTask(task: () => Promise<void> | void, options: IntervalTaskOptions): () => void {
  const intervalMs = Math.max(1_000, Math.floor(options.intervalMs));
  const runImmediately = options.runImmediately ?? true;

  let stopped = false;
  let inFlight = false;

  const invokeTask = async () => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;
    try {
      await task();
    } catch (error) {
      options.onError?.(error);
    } finally {
      inFlight = false;
    }
  };

  if (runImmediately) {
    void invokeTask();
  }

  const timer = setInterval(() => {
    void invokeTask();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
