#!/usr/bin/env bash
# Headscale-ийг DERP серверт (Oracle) суулгах — derper-ийн Let's Encrypt сертификатыг хуваалцаж :8443 дээр TLS.
# Railway дээр АЖИЛЛАХГҮЙ: Railway proxy Tailscale-ийн ts2021 HTTP Upgrade-ийг нэвтрүүлдэггүй («no upgrade header in TS2021 request»).
#   sudo HS_HOST=140-245-104-214.sslip.io bash oracle-install.sh   (энэ хавтасны oracle-config.yaml, derp.yaml, hs-cert-sync.sh хамт)
set -euo pipefail
HS_HOST="${HS_HOST:?}"; V="${HS_VERSION:-0.29.4}"; D="$(cd "$(dirname "$0")" && pwd)"
[ -x /usr/local/bin/headscale ] || { curl -fsSL -o /usr/local/bin/headscale "https://github.com/juanfont/headscale/releases/download/v${V}/headscale_${V}_linux_$(dpkg --print-architecture)"; chmod +x /usr/local/bin/headscale; }
mkdir -p /etc/headscale /var/lib/headscale
install -m 0755 "$D/hs-cert-sync.sh" /usr/local/bin/hs-cert-sync.sh && /usr/local/bin/hs-cert-sync.sh
echo "17 3 * * * root /usr/local/bin/hs-cert-sync.sh && systemctl restart headscale" > /etc/cron.d/hs-cert-sync
sed "s#__HS_HOST__#${HS_HOST}#" "$D/oracle-config.yaml" > /etc/headscale/config.yaml
cp "$D/derp.yaml" /etc/headscale/derp.yaml
cat >/etc/systemd/system/headscale.service <<U
[Unit]
Description=Garena.mn Headscale (Tailscale control server)
After=network-online.target garena-derp.service
[Service]
ExecStart=/usr/local/bin/headscale serve
Restart=always
RestartSec=3
RuntimeDirectory=headscale
[Install]
WantedBy=multi-user.target
U
ufw allow 8443/tcp >/dev/null; iptables -I INPUT -p tcp --dport 8443 -j ACCEPT; netfilter-persistent save >/dev/null 2>&1 || true
systemctl daemon-reload && systemctl enable --now headscale && sleep 2 && systemctl is-active headscale
headscale users create players 2>/dev/null || true
echo "API key (платформ env HEADSCALE_API_KEY):"; headscale apikeys create --expiration 3650d
