# Headscale (Railway)
1. `railway link` → Garena.mn project, шинэ service `headscale`, root = `infra/headscale`.
2. `railway volume add -m /var/lib/headscale` (MSYS_NO_PATHCONV=1), env `PORT=8080`.
3. `railway up`; Railway domain нэмээд `hs.garena.mn` custom domain (CNAME).
4. Хэрэглэгч/түлхүүр: `railway ssh -- headscale users create players`, `headscale apikeys create --expiration 9999d` → платформ env `HEADSCALE_URL=https://hs.garena.mn`, `HEADSCALE_API_KEY`.
5. Preauth (платформ автоматаар): POST /api/v1/preauthkey {user, reusable:false, ephemeral:false, expiration}.
6. DERP шалгах: клиент дээр `tailscale netcheck` — Singapore (Oracle) 900 харагдана.
