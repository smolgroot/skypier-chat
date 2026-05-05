package node

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"time"

	"github.com/SherClockHolmes/webpush-go"
	"golang.org/x/crypto/acme/autocert"

	libp2p "github.com/libp2p/go-libp2p"
	dht "github.com/libp2p/go-libp2p-kad-dht"
	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/network"
	pbv2 "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/pb"
	relayv2 "github.com/libp2p/go-libp2p/p2p/protocol/circuitv2/relay"
	ws "github.com/libp2p/go-libp2p/p2p/transport/websocket"
	wt "github.com/libp2p/go-libp2p/p2p/transport/webtransport"
	"github.com/libp2p/go-msgio"
	ma "github.com/multiformats/go-multiaddr"

	"github.com/skypier/relay/internal/config"
	"github.com/skypier/relay/internal/mailbox"
	"github.com/skypier/relay/internal/metrics"
)

// Relay wraps a libp2p host and the relay service.
type Relay struct {
	Host    host.Host
	Metrics *metrics.Metrics
	dht     *dht.IpfsDHT
	relay   *relayv2.Relay
	mailbox *mailbox.Store
}

const (
	mailboxEnqueueProtocol = "/skypier/chat/1.1.0/mailbox/enqueue"
	mailboxPullProtocol    = "/skypier/chat/1.1.0/mailbox/pull"
	mailboxAckProtocol     = "/skypier/chat/1.1.0/mailbox/ack"
	maxMailboxPayloadBytes = 2 * 1024 * 1024
)

type relayMetricsTracer struct {
	m *metrics.Metrics
}

func newRelayMetricsTracer(m *metrics.Metrics) *relayMetricsTracer {
	return &relayMetricsTracer{m: m}
}

func (t *relayMetricsTracer) RelayStatus(enabled bool) {}

func (t *relayMetricsTracer) ConnectionOpened() {}

func (t *relayMetricsTracer) ConnectionClosed(_ time.Duration) {}

func (t *relayMetricsTracer) ConnectionRequestHandled(status pbv2.Status) {
	if status == pbv2.Status_NO_RESERVATION {
		log.Printf("[relay] connect request denied: no reservation")
	}
}

func (t *relayMetricsTracer) ReservationAllowed(isRenewal bool) {
	if !isRenewal {
		t.m.AddReservations(1)
		log.Printf("[relay] reservation opened (active=%d)", t.m.Reservations())
	}
}

func (t *relayMetricsTracer) ReservationClosed(cnt int) {
	if cnt <= 0 {
		return
	}
	t.m.AddReservations(-int64(cnt))
	log.Printf("[relay] reservation closed count=%d (active=%d)", cnt, t.m.Reservations())
}

func (t *relayMetricsTracer) ReservationRequestHandled(status pbv2.Status) {
	if status != pbv2.Status_OK {
		log.Printf("[relay] reservation request rejected: %s", status.String())
	}
}

