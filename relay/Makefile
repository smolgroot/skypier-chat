BINARY    := skypier-relay
BUILD_DIR := dist
INSTALL   := /usr/local/bin
CONFIG    := /etc/skypier-relay
SYSTEMD   := /etc/systemd/system

.PHONY: build clean install uninstall

## build: compile the binary into dist/
build:
	@mkdir -p $(BUILD_DIR)
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" \
		-o $(BUILD_DIR)/$(BINARY) ./cmd/$(BINARY)
	@echo "Built $(BUILD_DIR)/$(BINARY)"

## install: build + install binary, config template, systemd unit
install: build
	@echo "Installing binary to $(INSTALL)/$(BINARY)"
	install -m 0755 $(BUILD_DIR)/$(BINARY) $(INSTALL)/$(BINARY)

	@echo "Installing config template to $(CONFIG)/config.example.yaml"
	@mkdir -p $(CONFIG)
	@if [ ! -f $(CONFIG)/config.yaml ]; then \
		install -m 0600 config.example.yaml $(CONFIG)/config.yaml; \
		echo "  Created $(CONFIG)/config.yaml (first run — edit before starting service)"; \
	else \
		echo "  Skipping: $(CONFIG)/config.yaml already exists"; \
	fi

	@echo "Installing systemd unit to $(SYSTEMD)/skypier-relay.service"
	install -m 0644 systemd/skypier-relay.service $(SYSTEMD)/skypier-relay.service

	@echo "Creating state directories"
	@mkdir -p /var/lib/skypier-relay /var/cache/skypier-relay/acme
	@chmod 700 /var/cache/skypier-relay/acme

	@echo ""
	@echo "Next steps:"
	@echo "  1. Edit $(CONFIG)/config.yaml (set dns_name, ensure DNS A record points here)"
	@echo "  2. systemctl daemon-reload"
	@echo "  3. systemctl enable --now skypier-relay"
	@echo "  4. systemctl status skypier-relay"
	@echo "  5. skypier-relay status  (shows peer ID + listen addrs once running)"

## uninstall: remove binary, unit, and config
uninstall:
	systemctl stop skypier-relay 2>/dev/null || true
	systemctl disable skypier-relay 2>/dev/null || true
	rm -f $(INSTALL)/$(BINARY)
	rm -f $(SYSTEMD)/skypier-relay.service
	@echo "Uninstalled.  Config and state directories left intact:"
	@echo "  $(CONFIG)"
	@echo "  /var/lib/skypier-relay"
	@echo "  /var/cache/skypier-relay"

## clean: remove build artifacts
clean:
	rm -rf $(BUILD_DIR)
