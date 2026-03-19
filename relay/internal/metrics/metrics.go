package metrics

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync/atomic"
	"time"
)

// Metrics tracks live relay statistics using lock-free atomics.
type Metrics struct {
	connectedPeers   atomic.Int64
	totalConnections atomic.Int64 // monotonically increasing
	reservations     atomic.Int64

	startedAt  time.Time
	statusFile string
}

// New creates a Metrics instance. statusFile is where JSON snapshots are written.
func New(statusFile string) *Metrics {
	return &Metrics{
		startedAt:  time.Now(),
		statusFile: statusFile,
	}
}

// PeerConnected increments the live peer counter and the lifetime counter.
func (m *Metrics) PeerConnected() {
	m.connectedPeers.Add(1)
	m.totalConnections.Add(1)
}

// PeerDisconnected decrements the live peer counter.
func (m *Metrics) PeerDisconnected() {
	m.connectedPeers.Add(-1)
}

// SetReservations updates the active reservation count (called from relay.Stat).
func (m *Metrics) SetReservations(n int64) {
	m.reservations.Store(n)
}

// ConnectedPeers returns the number of currently connected peers.
func (m *Metrics) ConnectedPeers() int64 { return m.connectedPeers.Load() }

// Reservations returns the number of active circuit relay reservations.
func (m *Metrics) Reservations() int64 { return m.reservations.Load() }

// Snapshot is the JSON-serialisable point-in-time view of metrics.
type Snapshot struct {
	PeerID           string    `json:"peer_id"`
	ListenAddrs      []string  `json:"listen_addrs"`
	ConnectedPeers   int64     `json:"connected_peers"`
	TotalConnections int64     `json:"total_connections"`
	Reservations     int64     `json:"reservations"`
	UptimeSeconds    int64     `json:"uptime_seconds"`
	StartedAt        time.Time `json:"started_at"`
}

// WriteStatus serialises the current state into the configured status file.
// It writes atomically (tmp file + rename) so readers never see a partial file.
func (m *Metrics) WriteStatus(snap Snapshot) error {
	snap.UptimeSeconds = int64(time.Since(m.startedAt).Seconds())
	snap.StartedAt = m.startedAt
	snap.ConnectedPeers = m.connectedPeers.Load()
	snap.TotalConnections = m.totalConnections.Load()
	snap.Reservations = m.reservations.Load()

	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal status: %w", err)
	}

	dir := filepath.Dir(m.statusFile)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create status dir: %w", err)
	}

	tmp := m.statusFile + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return fmt.Errorf("write status tmp: %w", err)
	}
	if err := os.Rename(tmp, m.statusFile); err != nil {
		return fmt.Errorf("rename status file: %w", err)
	}
	return nil
}

// StatusFile returns the configured status file path.
func (m *Metrics) StatusFile() string { return m.statusFile }