func (t *relayMetricsTracer) BytesTransferred(_ int) {}

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
			hello = &tls.ClientHelloInfo{ServerName: cfg.DNSName}
			cert, err := acmeManager.GetCertificate(hello)
			if err != nil {
				log.Printf("[relay] TLS cert lookup failed (nil client hello): %v", err)
			}
			return cert, err
		}

		requestedServerName := hello.ServerName
		lookupServerName := requestedServerName
		if lookupServerName == "" || net.ParseIP(lookupServerName) != nil || lookupServerName != cfg.DNSName {
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

	// ── Parse listen multiaddrs ───────────────────────────────────────────────
	listenMA, err := ma.NewMultiaddr(cfg.ListenAddr)
	if err != nil {
		return nil, fmt.Errorf("invalid listen_addr %q: %w", cfg.ListenAddr, err)
	}

	listenAddrs := []ma.Multiaddr{listenMA}
	if cfg.WebTransportListenAddr != "" {
		wtMA, wtErr := ma.NewMultiaddr(cfg.WebTransportListenAddr)
		if wtErr != nil {
			return nil, fmt.Errorf("invalid webtransport_listen_addr %q: %w", cfg.WebTransportListenAddr, wtErr)
		}
		listenAddrs = append(listenAddrs, wtMA)
	}

	// ── Publicly announced relay addresses ─────────────────────────────────────
	// Circuit-reservation responses include relay addresses derived from Host.Addrs().
	// If we only advertise listen addrs like 0.0.0.0, clients may receive unusable
	// reservation addresses and appear offline (no effective /p2p-circuit reachability).
	announcedAddrs := make([]ma.Multiaddr, 0, 2)
	if cfg.DNSName != "" {
		if wsPublicMA, wsErr := ma.NewMultiaddr(fmt.Sprintf("/dns4/%s/tcp/443/tls/ws", cfg.DNSName)); wsErr == nil {
			announcedAddrs = append(announcedAddrs, wsPublicMA)
		}
		if cfg.WebTransportListenAddr != "" {
			if wtPublicMA, wtErr := ma.NewMultiaddr(fmt.Sprintf("/dns4/%s/udp/443/quic-v1/webtransport", cfg.DNSName)); wtErr == nil {
				announcedAddrs = append(announcedAddrs, wtPublicMA)
			}
		}
	}

	// ── Relay resource limits ─────────────────────────────────────────────────
	// Start from defaults so that MaxReservationsPerIP / MaxReservationsPerASN
	// / MaxReservationsPerPeer are populated correctly. Constructing Resources{}
	// from scratch leaves those fields at 0, which makes len(x) >= 0 always
	// true and causes every RESERVE request to be refused immediately.
	resources := relayv2.DefaultResources()
	resources.Limit = &relayv2.RelayLimit{
		Duration: cfg.CircuitDuration.Duration,
		Data:     int64(cfg.CircuitDataMB) * 1024 * 1024,
	}
	resources.ReservationTTL = cfg.ReservationTTL.Duration
	resources.MaxReservations = cfg.MaxReservations
	resources.MaxCircuits = 64 // per-relay concurrent circuits
	resources.BufferSize = 4096

	// ── Build libp2p host ─────────────────────────────────────────────────────
	h, err := libp2p.New(
		libp2p.Identity(priv),
		libp2p.ListenAddrs(listenAddrs...),
		libp2p.AddrsFactory(func(existing []ma.Multiaddr) []ma.Multiaddr {
			if len(announcedAddrs) == 0 {
				return existing
			}
			// Force stable public DNS addresses for advertisements and reservation vouchers.
			return announcedAddrs
		}),
		libp2p.Transport(ws.New, ws.WithTLSConfig(tlsCfg)),
		libp2p.Transport(wt.New),
		libp2p.EnableHolePunching(),
		libp2p.UserAgent("skypier-relay/1.0.0"),
		libp2p.DisableRelay(), // relay server is created explicitly below via relayv2.New
		// Disable the auto-scaled resource manager. On a VPS the default system-
		// derived limits are too low for circuit-relay-v2: the resource manager
		// silently resets RESERVE streams before they reach the relay handler,
		// resulting in 0 reservations even when peers are connected. A dedicated
		// relay has no need for per-protocol stream throttling.
		libp2p.ResourceManager(&network.NullResourceManager{}),
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
	rv2, err := relayv2.New(
		h,
		relayv2.WithResources(resources),
		relayv2.WithMetricsTracer(newRelayMetricsTracer(m)),
	)
	if err != nil {
		h.Close()
		return nil, fmt.Errorf("relay service: %w", err)
	}

	var mailboxStore *mailbox.Store
	if cfg.MailboxEnabled {
		mailboxStore = mailbox.NewStore(cfg.MailboxMaxPerRecipient, cfg.MailboxDefaultTTL.Duration)
		registerMailboxHandlers(h, mailboxStore, cfg)
		log.Printf("[relay] mailbox enabled (max_per_recipient=%d ttl=%s)", cfg.MailboxMaxPerRecipient, cfg.MailboxDefaultTTL.Duration)
	}

	r := &Relay{Host: h, Metrics: m, dht: kadDHT, relay: rv2, mailbox: mailboxStore}

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

				var mailboxMessages int64
				var mailboxRecipients int64
				if r.mailbox != nil {
					mailboxMessages, mailboxRecipients = r.mailbox.Stats(time.Now().UTC())
				}

				// Reservation count is tracked from relay lifecycle callbacks via
				// relayv2.WithMetricsTracer(newRelayMetricsTracer(...)).
				if err := r.Metrics.WriteStatus(metrics.Snapshot{
					PeerID:            peerID,
					ListenAddrs:       addrs,
					MailboxMessages:   mailboxMessages,
					MailboxRecipients: mailboxRecipients,
				}); err != nil {
					log.Printf("[relay] write status: %v", err)
				}

				log.Printf("[relay] peers=%d reservations=%d mailbox_messages=%d mailbox_recipients=%d",
					r.Metrics.ConnectedPeers(), r.Metrics.Reservations(), mailboxMessages, mailboxRecipients)
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

func registerMailboxHandlers(h host.Host, store *mailbox.Store, cfg *config.Config) {
	h.SetStreamHandler(mailboxEnqueueProtocol, func(stream network.Stream) {
		defer stream.Close()

		var req mailbox.EnqueueRequest
		if err := readJSONFromStream(stream, &req); err != nil {
			log.Printf("[relay] mailbox enqueue decode error: %v", err)
			_ = writeJSONToStream(stream, mailbox.EnqueueResponse{Accepted: false, Reason: "invalid request"})
			return
		}

		requestingPeer := stream.Conn().RemotePeer().String()
		if req.Envelope.SenderPeerID == "" {
			req.Envelope.SenderPeerID = requestingPeer
		}
		if req.Envelope.SenderPeerID != requestingPeer {
			_ = writeJSONToStream(stream, mailbox.EnqueueResponse{Accepted: false, Reason: "sender peer mismatch"})
			return
		}

		now := time.Now().UTC()
		accepted, reason, queueDepth, expiresAt := store.Enqueue(req.Envelope, now)

		// Trigger Web Push Notification if accepted and recipient has a subscription
		if accepted && cfg.WebPushVapidPrivateKey != "" {
			if sub, ok := store.GetPushSubscription(req.Envelope.RecipientPeerID); ok {
				go func(recipientID string, subscription mailbox.PushSubscription) {
					// We construct generic notification to avoid leaking PII or message details to Push providers
					pushSub := &webpush.Subscription{
						Endpoint: subscription.Endpoint,
						Keys: webpush.Keys{
							P256dh: subscription.Keys.P256dh,
							Auth:   subscription.Keys.Auth,
						},
					}

					resp, err := webpush.SendNotification([]byte(`{"type":"NEW_MESSAGE"}`), pushSub, &webpush.Options{
						VAPIDPublicKey:  cfg.WebPushVapidPublicKey,
						VAPIDPrivateKey: cfg.WebPushVapidPrivateKey,
						Subscriber:      cfg.WebPushContact,
						TTL:             86400,
					})

					if err != nil {
						log.Printf("[relay] Web Push error for %s: %v", recipientID, err)
					} else {
						defer resp.Body.Close()
						if resp.StatusCode >= 400 {
							log.Printf("[relay] Web Push failed for %s: status %d", recipientID, resp.StatusCode)
						} else {
							log.Printf("[relay] Web Push success for %s", recipientID)
						}
					}
				}(req.Envelope.RecipientPeerID, sub)
			}
		}

		_ = writeJSONToStream(stream, mailbox.EnqueueResponse{
			Accepted:   accepted,
			Reason:     reason,
			QueueDepth: queueDepth,
			ExpiresAt:  expiresAt,
		})
	})

	h.SetStreamHandler(mailboxPullProtocol, func(stream network.Stream) {
		defer stream.Close()

		var req mailbox.PullRequest
		if err := readJSONFromStream(stream, &req); err != nil {
			log.Printf("[relay] mailbox pull decode error: %v", err)
			_ = writeJSONToStream(stream, mailbox.PullResponse{Items: []mailbox.RelayMailboxEnvelope{}})
			return
		}

		requestingPeer := stream.Conn().RemotePeer().String()
		if req.RecipientPeerID == "" || req.RecipientPeerID != requestingPeer {
			_ = writeJSONToStream(stream, mailbox.PullResponse{Items: []mailbox.RelayMailboxEnvelope{}})
			return
		}

		items, nextCursor := store.Pull(req.RecipientPeerID, req.Limit, req.AfterCursor, time.Now().UTC())
		_ = writeJSONToStream(stream, mailbox.PullResponse{Items: items, NextCursor: nextCursor})
	})

	h.SetStreamHandler(mailboxAckProtocol, func(stream network.Stream) {
		defer stream.Close()

		var req mailbox.AckRequest
		if err := readJSONFromStream(stream, &req); err != nil {
			log.Printf("[relay] mailbox ack decode error: %v", err)
			_ = writeJSONToStream(stream, mailbox.AckResponse{Acked: []string{}, Missing: []string{}})
			return
		}

		requestingPeer := stream.Conn().RemotePeer().String()
		if req.RecipientPeerID == "" || req.RecipientPeerID != requestingPeer {
			_ = writeJSONToStream(stream, mailbox.AckResponse{Acked: []string{}, Missing: req.EnvelopeIDs})
			return
		}

		acked, missing := store.Ack(req.RecipientPeerID, req.EnvelopeIDs, time.Now().UTC())
		_ = writeJSONToStream(stream, mailbox.AckResponse{Acked: acked, Missing: missing})
	})
}

func readJSONFromStream(stream network.Stream, target any) error {
	reader := msgio.NewVarintReaderSize(stream, maxMailboxPayloadBytes)

	msg, err := reader.ReadMsg()
	if err != nil {
		if err == io.EOF {
			return fmt.Errorf("empty request")
		}
		return err
	}

	if len(msg) == 0 {
		reader.ReleaseMsg(msg)
		return fmt.Errorf("empty request")
	}

	if err := json.Unmarshal(msg, target); err != nil {
		reader.ReleaseMsg(msg)
		return err
	}

	reader.ReleaseMsg(msg)

	return nil
}

func writeJSONToStream(stream network.Stream, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	writer := msgio.NewVarintWriter(stream)
	if err := writer.WriteMsg(encoded); err != nil {
		return err
	}

	return nil
}
