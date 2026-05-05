package mailbox

import (
	"sort"
	"sync"
	"time"
)

type RecipientKeyWrap struct {
	RecipientPeerID    string `json:"recipientPeerId"`
	RecipientDeviceID  string `json:"recipientDeviceId"`
	KeyWrapAlgorithm   string `json:"keyWrapAlgorithm"`
	PreKeyID           string `json:"preKeyId,omitempty"`
	EphemeralPublicKey string `json:"ephemeralPublicKey,omitempty"`
	Salt               string `json:"salt,omitempty"`
	Nonce              string `json:"nonce,omitempty"`
	WrappedKey         string `json:"wrappedKey"`
}

type EncryptedMessageEnvelope struct {
	V           int                `json:"v"`
	Algorithm   string             `json:"algorithm"`
	Ciphertext  string             `json:"ciphertext"`
	Nonce       string             `json:"nonce"`
	SenderKeyID string             `json:"senderKeyId"`
	AAD         string             `json:"aad,omitempty"`
	KeyWraps    []RecipientKeyWrap `json:"keyWraps"`
}

type RelayMailboxEnvelope struct {
	EnvelopeID        string                   `json:"envelopeId"`
	MessageID         string                   `json:"messageId"`
	ConversationID    string                   `json:"conversationId"`
	SenderPeerID      string                   `json:"senderPeerId"`
	RecipientPeerID   string                   `json:"recipientPeerId"`
	SentAt            string                   `json:"sentAt"`
	ExpiresAt         string                   `json:"expiresAt"`
	ContentType       string                   `json:"contentType"`
	EncryptedEnvelope EncryptedMessageEnvelope `json:"encryptedEnvelope"`
}

type EnqueueRequest struct {
	Envelope RelayMailboxEnvelope `json:"envelope"`
}

type EnqueueResponse struct {
	Accepted   bool   `json:"accepted"`
	Reason     string `json:"reason,omitempty"`
	ExpiresAt  string `json:"expiresAt,omitempty"`
	QueueDepth int    `json:"queueDepth,omitempty"`
}

type PullRequest struct {
	RecipientPeerID string `json:"recipientPeerId"`
	Limit           int    `json:"limit,omitempty"`
	AfterCursor     string `json:"afterCursor,omitempty"`
}

type PullResponse struct {
	Items      []RelayMailboxEnvelope `json:"items"`
	NextCursor string                 `json:"nextCursor,omitempty"`
}

type AckRequest struct {
	RecipientPeerID string   `json:"recipientPeerId"`
	EnvelopeIDs     []string `json:"envelopeIds"`
}

type AckResponse struct {
	Acked   []string `json:"acked"`
	Missing []string `json:"missing"`
}

type PushSubscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}

type PushSubscribeRequest struct {
	RecipientPeerID  string           `json:"recipientPeerId"`
	PushSubscription PushSubscription `json:"pushSubscription"`
}

type Store struct {
	mu              sync.Mutex
	maxPerRecipient int
	defaultTTL      time.Duration
	byRecipient     map[string][]RelayMailboxEnvelope
	byRecipientByID map[string]map[string]RelayMailboxEnvelope
	subscriptions   map[string]PushSubscription
}

func NewStore(maxPerRecipient int, defaultTTL time.Duration) *Store {
	if maxPerRecipient <= 0 {
		maxPerRecipient = 1000
	}
	if defaultTTL <= 0 {
		defaultTTL = 7 * 24 * time.Hour
	}
	return &Store{
		maxPerRecipient: maxPerRecipient,
		defaultTTL:      defaultTTL,
		byRecipient:     make(map[string][]RelayMailboxEnvelope),
		byRecipientByID: make(map[string]map[string]RelayMailboxEnvelope),
		subscriptions:   make(map[string]PushSubscription),
	}
}

func (s *Store) SavePushSubscription(peerID string, sub PushSubscription) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscriptions[peerID] = sub
}

func (s *Store) GetPushSubscription(peerID string) (PushSubscription, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sub, ok := s.subscriptions[peerID]
	return sub, ok
}

