package config

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"gopkg.in/yaml.v3"
)

// Config holds all relay configuration, mapped 1:1 to the YAML file.
type Config struct {
	// DNSName is the fully-qualified domain name used for ACME TLS and the
	// announced WebSocket multiaddr (e.g. relay.skypier.chat).
	DNSName string `yaml:"dns_name"`

	// ListenAddr is the libp2p multiaddr to listen on.
	// Default: /ip4/0.0.0.0/tcp/443/tls/ws
	ListenAddr string `yaml:"listen_addr"`

	// WebTransportListenAddr is the libp2p WebTransport listen multiaddr.
	// Default: /ip4/0.0.0.0/udp/443/quic-v1/webtransport
	// Set empty string to disable WebTransport listener.
	WebTransportListenAddr string `yaml:"webtransport_listen_addr"`

	// IdentityKey is the base64-encoded protobuf-serialised Ed25519 private key.
	// Leave empty on first run — a key is generated and written back automatically.
	IdentityKey string `yaml:"identity_key"`

	// ACMECacheDir is the directory where autocert stores Let's Encrypt certs.
	// Default: /var/cache/skypier-relay/acme
	ACMECacheDir string `yaml:"acme_cache_dir"`

	// MaxReservations is the maximum number of simultaneous relay reservations.
	// Default: 512
	MaxReservations int `yaml:"max_reservations"`

	// ReservationTTL is how long a reservation stays valid before expiry.
	// Default: 1h
	ReservationTTL Duration `yaml:"reservation_ttl"`

	// CircuitDuration is the maximum lifetime of a single relayed connection.
	// Default: 15m  (libp2p default is 2m — we raise it significantly)
	CircuitDuration Duration `yaml:"circuit_duration"`

	// CircuitDataMB is the maximum data transferred per relayed circuit (megabytes).
	// Default: 512
	CircuitDataMB int `yaml:"circuit_data_mb"`

	// StatusFile is the path where the JSON status snapshot is written.
	// Default: /run/skypier-relay/status.json
	StatusFile string `yaml:"status_file"`
}

// Duration is a time.Duration that marshals/unmarshals as a human-readable
// string in YAML (e.g. "15m", "1h").
type Duration struct{ time.Duration }

func (d Duration) MarshalYAML() (interface{}, error) {
	return d.Duration.String(), nil
}
func (d *Duration) UnmarshalYAML(value *yaml.Node) error {
	dur, err := time.ParseDuration(value.Value)
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", value.Value, err)
	}
	d.Duration = dur
	return nil
}

// Defaults returns a Config pre-filled with sensible defaults.
func Defaults() Config {
	return Config{
		DNSName:         "relay.skypier.chat",
		ListenAddr:      "/ip4/0.0.0.0/tcp/443/tls/ws",
		WebTransportListenAddr: "/ip4/0.0.0.0/udp/443/quic-v1/webtransport",
		ACMECacheDir:    "/var/cache/skypier-relay/acme",
		MaxReservations: 512,
		ReservationTTL:  Duration{time.Hour},
		CircuitDuration: Duration{15 * time.Minute},
		CircuitDataMB:   512,
		StatusFile:      "/run/skypier-relay/status.json",
	}
}

// Load reads a YAML config file. Missing fields fall back to Defaults.
// If the file does not exist, defaults are returned (first-run mode).
func Load(path string) (*Config, error) {
	cfg := Defaults()

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return &cfg, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	return &cfg, nil
}

// Save writes the config back to the YAML file, preserving the file if it exists.
func Save(path string, cfg *Config) error {
	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}

// EnsureIdentity generates an Ed25519 key if cfg.IdentityKey is empty,
// writes it back to the config file, and returns the private key.
func EnsureIdentity(path string, cfg *Config) (crypto.PrivKey, error) {
	if cfg.IdentityKey != "" {
		return decodeKey(cfg.IdentityKey)
	}

	// First run: generate and persist.
	priv, _, err := crypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generate identity: %w", err)
	}
	raw, err := crypto.MarshalPrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("marshal identity: %w", err)
	}
	cfg.IdentityKey = base64.StdEncoding.EncodeToString(raw)
	if err := Save(path, cfg); err != nil {
		return nil, fmt.Errorf("save identity to config: %w", err)
	}
	return priv, nil
}

func decodeKey(b64 string) (crypto.PrivKey, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("decode identity_key: %w", err)
	}
	priv, err := crypto.UnmarshalPrivateKey(raw)
	if err != nil {
		return nil, fmt.Errorf("unmarshal identity_key: %w", err)
	}
	return priv, nil
}
