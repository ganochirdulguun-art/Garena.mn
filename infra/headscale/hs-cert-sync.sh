#!/bin/bash
set -e
SRC="$(ls /var/lib/derper/certs/*sslip.io 2>/dev/null | head -1)"; [ -n "$SRC" ] || SRC="$(ls /var/lib/derper/certs/* | grep -v '+' | head -1)"
awk '/BEGIN.*PRIVATE KEY/,/END.*PRIVATE KEY/' "$SRC" > /etc/headscale/tls.key
awk '/BEGIN CERTIFICATE/,/END CERTIFICATE/' "$SRC" > /etc/headscale/tls.crt
chmod 600 /etc/headscale/tls.key
