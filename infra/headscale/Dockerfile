# Headscale (Tailscale control server, BSD-3) — Railway service "headscale"
# Volume: /var/lib/headscale (SQLite + noise key + apikey.txt). Railway env: PORT=8080, RAILWAY_DOCKERFILE_PATH=infra/headscale/Dockerfile
FROM headscale/headscale:v0.29.4-debug
COPY infra/headscale/config.yaml  /etc/headscale/config.yaml
COPY infra/headscale/derp.yaml    /etc/headscale/derp.yaml
COPY infra/headscale/entrypoint.sh /entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/busybox/sh", "/entrypoint.sh"]
