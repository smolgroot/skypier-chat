# Skypier Relay Setup (Go)

This guide explains how to deploy and use the dedicated libp2p relay server for Skypier.

## Overview

The relay server lives in `relay/` and provides:

- Circuit Relay v2 service for browser peers
- WSS (`/tls/ws`) listener for browser compatibility
- DHT server mode for better routing support
- CLI commands:
  - `serve`
  - `status`
  - `keygen`
- systemd unit file for VPS deployment

## Prerequisites

- A VPS with public IPv4
- `relay.skypier.chat` DNS A record pointing to that VPS
- Port `443/tcp` open
- Root access on VPS
- Local machine with Go (build happens locally, not on VPS)

## 1) Build binary locally (not on VPS)

From your local repo root:

```bash
cd relay
go build -trimpath -ldflags="-s -w" -o dist/skypier-relay ./cmd/skypier-relay
```

This produces `relay/dist/skypier-relay`.

## 2) Copy artifacts to VPS

From your local machine:

```bash
scp relay/dist/skypier-relay root@<VPS_IP>:/usr/local/bin/skypier-relay
scp relay/config.example.yaml root@<VPS_IP>:/etc/skypier-relay/config.yaml
scp relay/systemd/skypier-relay.service root@<VPS_IP>:/etc/systemd/system/skypier-relay.service
```

Then on VPS:

```bash
chmod 0755 /usr/local/bin/skypier-relay
mkdir -p /etc/skypier-relay /var/lib/skypier-relay /var/cache/skypier-relay/acme
chmod 0700 /var/cache/skypier-relay/acme
```

## 3) Configure relay

Edit:

```bash
/etc/skypier-relay/config.yaml
```

Recommended values:

```yaml
dns_name: relay.skypier.chat
listen_addr: /ip4/0.0.0.0/tcp/443/tls/ws
identity_key: ""
acme_cache_dir: /var/cache/skypier-relay/acme
max_reservations: 512
reservation_ttl: 1h
circuit_duration: 15m
circuit_data_mb: 512
status_file: /run/skypier-relay/status.json
```

Notes:

- Leave `identity_key` empty on first run. It is auto-generated and saved.
- ACME certificates are cached in `acme_cache_dir`.

## 4) Register daemon as systemd service

On VPS:

```bash
systemctl daemon-reload
systemctl enable skypier-relay
systemctl start skypier-relay
systemctl status skypier-relay
```

Logs:

```bash
journalctl -u skypier-relay -f
```

## 5) ACME (Let's Encrypt) checklist

The relay requests certificates automatically on first TLS handshake.

Before first start:

- `relay.skypier.chat` resolves to your VPS public IP
- TCP `443` is open in firewall/security group
- no other service is listening on `:443`

Quick checks:

```bash
dig +short relay.skypier.chat
ss -lntp | grep ':443'
```

After start, verify ACME cache files are created:

```bash
ls -la /var/cache/skypier-relay/acme
```

If ACME fails:

```bash
journalctl -u skypier-relay -n 200 --no-pager
```

## 6) Get relay peer ID and status

```bash
skypier-relay status
```

The output includes:

- relay peer ID
- uptime
- connected peers
- listen addresses

Optional manual key generation:

```bash
skypier-relay keygen
```

## 7) Wire relay into web app bootstrap

Set this environment variable for the web app:

```bash
VITE_RELAY_BOOTSTRAP_MULTIADDRS=/dns4/relay.skypier.chat/tcp/443/tls/ws/p2p/<RELAY_PEER_ID>/p2p-circuit
```

Multiple relays can be provided as comma-separated values.

The app prepends these to default bootstrap peers in `apps/web/src/useLiveChatSession.ts`.

## 8) Validate end-to-end

- Start two browser clients
- Open chat channels between peers
- Confirm `connected peers` increases in `skypier-relay status`
- Confirm delivery state progresses from sending to sent/delivered in chat UI

## Troubleshooting

### ACME certificate errors

- Ensure `relay.skypier.chat` resolves to your VPS public IP
- Ensure TCP 443 is reachable from the internet
- Check logs: `journalctl -u skypier-relay -f`

### Browser cannot dial relay

- Verify multiaddr uses `/tls/ws` and port `443`
- Verify `VITE_RELAY_BOOTSTRAP_MULTIADDRS` contains the correct relay peer ID
- Restart web app after env changes

### Service runs but no peers connect

- Confirm web clients are using the relay env var
- Confirm firewall allows inbound 443 and outbound internet access
- Check status file exists: `/run/skypier-relay/status.json`

## Related files

- `relay/cmd/skypier-relay/main.go`
- `relay/internal/node/node.go`
- `relay/systemd/skypier-relay.service`
- `relay/config.example.yaml`
- `apps/web/src/useLiveChatSession.ts`
- `packages/network/src/browser.ts`
