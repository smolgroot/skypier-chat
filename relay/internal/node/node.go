package node

import (
	"context"
	"crypto/tls"
	"fmt"
	"log"
	"time"

	"golang.org/x/crypto/acme/autocert"

	libp2p "github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	relayv2 "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
	ws "github.com/libp2p/go-libp2p/p2p/transport/websocket"
	ma "github.com/multiformats/go-multiaddr"

	"github.com/skypier/relay/internal/config"
	"github.com/skypier/relay/internal/metrics"
)

// Relay wraps a libp2p host and the relay service.
type Relay struct {
	Host    host.Host
	Metrics *metrics.Metrics
	dht     *dht.IpfsDHT
	relay   *relayv2.Relay
}

// New builds and starts the libp2p relay node.
func New(ctx context.Context, cfg *config.Config, priv crypto.PrivKey, m *metrics.Metrics) (*Relay, error) {
	// ── TLS via Let's Encrypt ACME (TLS-ALPN-01, no port 80 needed) ──────────
	acmeManager := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(cfg.DNSName),
		Cache:      autocert.DirCache(cfg.ACMECacheDir),
	}
	tlsCfg := acmeManager.TLSConfig()
	// Some clients may not send SNI. In that case, attempt certificate lookup
	// using the configured relay DNS name so handshakes can still succeed.
	tlsCfg.GetCertificate = func(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
		if hello == nil {
			cert, err := acmeManager.GetCertificate(hello)
			if err != nil {
				log.Printf("[relay] TLS cert lookup failed (nil client hello): %v", err)
			}
			return cert, err
		}

		requestedServerName := hello.ServerName
		lookupServerName := requestedServerName
		if lookupServerName == "" {
			lookupServerName = cfg.DNSName
		}

		helloCopy := *hello
		helloCopy.ServerName = lookupServerName

		cert, err := acmeManager.GetCertificate(&helloCopy)
		if err != nil {
			log.Printf("[relay] TLS cert lookup failed for requested_sni=%q lookup_sni=%q: %v", requestedServerName, lookupServerName, err)
		}
		return cert, err
	}

	// ── Parse listen multiaddr ────────────────────────────────────────────────
	listenMA, err := ma.NewMultiaddr(cfg.ListenAddr)
	if err != nil {
		return nil, fmt.Errorf("invalid listen_addr %q: %w", cfg.ListenAddr, err)
	}

	// ── Relay resource limits ─────────────────────────────────────────────────
	resources := relayv2.Resources{
		Limit: &relayv2.RelayLimit{
			Duration: cfg.CircuitDuration.Duration,
			Data:     int64(cfg.CircuitDataMB) * 1024 * 1024,
		},
		ReservationTTL:  cfg.ReservationTTL.Duration,
		MaxReservations: cfg.MaxReservations,
		MaxCircuits:     32, // per-peer concurrent circuits
		BufferSize:      4096,
	}

	// ── Build libp2p host ─────────────────────────────────────────────────────
	h, err := libp2p.New(
		libp2p.Identity(priv),
		libp2p.ListenAddrs(listenMA),
		libp2p.Transport(ws.New, ws.WithTLSConfig(tlsCfg)),
		libp2p.EnableHolePunching(),
		libp2p.UserAgent("skypier-relay/1.0.0"),
		libp2p.DisableRelay(), // relay server is created explicitly below via relayv2.New
	)
	if err != nil {
		return nil, fmt.Errorf("build libp2p host: %w", err)
	}

	// ── DHT in server mode ────────────────────────────────────────────────────
	// Bootstrap peers are provided so the relay joins the wider libp2p DHT and
	// is reachable via peer routing even when clients only know the relay's
	// peer ID (not its current multiaddr).
	kadDHT, err := dht.New(ctx, h, dht.Mode(dht.ModeServer), dht.BootstrapPeers(dht.GetDefaultBootstrapPeerAddrInfos()...))
	if err != nil {
		h.Close()
		return nil, fmt.Errorf("build DHT: %w", err)
	}
	if err := kadDHT.Bootstrap(ctx); err != nil {
		log.Printf("[relay] DHT bootstrap warning: %v", err)
	}

	// ── Standalone relay service (gives us access to Stat()) ─────────────────
	// EnableRelayService embeds a relay inside the host option chain, but does
	// not expose a handle. We create a separate relayv2.Relay that we control
	// explicitly and close on shutdown.
	rv2, err := relayv2.New(h, relayv2.WithResources(resources))
	if err != nil {
		h.Close()
		return nil, fmt.Errorf("relay service: %w", err)
	}

	r := &Relay{Host: h, Metrics: m, dht: kadDHT, relay: rv2}

	// ── Peer connect / disconnect notifications ───────────────────────────────
	h.Network().Notify(&network.NotifyBundle{
		ConnectedF: func(_ network.Network, _ network.Conn) {
			m.PeerConnected()
		},
		DisconnectedF: func(_ network.Network, _ network.Conn) {
			m.PeerDisconnected()
		},
	})

	return r, nil
}

// LogAddrs prints all listen addresses to stdout.
func (r *Relay) LogAddrs() {
	pid := r.Host.ID().String()
	log.Printf("[relay] peer ID: %s", pid)
	for _, addr := range r.Host.Addrs() {
		log.Printf("[relay] listening on %s/p2p/%s", addr, pid)
	}
}

// PollMetrics starts a background goroutine that updates the reservation count
// from relay.Stat() and writes the status file every interval.
func (r *Relay) PollMetrics(ctx context.Context, interval time.Duration, extraAddrs []string) {
	peerID := r.Host.ID().String()
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				var addrs []string
				for _, a := range r.Host.Addrs() {
					addrs = append(addrs, fmt.Sprintf("%s/p2p/%s", a, peerID))
				}
				addrs = append(addrs, extraAddrs...)

				if err := r.Metrics.WriteStatus(metrics.Snapshot{
					PeerID:      peerID,
					ListenAddrs: addrs,
				}); err != nil {
					log.Printf("[relay] write status: %v", err)
				}

				log.Printf("[relay] peers=%d reservations=%d",
					r.Metrics.ConnectedPeers(), r.Metrics.Reservations())
			}
		}
	}()
}

// Close shuts down the relay gracefully.
func (r *Relay) Close() error {
	r.relay.Close()
	if err := r.dht.Close(); err != nil {
		log.Printf("[relay] DHT close: %v", err)
	}
	return r.Host.Close()
}
