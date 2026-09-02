'use strict';
/**
 * DotA stat decoder — WC3 replay/тоглоомын 0x6B "dr.x" gamecache action-уудаас
 * тоглогч бүрийн K/D/A, creep, neutral, ward(item), hero гаргана.
 *
 * Формат (GHost++ statsdota.cpp + 2026-09-02 бодит relay capture-аар баталсан):
 *   0x6b action → { filename:"dr.x", missionKey:<Data>, key:<Key>, value:<uint32> }
 *   Data = тоглогчийн ӨНГӨ/слот ("1".."5" Sentinel, "7".."11" Scourge — 6 алгасдаг) эсвэл "Data"/"Global"
 *   Key (Data нь өнгө үед — тоглоомын төгсгөлд ирдэг):
 *     "1"=Kills  "2"=Deaths  "3"=CreepKills  "4"=CreepDenies  "5"=Assists
 *     "6"=Gold   "7"=NeutralKills  "8_0".."8_5"=Item slot 1..6  "9"=Hero
 *     "id"=DotA дугаар 1-10 (1-5 Sentinel, 6-10 Scourge; -sp/-switch-ийн ДАРААХ бодит байрлал)
 *   Өнгө нь W3GS SLOTINFO слотын colour байттай ижил → pid → нэр холбогдоно (w3gsStats.js).
 *   "Global": Winner (1=Sentinel, 2=Scourge), m/s = DotA цагаар үргэлжилсэн хугацаа.
 *
 * w3gjs нь 0x6B action-уудыг replay.w3mmd-д цуглуулдаг тул үүнийг шууд дамжуулна.
 */

// DotA-ийн ward item кодууд (Observer/Sentry). Хувилбар бүрт өөр байж болох тул DOTA_WARD_CODES env-ээр
// тохируулна; хоосон бол wards=0, харин itemPurchases-д бүх код хадгалагдах тул бодит тоглоомоос тодруулна.
const WARD_CODES = String(process.env.DOTA_WARD_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);

const STAT_KEY = {
  '1': 'kills', '2': 'deaths', '3': 'creepKills', '4': 'creepDenies',
  '5': 'assists', '6': 'gold', '7': 'neutralKills',
};

// 4-байт uint32-г DotA item/hero кодын 4 тэмдэгт мөр болгоно (GHost: Value.rbegin..rend = урвуу)
function valueToCode(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  // GHost урвуугаар уншдаг → little-endian байтыг эргүүлэхэд ASCII код гарна
  const s = Buffer.from([b[3], b[2], b[1], b[0]]).toString('latin1').replace(/\0/g, '');
  return s || null;
}

function decodeDotaStats(w3mmdActions) {
  const players = {};   // colour -> stats
  const events = [];    // "Data" мөрүүд (kill event-ууд — killing spree тооцоход)
  const meta = {};      // "Global" мөрүүд (winner, gamemode гэх мэт)
  const get = (colour) => (players[colour] || (players[colour] = {
    colour, dotaId: null, kills: 0, deaths: 0, assists: 0, creepKills: 0, creepDenies: 0,
    neutralKills: 0, gold: 0, hero: null, items: [null, null, null, null, null, null],
    itemPurchases: {}, wards: 0,   // PUI_<өнгө> event-ээс: item код → хэдэн удаа авсан; ward = WARD_CODES-ийн нийлбэр
  }));

  for (const a of (w3mmdActions || [])) {
    if (!a || a.filename !== 'dr.x') continue;
    const data = String(a.missionKey);
    const key = String(a.key);
    const val = a.value >>> 0;
    if (/^\d+$/.test(data)) {                 // тоглогчийн статистик (өнгөөр)
      const p = get(parseInt(data, 10));
      if (STAT_KEY[key]) p[STAT_KEY[key]] = val;
      else if (key === '9') p.hero = valueToCode(val);
      else if (/^8_[0-5]$/.test(key)) p.items[parseInt(key.slice(2), 10)] = valueToCode(val);
      else if (key === 'id') p.dotaId = val;
    } else if (data === 'Data') {             // тоглоомын үйл явдал (kill, tower, item гэх мэт)
      events.push({ key, value: val });
      const pui = /^PUI_(\d+)$/.exec(key);    // тоглогч item авав (худалдан авалт/өргөлт) — observer ward тоолоход
      if (pui) {
        const code = valueToCode(val);
        if (code) { const ip = get(parseInt(pui[1], 10)).itemPurchases; ip[code] = (ip[code] || 0) + 1; }
      }
    } else if (data === 'Global') {           // тоглоомын метадата
      meta[key] = val;
    }
  }

  const list = Object.values(players).sort((x, y) => x.colour - y.colour);
  // Баг: өнгө 1-5 = Sentinel, 6-11 = Scourge (DotA 6 алгасдаг ч аюулгүйн үүднээс оруулна).
  // Хоосон слотод ч gold, "id" хуримтлагддаг (бодит capture: 10 өнгө бүгд id-тэй) тул зөвхөн
  // hero-той тоглогчийг "бодит" гэж үзнэ (w3gsStats слотын pid-ээр давхар тодруулна).
  for (const p of list) {
    p.team = p.colour <= 5 ? 'sentinel' : 'scourge';
    p.active = !!p.hero;
    p.wards = WARD_CODES.reduce((n, c) => n + (p.itemPurchases[c] || 0), 0);
  }
  return {
    players: list,
    sentinel: list.filter((p) => p.team === 'sentinel'),
    scourge: list.filter((p) => p.team === 'scourge'),
    winner: meta.Winner === 1 ? 'sentinel' : meta.Winner === 2 ? 'scourge' : null,
    meta, eventCount: events.length,
  };
}

module.exports = { decodeDotaStats, valueToCode, STAT_KEY, WARD_CODES };
