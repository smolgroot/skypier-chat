package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/spf13/cobra"

	"github.com/skypier/relay/internal/config"
	"github.com/skypier/relay/internal/metrics"
	"github.com/skypier/relay/internal/node"
)

func main() {
	if err := rootCmd().Execute(); err != nil {
		os.Exit(1)
	}
}

// ── Root command ──────────────────────────────────────────────────────────────

func rootCmd() *cobra.Command {
	root := &cobra.Command{
		Use:   "skypier-relay",
		Short: "Skypier libp2p Circuit Relay v2 server",
	}
	root.AddCommand(serveCmd(), statusCmd(), keygenCmd())
	return root
}

// ── serve ─────────────────────────────────────────────────────────────────────

func serveCmd() *cobra.Command {
	var cfgPath string

	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Start the relay server",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, err := config.Load(cfgPath)
			if err != nil {
				return fmt.Errorf("load config: %w", err)
			}

			// Ensure / generate identity key — writes back to config file if new.
			priv, err := config.EnsureIdentity(cfgPath, cfg)
			if err != nil {
				return fmt.Errorf("identity: %w", err)
			}

			m := metrics.New(cfg.StatusFile)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			r, err := node.New(ctx, cfg, priv, m)
			if err != nil {
				return fmt.Errorf("start node: %w", err)
			}
			defer func() {
				log.Println("[relay] shutting down…")
				_ = r.Close()
			}()

			r.LogAddrs()

			// Build the human-friendly announced multiaddr for logging.
			if cfg.DNSName != "" {
				peerIDStr := r.Host.ID().String()
				log.Printf("[relay] announce multiaddr: /dns4/%s/tcp/443/tls/ws/p2p/%s", cfg.DNSName, peerIDStr)
				log.Printf("[relay] circuit listen:      /dns4/%s/tcp/443/tls/ws/p2p/%s/p2p-circuit", cfg.DNSName, peerIDStr)
			}

			// Start periodic metrics polling + status file writer.
			r.PollMetrics(ctx, 30*time.Second, nil)

			// Block until SIGTERM / SIGINT.
			stop := make(chan os.Signal, 1)
			signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
			<-stop
			return nil
		},
	}

	cmd.Flags().StringVarP(&cfgPath, "config", "c", "/etc/skypier-relay/config.yaml",
		"Path to YAML config file")
	return cmd
}

// ── status ────────────────────────────────────────────────────────────────────

func statusCmd() *cobra.Command {
	var statusFile string

	cmd := &cobra.Command{
		Use:   "status",
		Short: "Print relay status (reads status file written by serve)",
		RunE: func(cmd *cobra.Command, _ []string) error {
			data, err := os.ReadFile(statusFile)
			if err != nil {
				return fmt.Errorf("read status file %q: %w\n\nMake sure 'serve' is running.", statusFile, err)
			}

			var snap metrics.Snapshot
			if err := json.Unmarshal(data, &snap); err != nil {
				return fmt.Errorf("parse status file: %w", err)
			}

			w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
			fmt.Fprintln(w, "Skypier Relay Status")
			fmt.Fprintln(w, "────────────────────────────────────────────────────")
			fmt.Fprintf(w, "Peer ID\t%s\n", snap.PeerID)
			fmt.Fprintf(w, "Uptime\t%s\n", (time.Duration(snap.UptimeSeconds) * time.Second).String())
			fmt.Fprintf(w, "Started\t%s\n", snap.StartedAt.Format(time.RFC3339))
			fmt.Fprintf(w, "Connected peers\t%d\n", snap.ConnectedPeers)
			fmt.Fprintf(w, "Total connections\t%d\n", snap.TotalConnections)
			fmt.Fprintf(w, "Active reservations\t%d\n", snap.Reservations)
			fmt.Fprintln(w, "\nListen addresses:")
			for _, addr := range snap.ListenAddrs {
				fmt.Fprintf(w, "  %s\n", addr)
			}
			return w.Flush()
		},
	}

	cmd.Flags().StringVarP(&statusFile, "status-file", "s", "/run/skypier-relay/status.json",
		"Path to the JSON status file written by serve")
	return cmd
}

// ── keygen ────────────────────────────────────────────────────────────────────

func keygenCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "keygen",
		Short: "Generate a new Ed25519 identity key and print config snippet",
		RunE: func(cmd *cobra.Command, _ []string) error {
			priv, _, err := crypto.GenerateEd25519Key(rand.Reader)
			if err != nil {
				return fmt.Errorf("generate key: %w", err)
			}
			raw, err := crypto.MarshalPrivateKey(priv)
			if err != nil {
				return fmt.Errorf("marshal key: %w", err)
			}
			b64 := base64.StdEncoding.EncodeToString(raw)

			pub := priv.GetPublic()
			pid, err := peerIDFromPubKey(pub)
			if err != nil {
				return fmt.Errorf("derive peer ID: %w", err)
			}

			fmt.Printf("# Paste the following into your config.yaml:\n")
			fmt.Printf("identity_key: %s\n\n", b64)
			fmt.Printf("# Your relay peer ID (add to JS bootstrap list):\n")
			fmt.Printf("# peer_id: %s\n", pid)
			fmt.Printf("# Announce multiaddr (replace <dns_name> with your domain):\n")
			fmt.Printf("# /dns4/<dns_name>/tcp/443/tls/ws/p2p/%s\n", pid)
			return nil
		},
	}
}

// peerIDFromPubKey derives the peer ID string from a public key.
func peerIDFromPubKey(pub crypto.PubKey) (string, error) {
	pid, err := peer.IDFromPublicKey(pub)
	if err != nil {
		return "", err
	}
	return pid.String(), nil
}
