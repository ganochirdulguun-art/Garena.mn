#!/usr/bin/env bash
# Garena.mn DERP relay + нөөц TCP relay — Ubuntu 22.04/24.04 (Oracle ARM/AMD). root-оор ажиллуулна.
#   DERP_HOST=derp1.garena.mn HEADSCALE_URL=https://hs.garena.mn RELAY_KEY=... bash setup-derp.sh
# Нээх порт (OCI Security List + ufw): TCP 80,443,7000 · UDP 3478. Домэйн A бичлэг серверийн IP рүү заасан байх (LetsEncrypt).
set -euo pipefail
DERP_HOST="${DERP_HOST:?derp1.garena.mn}"; HEADSCALE_URL="${HEADSCALE_URL:?https://hs.garena.mn}"
GO_VER="${GO_VER:-1.24.7}"; ARCH=$(uname -m); case "$ARCH" in aarch64) GOARCH=arm64;; x86_64) GOARCH=amd64;; *) echo "arch?"; exit 1;; esac
apt-get update -qq && apt-get install -y -qq curl ufw git ca-certificates nodejs npm >/dev/null
# --- Go + derper (BSD-3) ---
if ! /usr/local/go/bin/go version 2>/dev/null | grep -q "$GO_VER"; then
  curl -fsSL "https://go.dev/dl/go${GO_VER}.linux-${GOARCH}.tar.gz" -o /tmp/go.tgz && rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tgz
fi
export PATH=/usr/local/go/bin:/root/go/bin:$PATH GOPATH=/root/go
go install tailscale.com/cmd/derper@latest
install -m 0755 /root/go/bin/derper /usr/local/bin/derper
mkdir -p /var/lib/derper/certs
cat >/etc/systemd/system/garena-derp.service <<UNIT
[Unit]
Description=Garena.mn DERP relay (${DERP_HOST})
After=network-online.target
[Service]
ExecStart=/usr/local/bin/derper --hostname=${DERP_HOST} --certmode=letsencrypt --certdir=/var/lib/derper/certs -a :443 --http-port=80 --stun --stun-port=3478 --verify-client-url=${HEADSCALE_URL}/verify --verify-client-url-fail-open=false
Restart=always
RestartSec=3
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
UNIT
# --- нөөц TCP relay (одоогийн hostbot/relay.js, capture-гүй) ---
mkdir -p /opt/garena-relay && cp -f "$(dirname "$0")/../../hostbot/relay.js" /opt/garena-relay/relay.js 2>/dev/null || true
cat >/etc/systemd/system/garena-relay.service <<UNIT
[Unit]
Description=Garena.mn нөөц TCP relay :7000
After=network-online.target
[Service]
Environment=RELAY_PORT=7000 RELAY_CAPTURE=0 PUBLIC_IP=$(curl -fsS https://api.ipify.org || echo 0.0.0.0) RELAY_KEY=${RELAY_KEY:-}
ExecStart=/usr/bin/node /opt/garena-relay/relay.js
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
UNIT
# --- firewall (OCI-ийн iptables дүрэм ч байдаг) ---
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 7000/tcp; ufw allow 3478/udp; ufw --force enable
iptables -I INPUT -p tcp --dport 443 -j ACCEPT; iptables -I INPUT -p tcp --dport 80 -j ACCEPT; iptables -I INPUT -p tcp --dport 7000 -j ACCEPT; iptables -I INPUT -p udp --dport 3478 -j ACCEPT
command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
systemctl daemon-reload && systemctl enable --now garena-derp garena-relay
sleep 3; systemctl --no-pager --lines=5 status garena-derp garena-relay || true
echo "DONE: https://${DERP_HOST}/ (derp) · tcp/7000 (relay) · udp/3478 (stun)"
