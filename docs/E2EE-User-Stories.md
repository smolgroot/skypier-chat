# E2EE User Stories (Unrealized Tasks)

Status legend: `TODO`, `IN-PROGRESS`, `DONE`

## Epic 1 — Trustworthy Key Distribution

### US-001 — Signed Prekey Bundle Verification
**As a** chat user
**I want** received prekey bundles to be signed by the sender identity key
**So that** malicious peers cannot inject fake keys.

- Status: `TODO`
- Priority: `P0`
- Acceptance criteria:
  - Bundle includes signature over canonical bundle payload.
  - Client verifies signature before storing `preKeyBundle`.
  - Invalid signature causes bundle rejection and warning telemetry.

### US-002 — Device Identity Binding
**As a** chat user
**I want** device keys bound to stable peer identity
**So that** key substitution is detectable.

- Status: `TODO`
- Priority: `P0`
- Acceptance criteria:
  - Bundle includes `peerId`, `deviceId`, and creation metadata in signed payload.
  - Verification fails if signed identity does not match transport peer identity.

---

## Epic 2 — Forward Secrecy and Prekey Lifecycle

### US-003 — One-Time Prekeys
**As a** chat user
**I want** recipients to publish one-time prekeys
**So that** first-contact and async messages use unique key material.

- Status: `TODO`
- Priority: `P0`
- Acceptance criteria:
  - Recipient advertises batch of one-time prekeys.
  - Sender consumes one prekey per new session/message bootstrap.
  - Used prekeys cannot be reused.

### US-004 — Prekey Rotation and Expiry
**As a** chat user
**I want** prekeys to rotate automatically
**So that** long-lived static keys are avoided.

- Status: `TODO`
- Priority: `P1`
- Acceptance criteria:
  - Rotation policy (time/usage-based) is implemented.
  - Expired prekeys are rejected for new wraps.
  - Client replenishes published prekey inventory.

### US-005 — Ratchet-Based Session Keys
**As a** chat user
**I want** per-message ratcheting
**So that** compromise of one key does not expose past/future messages.

- Status: `TODO`
- Priority: `P0`
- Acceptance criteria:
  - Sender/receiver derive evolving chain keys.
  - Message keys are single-use.
  - Out-of-order message handling is supported safely.

---

## Epic 3 — Message Integrity and Replay Protection

### US-006 — Envelope Integrity Validation
**As a** chat user
**I want** strict validation of encrypted envelopes
**So that** malformed or tampered payloads are dropped.

- Status: `TODO`
- Priority: `P0`
- Acceptance criteria:
  - Validate algorithm, nonce length, keyWrap fields, AAD shape.
  - Reject invalid envelopes before persistence.

### US-007 — Replay Detection
**As a** chat user
**I want** replayed encrypted envelopes to be rejected
**So that** old messages cannot be injected repeatedly.

- Status: `TODO`
- Priority: `P1`
- Acceptance criteria:
  - Replay cache keyed by sender/session/message identifiers.
  - Duplicate envelopes are ignored and logged.

---

## Epic 4 — Relay Mailbox Hardening

### US-008 — Mailbox Abuse Controls
**As a** relay operator
**I want** quotas and rate limits per sender/recipient
**So that** mailbox storage cannot be abused.

- Status: `TODO`
- Priority: `P1`
- Acceptance criteria:
  - Enforced per-recipient envelope count/size limits.
  - Enforced sender rate limits.
  - Explicit reject reasons and metrics emitted.

### US-009 — Delivery and Ack Robustness
**As a** chat user
**I want** mailbox pull/ack behavior to be idempotent and observable
**So that** offline delivery is reliable.

- Status: `TODO`
- Priority: `P1`
- Acceptance criteria:
  - Pull pagination is stable under concurrent ack.
  - Ack of unknown IDs is safe and reported.
  - End-to-end tests cover enqueue/pull/ack retry paths.

---

## Epic 5 — Recovery and Operations

### US-010 — Secure Backup/Restore of E2EE State
**As a** chat user
**I want** device E2EE state recovery rules
**So that** restore does not silently break decryptability or trust.

- Status: `TODO`
- Priority: `P1`
- Acceptance criteria:
  - Restore flow documents what keys are restorable vs regenerated.
  - Post-restore key announcement/rotation is enforced.

### US-011 — E2EE/Relay Observability
**As a** developer/operator
**I want** actionable metrics and logs
**So that** failures are diagnosable without exposing sensitive data.

- Status: `TODO`
- Priority: `P2`
- Acceptance criteria:
  - Counters for decrypt failures, bundle verification failures, mailbox rejects.
  - No plaintext/ciphertext leakage in logs.

### US-012 — Test Coverage for Crypto and Mailbox Contracts
**As a** maintainer
**I want** integration tests for E2EE + mailbox
**So that** regressions are caught before release.

- Status: `TODO`
- Priority: `P0`
- Acceptance criteria:
  - Tests for direct P2P encrypted send/receive.
  - Tests for offline mailbox encrypted delivery and ack.
  - Tests for invalid signature/replay/expired prekey rejection.

---

## Suggested Milestones

- **M1 (Security Baseline):** US-001, US-002, US-003, US-006, US-012
- **M2 (Forward Secrecy):** US-004, US-005, US-007
- **M3 (Ops Hardening):** US-008, US-009, US-010, US-011
