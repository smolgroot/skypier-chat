#!/usr/bin/env bash
set -euo pipefail

# Build and deploy the Skypier relay binary to a VPS, then restart systemd service.
#
# Examples:
#   relay/scripts/deploy-vps.sh --host 203.0.113.10
#   relay/scripts/deploy-vps.sh --host vps.example.com --user ubuntu --ssh-key ~/.ssh/id_ed25519
#   relay/scripts/deploy-vps.sh --host relay-vps --skip-unit --skip-config
#
# Defaults:
#   user: root
#   port: 22
#   service: skypier-relay
#   binary install path: /usr/local/bin/skypier-relay
#   creates /etc/skypier-relay/config.yaml only if it doesn't exist

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELAY_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

HOST=""
USER="root"
PORT="22"
SSH_KEY=""
SERVICE_NAME="skypier-relay"
REMOTE_BIN="/usr/local/bin/skypier-relay"
REMOTE_CONFIG_DIR="/etc/skypier-relay"
REMOTE_UNIT_PATH="/etc/systemd/system/skypier-relay.service"
SKIP_CONFIG="0"
SKIP_UNIT="0"
SKIP_RESTART="0"
GOOS_TARGET="linux"
GOARCH_TARGET="amd64"

usage() {
  cat <<'EOF'
Usage: deploy-vps.sh --host <host-or-ip> [options]

Required:
  --host <host>                 VPS hostname or IP

Options:
  --user <user>                 SSH user (default: root)
  --port <port>                 SSH port (default: 22)
  --ssh-key <path>              SSH private key file
  --service <name>              systemd service name (default: skypier-relay)
  --remote-bin <path>           Remote binary path (default: /usr/local/bin/skypier-relay)
  --remote-config-dir <path>    Remote config dir (default: /etc/skypier-relay)
  --remote-unit-path <path>     Remote unit file path (default: /etc/systemd/system/skypier-relay.service)
  --skip-config                 Do not copy/create config.yaml
  --skip-unit                   Do not copy unit file
  --skip-restart                Do not restart/enable service
  --goos <os>                   Build target GOOS (default: linux)
  --goarch <arch>               Build target GOARCH (default: amd64)
  -h, --help                    Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    --user) USER="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --ssh-key) SSH_KEY="${2:-}"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    --remote-bin) REMOTE_BIN="${2:-}"; shift 2 ;;
    --remote-config-dir) REMOTE_CONFIG_DIR="${2:-}"; shift 2 ;;
    --remote-unit-path) REMOTE_UNIT_PATH="${2:-}"; shift 2 ;;
    --skip-config) SKIP_CONFIG="1"; shift ;;
    --skip-unit) SKIP_UNIT="1"; shift ;;
    --skip-restart) SKIP_RESTART="1"; shift ;;
    --goos) GOOS_TARGET="${2:-}"; shift 2 ;;
    --goarch) GOARCH_TARGET="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$HOST" ]]; then
  echo "Error: --host is required" >&2
  usage
  exit 1
fi

SSH_TARGET="${USER}@${HOST}"
SSH_ARGS=(-p "$PORT" -o StrictHostKeyChecking=accept-new)
SCP_ARGS=(-P "$PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "$SSH_KEY" ]]; then
  SSH_ARGS+=(-i "$SSH_KEY")
  SCP_ARGS+=(-i "$SSH_KEY")
fi

echo "==> Building relay binary (${GOOS_TARGET}/${GOARCH_TARGET})"
pushd "$RELAY_DIR" >/dev/null
mkdir -p dist
CGO_ENABLED=0 GOOS="$GOOS_TARGET" GOARCH="$GOARCH_TARGET" \
  go build -trimpath -ldflags="-s -w" -o dist/skypier-relay ./cmd/skypier-relay
popd >/dev/null

TMP_BIN="/tmp/skypier-relay.bin"
TMP_UNIT="/tmp/skypier-relay.service"
TMP_CONFIG="/tmp/skypier-relay.config.yaml"

echo "==> Uploading binary to ${SSH_TARGET}"
scp "${SCP_ARGS[@]}" "$RELAY_DIR/dist/skypier-relay" "${SSH_TARGET}:${TMP_BIN}"

if [[ "$SKIP_UNIT" != "1" ]]; then
  echo "==> Uploading systemd unit"
  scp "${SCP_ARGS[@]}" "$RELAY_DIR/systemd/skypier-relay.service" "${SSH_TARGET}:${TMP_UNIT}"
fi

if [[ "$SKIP_CONFIG" != "1" ]]; then
  echo "==> Uploading example config"
  scp "${SCP_ARGS[@]}" "$RELAY_DIR/config.example.yaml" "${SSH_TARGET}:${TMP_CONFIG}"
fi

if [[ "$USER" == "root" ]]; then
  REMOTE_SUDO=""
else
  REMOTE_SUDO="sudo"
fi

echo "==> Installing on VPS and restarting service"
ssh "${SSH_ARGS[@]}" "$SSH_TARGET" \
  "REMOTE_BIN='$REMOTE_BIN' REMOTE_CONFIG_DIR='$REMOTE_CONFIG_DIR' REMOTE_UNIT_PATH='$REMOTE_UNIT_PATH' SERVICE_NAME='$SERVICE_NAME' SKIP_UNIT='$SKIP_UNIT' SKIP_CONFIG='$SKIP_CONFIG' SKIP_RESTART='$SKIP_RESTART' TMP_BIN='$TMP_BIN' TMP_UNIT='$TMP_UNIT' TMP_CONFIG='$TMP_CONFIG' REMOTE_SUDO='$REMOTE_SUDO' bash -s" <<'EOF'
set -euo pipefail

$REMOTE_SUDO install -m 0755 "$TMP_BIN" "$REMOTE_BIN"
$REMOTE_SUDO rm -f "$TMP_BIN"

$REMOTE_SUDO mkdir -p "$REMOTE_CONFIG_DIR"
$REMOTE_SUDO mkdir -p /var/lib/skypier-relay /var/cache/skypier-relay/acme
$REMOTE_SUDO chmod 0700 /var/cache/skypier-relay/acme

if [[ "$SKIP_UNIT" != "1" ]]; then
  $REMOTE_SUDO install -m 0644 "$TMP_UNIT" "$REMOTE_UNIT_PATH"
  $REMOTE_SUDO rm -f "$TMP_UNIT"
fi

if [[ "$SKIP_CONFIG" != "1" ]]; then
  if [[ ! -f "$REMOTE_CONFIG_DIR/config.yaml" ]]; then
    $REMOTE_SUDO install -m 0600 "$TMP_CONFIG" "$REMOTE_CONFIG_DIR/config.yaml"
    echo "Created $REMOTE_CONFIG_DIR/config.yaml (edit it with your DNS/limits if needed)."
  else
    echo "Keeping existing $REMOTE_CONFIG_DIR/config.yaml"
  fi
  $REMOTE_SUDO rm -f "$TMP_CONFIG"
fi

if [[ "$SKIP_UNIT" != "1" ]]; then
  $REMOTE_SUDO systemctl daemon-reload
fi

if [[ "$SKIP_RESTART" != "1" ]]; then
  $REMOTE_SUDO systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  $REMOTE_SUDO systemctl restart "$SERVICE_NAME"
  $REMOTE_SUDO systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,40p'
fi
EOF

echo "==> Done"
if [[ "$SKIP_RESTART" == "1" ]]; then
  echo "Service restart skipped (--skip-restart)."
else
  echo "Service '$SERVICE_NAME' restarted on $SSH_TARGET."
fi