func (s *Store) Enqueue(envelope RelayMailboxEnvelope, now time.Time) (accepted bool, reason string, queueDepth int, expiresAt string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)

	if envelope.RecipientPeerID == "" || envelope.EnvelopeID == "" {
		return false, "missing recipient or envelope id", 0, ""
	}

	if envelope.ExpiresAt == "" {
		envelope.ExpiresAt = now.Add(s.defaultTTL).UTC().Format(time.RFC3339)
	}

	if _, err := time.Parse(time.RFC3339, envelope.ExpiresAt); err != nil {
		return false, "invalid expiresAt", 0, ""
	}

	if s.byRecipientByID[envelope.RecipientPeerID] == nil {
		s.byRecipientByID[envelope.RecipientPeerID] = make(map[string]RelayMailboxEnvelope)
	}
	if existing, ok := s.byRecipientByID[envelope.RecipientPeerID][envelope.EnvelopeID]; ok {
		return true, "", len(s.byRecipient[envelope.RecipientPeerID]), existing.ExpiresAt
	}

	queue := s.byRecipient[envelope.RecipientPeerID]
	if len(queue) >= s.maxPerRecipient {
		return false, "recipient mailbox is full", len(queue), ""
	}

	queue = append(queue, envelope)
	sort.SliceStable(queue, func(i, j int) bool {
		return queue[i].SentAt < queue[j].SentAt
	})
	s.byRecipient[envelope.RecipientPeerID] = queue
	s.byRecipientByID[envelope.RecipientPeerID][envelope.EnvelopeID] = envelope

	return true, "", len(queue), envelope.ExpiresAt
}

func (s *Store) Pull(recipientPeerID string, limit int, afterCursor string, now time.Time) (items []RelayMailboxEnvelope, nextCursor string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)

	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	queue := s.byRecipient[recipientPeerID]
	if len(queue) == 0 {
		return nil, ""
	}

	startIndex := 0
	if afterCursor != "" {
		for idx, envelope := range queue {
			if envelope.EnvelopeID == afterCursor {
				startIndex = idx + 1
				break
			}
		}
	}

	if startIndex >= len(queue) {
		return nil, ""
	}

	endIndex := startIndex + limit
	if endIndex > len(queue) {
		endIndex = len(queue)
	}

	copied := append([]RelayMailboxEnvelope(nil), queue[startIndex:endIndex]...)
	if endIndex < len(queue) {
		return copied, queue[endIndex-1].EnvelopeID
	}
	return copied, ""
}

func (s *Store) Ack(recipientPeerID string, envelopeIDs []string, now time.Time) (acked []string, missing []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)

	if len(envelopeIDs) == 0 {
		return []string{}, []string{}
	}

	queue := s.byRecipient[recipientPeerID]
	if len(queue) == 0 {
		return []string{}, append([]string(nil), envelopeIDs...)
	}

	byID := s.byRecipientByID[recipientPeerID]
	toDelete := make(map[string]struct{}, len(envelopeIDs))
	for _, envelopeID := range envelopeIDs {
		if _, ok := byID[envelopeID]; ok {
			acked = append(acked, envelopeID)
			toDelete[envelopeID] = struct{}{}
		} else {
			missing = append(missing, envelopeID)
		}
	}

	if len(toDelete) == 0 {
		return acked, missing
	}

	filtered := queue[:0]
	for _, envelope := range queue {
		if _, ok := toDelete[envelope.EnvelopeID]; ok {
			delete(byID, envelope.EnvelopeID)
			continue
		}
		filtered = append(filtered, envelope)
	}
	s.byRecipient[recipientPeerID] = append([]RelayMailboxEnvelope(nil), filtered...)

	if len(s.byRecipient[recipientPeerID]) == 0 {
		delete(s.byRecipient, recipientPeerID)
		delete(s.byRecipientByID, recipientPeerID)
	}

	return acked, missing
}

func (s *Store) cleanupLocked(now time.Time) {
	for recipient, queue := range s.byRecipient {
		if len(queue) == 0 {
			delete(s.byRecipient, recipient)
			delete(s.byRecipientByID, recipient)
			continue
		}

		filtered := queue[:0]
		byID := s.byRecipientByID[recipient]
		for _, envelope := range queue {
			expiresAt, err := time.Parse(time.RFC3339, envelope.ExpiresAt)
			if err != nil || !expiresAt.After(now) {
				delete(byID, envelope.EnvelopeID)
				continue
			}
			filtered = append(filtered, envelope)
		}

		if len(filtered) == 0 {
			delete(s.byRecipient, recipient)
			delete(s.byRecipientByID, recipient)
			continue
		}
		s.byRecipient[recipient] = append([]RelayMailboxEnvelope(nil), filtered...)
	}
}

// Stats returns mailbox queue statistics after pruning expired entries.
func (s *Store) Stats(now time.Time) (pendingMessages int64, recipientsWithUnread int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)

	for _, queue := range s.byRecipient {
		if len(queue) == 0 {
			continue
		}
		recipientsWithUnread++
		pendingMessages += int64(len(queue))
	}

	return pendingMessages, recipientsWithUnread
}

// UnreadCount returns the number of unread envelopes for a recipient after
// pruning expired entries.
func (s *Store) UnreadCount(recipientPeerID string, now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupLocked(now)

	return len(s.byRecipient[recipientPeerID])
}
