# Garena.mn hostbot — RGC маягийн бот хост

Өрөөний host "**🤖 Бот хост хийх**" дарахад платформ `bot_jobs`-д ажил үүсгэнэ → энэ bridge ажлыг аваад **GHost++**-ээр тухайн map-ийг хостолно → тоглогчдын Garena.mn клиент ботын тоглоомыг WC3-ийн LAN жагсаалтад харуулна (GProxy-той ижил арга: локал UDP GAMEINFO + TCP proxy) → бүгд нэгдэнэ → host lobby-д `!start` бичнэ → тоглолт дуусахад GHost++-ийн dota статистик (ялагч, K/D/A, leaver) платформ руу очиж XP / Diamond олгогдоно.

## Яагаад ажилладаг вэ
- GHost++ = RGC, Garena+, DotA-League, ENT зэргийн ашигладаг байсан нээлттэй эхийн WC3 хост бот (тоглоомыг өөрөө хостолж, бүх пакетыг хардаг тул хэн гарсан/хожсоныг баттай мэднэ).
- `map_type = dota` → DotA/LoD map-ийн `dr.x` статистик (kills, deaths, assists, hero, winner) `dotagames`/`dotaplayers` хүснэгтэд автоматаар бичигдэнэ.
- Тоглогч ботыг LAN-д "харах" асуудлыг клиент шийднэ: ботын GAMEINFO пакетыг 127.0.0.1:6112 руу (source port 6112) 3 сек тутам илгээж, WC3-ийг 127.0.0.1:<локал порт> руу холбуулж TCP-г бот руу proxy хийнэ. Энэ нь GProxy++-ийн зарчим.

## Шаардлага (VPS)
- Ubuntu 22.04, нийтийн IP, **TCP 6112–6130** (тоглоом бүрт 1 порт), 6300 (reconnect) нээлттэй. Монгол/Азийн датацентр (ping).
- WC3 1.26a-ийн `War3Patch.mpq`, `War3x.mpq`, `War3xlocal.mpq` → `/opt/war3/` (map CRC тооцоход).
- Map файлууд → `hostbot/maps/` (яг тоглогчдынхтай ижил: `DotA v6.74c LoD v5e.w3x`).
- Node 18+, GHost++ 17.2 (Shiox/ghostpp) build — `Dockerfile` үзнэ үү (эсвэл гараар `cmake .. && make`).

## Тохиргоо
```
PLATFORM_URL=https://garenamn-production.up.railway.app
BOT_KEY=<платформын BOT_API_KEY-тэй ижил нууц>
BOT_NAME=mn-bot-1
PUBLIC_IP=<VPS-ийн IP>
GHOST_DIR=/app   GHOST_BIN=./ghost++   WAR3_PATH=/opt/war3/
BASE_PORT=6112   MAX_GAMES=2   START_PLAYERS=10
```
Платформ (Railway, Garena.mn service): `BOT_API_KEY=<ижил нууц>` (олон бот бол `BOT_API_KEYS=a,b`).

Map нэмэх: `server/src/config/maps.json`-д мөр + `hostbot/mapcfgs/<key>.cfg` + `hostbot/maps/<файл>`.

## Урсгал (API)
| Хэн | Дуудлага | Тайлбар |
|---|---|---|
| host (клиент) | `POST /rooms/:id/bot-host {map_key}` | ажил үүснэ (`queued`), өрөөнд `room:bot_job` |
| bridge | `POST /bot/heartbeat` (20с) | онлайн бот; `GET /rooms/bot-host/status`-д харагдана |
| bridge | `GET /bot/jobs/next?bot=` | ажлыг атомаар авна (`hosting`) → GHost++ асаана |
| bridge | `POST /bot/jobs/:id/lobby {host_ip, host_port, gameinfo_b64}` | → `room:bot_lobby`; клиентүүд LAN bridge + "WC3 нээж нэгдэх" |
| bridge | `POST /bot/jobs/:id/started` | → өрөө `playing`, `room:bot_started` |
| bridge | `POST /bot/jobs/:id/result {winner_team, duration_minutes, players[]}` | → `game_results`, `game_players` (K/D/A), wins/losses, XP/Level, Diamond бонус, `room:bot_result` |
| bridge | `POST /bot/jobs/:id/failed {error}` | → `room:bot_job` (failed), өрөө `waiting` |

