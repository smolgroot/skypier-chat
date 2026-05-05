package node

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/skypier/relay/internal/config"
	"github.com/skypier/relay/internal/mailbox"
)

type unreadCheckResponse struct {
	RecipientPeerID string `json:"recipientPeerId"`
	HasUnread       bool   `json:"hasUnread"`
	UnreadCount     int    `json:"unreadCount"`
	CheckedAt       string `json:"checkedAt"`
}

// StartUnreadCheckHTTP starts a minimal unread-check HTTP endpoint used by the
// web service worker. The endpoint intentionally exposes metadata only.
func StartUnreadCheckHTTP(ctx context.Context, relay *Relay, cfg *config.Config) error {
	if !cfg.UnreadCheckHTTPEnabled {
		return nil
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/mailbox/push-subscribe", func(w http.ResponseWriter, req *http.Request) {
		setUnreadCheckCORSHeaders(w, cfg.UnreadCheckHTTPCORSAllowOrigin)
		if req.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if req.Method != http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
			return
		}

		var payload struct {
			RecipientPeerID string `json:"recipientPeerId"`
			PushSubscription mailbox.PushSubscription `json:"pushSubscription"`
		}

		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid payload"})
			return
		}

		if payload.RecipientPeerID == "" || payload.PushSubscription.Endpoint == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "missing peer id or endpoint"})
			return
		}

		relay.mailbox.SavePushSubscription(payload.RecipientPeerID, payload.PushSubscription)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})

	mux.HandleFunc("/api/mailbox/unread", func(w http.ResponseWriter, req *http.Request) {
		setUnreadCheckCORSHeaders(w, cfg.UnreadCheckHTTPCORSAllowOrigin)
		if req.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if req.Method != http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusMethodNotAllowed)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
			return
		}

		if cfg.UnreadCheckHTTPToken != "" {
			token := strings.TrimSpace(req.Header.Get("X-Skypier-Unread-Token"))
			if token == "" || token != cfg.UnreadCheckHTTPToken {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
				return
			}
		}

		recipientPeerID := strings.TrimSpace(req.URL.Query().Get("recipientPeerId"))
		if recipientPeerID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "missing recipientPeerId"})
			return
		}

		if relay.mailbox == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "mailbox disabled"})
			return
		}

		now := time.Now().UTC()
		unreadCount := relay.mailbox.UnreadCount(recipientPeerID, now)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(unreadCheckResponse{
			RecipientPeerID: recipientPeerID,
			HasUnread:       unreadCount > 0,
			UnreadCount:     unreadCount,
			CheckedAt:       now.Format(time.RFC3339),
		})
	})

	server := &http.Server{
		Addr:              cfg.UnreadCheckHTTPListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	go func() {
		log.Printf("[relay] unread-check HTTP listening on %s", cfg.UnreadCheckHTTPListenAddr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("[relay] unread-check HTTP server stopped: %v", err)
		}
	}()

	return nil
}

func setUnreadCheckCORSHeaders(w http.ResponseWriter, allowOrigin string) {
	origin := strings.TrimSpace(allowOrigin)
	if origin == "" {
		origin = "*"
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Skypier-Unread-Token")
}
