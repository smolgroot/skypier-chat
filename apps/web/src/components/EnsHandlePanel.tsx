import { useEffect, useState } from 'react';
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { getAddress, type Address } from 'viem';
import { ensAppUrl, ensChain, ensExplorerUrl, SKYPIER_PEERID_TEXT_KEY } from '../ens/ensClient';
import {
  checkEnsHandleWritable,
  describeEnsWriteError,
  publishSkypierPeerIdToEns,
  type EnsHandleWritability,
  type EnsPublishStage,
} from '../ens/ensPublish';

interface EnsHandlePanelProps {
  localPeerId: string;
  linkedWallets: { address: string; chainId: number }[];
  /** The wallet's primary (reverse) ENS name, used as the default target. */
  suggestedName?: string | null;
  publishedEnsName?: string;
  publishedPeerId?: string;
  publishedAt?: string;
  onPublished: (name: string, peerId: string) => Promise<void> | void;
}

const STAGE_LABELS: Record<EnsPublishStage, string> = {
  connecting: 'Connecting wallet…',
  'switching-chain': `Switching to ${ensChain.name}…`,
  checking: 'Checking write access…',
  'awaiting-signature': 'Confirm the transaction in your wallet…',
  pending: 'Waiting for confirmation…',
  confirmed: 'Confirmed.',
};

export function EnsHandlePanel({
  localPeerId,
  linkedWallets,
  suggestedName,
  publishedEnsName,
  publishedPeerId,
  publishedAt,
  onPublished,
}: EnsHandlePanelProps) {
  const [name, setName] = useState(publishedEnsName ?? suggestedName ?? '');
  const [check, setCheck] = useState<EnsHandleWritability | undefined>();
  const [checkBusy, setCheckBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [stage, setStage] = useState<EnsPublishStage | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<string | undefined>();

  // Fill in the primary name once it resolves, without clobbering user edits.
  useEffect(() => {
    if (!name && (publishedEnsName || suggestedName)) {
      setName(publishedEnsName ?? suggestedName ?? '');
    }
  }, [name, publishedEnsName, suggestedName]);

  const hasWallet = linkedWallets.length > 0;
  const isStale = Boolean(publishedEnsName && publishedPeerId && publishedPeerId !== localPeerId);
  const firstWallet = linkedWallets[0]?.address;

  const resetFeedback = () => {
    setError(undefined);
    setSuccess(undefined);
    setTxHash(undefined);
  };

  const handleCheck = async () => {
    resetFeedback();
    setCheck(undefined);
    setCheckBusy(true);
    try {
      let account: Address;
      try {
        account = getAddress(firstWallet ?? '');
      } catch {
        throw new Error('Link an EVM wallet first.');
      }
      setCheck(await checkEnsHandleWritable(name, account, localPeerId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to check this name.');
    } finally {
      setCheckBusy(false);
    }
  };

  const handlePublish = async () => {
    resetFeedback();
    setPublishBusy(true);
    try {
      const result = await publishSkypierPeerIdToEns({
        name,
        peerId: localPeerId,
        onStage: setStage,
      });
      await onPublished(result.name, localPeerId);
      setSuccess(result.alreadyPublished
        ? `${result.name} already points at this peer ID — nothing to publish.`
        : `Published to ${result.name}. People can now reach you at skypier.chat/u/${result.name}`);
      if (result.hash) {
        setTxHash(result.hash);
      }
      setCheck(undefined);
    } catch (caught) {
      setError(describeEnsWriteError(caught));
    } finally {
      setPublishBusy(false);
      setStage(undefined);
    }
  };

  return (
    <>
      <Typography variant="body1" paragraph>
        Publish your peer ID to an ENS name you own so people can reach you at a readable
        link instead of a long peer ID.
      </Typography>

      {publishedEnsName ? (
        <Alert severity={isStale ? 'warning' : 'success'} sx={{ mb: 2 }}>
          {isStale ? (
            <>
              <strong>{publishedEnsName}</strong> points at an older peer ID. Republish to
              update it.
            </>
          ) : (
            <>
              Published to <strong>{publishedEnsName}</strong>
              {publishedAt ? ` on ${new Date(publishedAt).toLocaleDateString()}` : ''}.
            </>
          )}
        </Alert>
      ) : null}

      {!hasWallet ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Link an EVM wallet above first — publishing requires a transaction signed by the
          address that owns the name.
        </Alert>
      ) : null}

      <TextField
        fullWidth
        size="small"
        label="ENS name"
        placeholder="vitalik.eth"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setCheck(undefined);
          resetFeedback();
        }}
        disabled={!hasWallet || publishBusy}
        helperText={suggestedName
          ? `Defaults to your wallet's primary ENS name (${suggestedName}) — or type any name you own.`
          : 'Type any ENS name owned by your linked wallet.'}
        sx={{ mb: 2 }}
      />

      {check ? (
        <Box sx={{ mb: 2 }}>
          <Alert severity={check.callerCanWrite ? 'success' : 'warning'}>
            {check.callerCanWrite
              ? `This wallet can write records for ${check.name}.`
              : (check.reason ?? `This wallet can't write records for ${check.name}.`)}
          </Alert>
          <Stack spacing={0.5} sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Owner: {check.ownerAddress ?? 'unknown'}{check.isWrapped ? ' (wrapped)' : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Current {SKYPIER_PEERID_TEXT_KEY}: {check.currentRecord ?? 'not set'}
            </Typography>
            {!check.resolverAddress ? (
              <Typography variant="caption">
                <Link href={ensAppUrl(check.name)} target="_blank" rel="noreferrer">
                  Set a resolver in the ENS app
                </Link>
              </Typography>
            ) : null}
          </Stack>
        </Box>
      ) : null}

      {stage ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {STAGE_LABELS[stage]}
        </Typography>
      ) : null}

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {success ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          {success}
          {txHash ? (
            <>
              {' '}
              <Link href={ensExplorerUrl(txHash)} target="_blank" rel="noreferrer">
                View transaction
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1.5}>
        <Button
          variant="outlined"
          onClick={() => void handleCheck()}
          disabled={!hasWallet || !name.trim() || checkBusy || publishBusy}
        >
          {checkBusy ? 'Checking…' : 'Check name'}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handlePublish()}
          disabled={!hasWallet || !name.trim() || publishBusy || !localPeerId}
        >
          {publishBusy ? 'Publishing…' : 'Publish peer ID'}
        </Button>
      </Stack>

      <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
        This writes a public record on {ensChain.name} costing roughly 50,000 gas. It
        permanently links this ENS name to your Skypier peer ID — the value can be
        overwritten later, but the history stays public forever.
      </Typography>
    </>
  );
}