Timeout: queued/lobby 30 минут → `cancelled`.

## GHost++ build-ийн патч (заавал)
`ghost/game_base.cpp` `EventPlayerJoined`: нэрийн урт `> 15` → `> 31` (WC3 1.26 LAN нэр 15-аас урт байж болдог, жишээ нь
20 тэмдэгт; хуучин хязгаараар GHost++ `invalid name of length` гээд REJECTJOIN_FULL буцаадаг). `tools/vps/vps-build-ghost.sh`
энэ sed-ийг хийдэг. Шалгах: 20 тэмдэгттэй нэрээр REQJOIN явуулахад reason 27 (wrong key) ирвэл OK, 9 (full) бол патчгүй.

## Туршилтын жагсаалт (эхний удаа)
1. `node bridge.js` → лог `UDP 6112 сонсож байна`, платформ дээр `GET /rooms/bot-host/status` → `bots:[mn-bot-1]`.
2. Өрөөнд "Бот хост хийх" → bridge лог `GHost++ асаалаа` → 5–10 сек дотор `lobby мэдэгдлээ`. GHost++ `[MAP] ... crc` алдаа өгвөл `/opt/war3`-д MPQ файлууд байгаа эсэх, map файлын нэр.
3. Клиент "WC3 нээж нэгдэх" → WC3 → LAN → тоглоом харагдана (нэр `GMN#<өрөө> ...`) → Join. Харагдахгүй бол клиентийн лог `[BotBridge]` (порт 6112 reuseAddr, firewall).
4. Host lobby чатад `!start` (эсвэл 10 хүн дүүрэхэд автоматаар). Бот `started loading` → платформ `playing`.
   GHost++ зөвхөн `autohost_owner`-тэй **яг ижил WC3 нэртэй** тоглогчийн `!start`-ыг хүлээн авдаг → клиент (1.8.4+) хостын
   WC3 LAN нэрийг (registry `userlocal`) `owner_name`-ээр илгээдэг. Таарахгүй бол lobby-д `!owner` (эзэн нь lobby-д байхгүй үед
   хэн ч авч болно), дараа нь `!start`.
5. Тоглолт дуусах → bridge `дүн илгээгдлээ` (тоглогч бүр `name` + `ip`) → сервер `results.js` тоглогчийг
   ажилд бүртгүүлсэн WC3 нэр (`bot_job_players`, клиент REQJOIN-оос барьж `POST /rooms/:id/bot-host/join`) → давхцахгүй
   нийтийн IP → `users.wc3_name` → username дарааллаар тааруулна → профайл дээр хожил/K/D/A, XP, 10 тоглолтын блок.
6. GHost++ `dotagames.winner = 0` байвал (map stats явуулаагүй) bridge `leftreason`-оор тааварлана; тэгж ч чадахгүй бол `failed: ялагч тодорхойгүй` → админ гараар.

## Анхаарах
- Энэ багц **хараахан VPS дээр туршигдаагүй** (энэ машинд Node/Docker байхгүй). GHost++-ийн лог мөрүүд (`started loading`, `is over`, `saving game data`) хувилбараас хамааран бага зэрэг өөр байж болно — `bridge.js`-ийн `handleLogText` regex-ийг логтой тулгана.
- `gameplayers.colour`: 1–5 Sentinel (team 1), 7–11 Scourge (team 2).
- Reconnect (GProxy) хэрэгтэй бол клиентийн TCP proxy-г GProxy протоколоор өргөтгөнө (bot_reconnect = 1 аль хэдийн асаалттай).
