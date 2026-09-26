#!/busybox/sh
# Railway дээр shell-гүй distroless тул CLI-г эндээс: serve эхлүүлээд socket гармагц хэрэглэгч+API түлхүүр (нэг удаа) үүсгэнэ.
set -e
headscale serve &
PID=$!
i=0
while [ ! -S /var/run/headscale/headscale.sock ] && [ $i -lt 60 ]; do sleep 1; i=$((i+1)); done
headscale users create players 2>/dev/null || true
if [ ! -s /var/lib/headscale/apikey.txt ]; then
  headscale apikeys create --expiration 3650d > /var/lib/headscale/apikey.txt 2>/dev/null && echo "[entrypoint] API key үүсгэв → /var/lib/headscale/apikey.txt"
fi
headscale users list || true
wait $PID
