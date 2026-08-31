'use strict';
/**
 * DotA stat decoder — WC3 replay/тоглоомын 0x6B "dr.x" gamecache action-уудаас
 * тоглогч бүрийн K/D/A, creep, neutral, ward(item), hero гаргана.
 *
 * Формат (GHost++ statsdota.cpp-ийн лавлагаа):
 *   0x6b action → { filename:"dr.x", missionKey:<Data>, key:<Key>, value:<uint32> }
 *   Data = тоглогчийн DotA id ("1".."10") эсвэл "Data"/"Global"
 *   Key (Data нь тоглогч id үед):
 *     "1"=Kills  "2"=Deaths  "3"=CreepKills  "4"=CreepDenies  "5"=Assists
 *     "6"=Gold   "7"=NeutralKills  "8_0".."8_5"=Item slot 1..6  "9"=Hero  "id"=slot
 *   DotA id: 1-5 = Sentinel, 6-10 = Scourge.
 *
 * w3gjs нь 0x6B action-уудыг replay.w3mmd-д цуглуулдаг тул үүнийг шууд дамжуулна.
 */

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
  const players = {};   // dotaId -> stats
  const events = [];    // "Data" мөрүүд (kill event-ууд — killing spree тооцоход)
  const meta = {};      // "Global" мөрүүд (winner, gamemode гэх мэт)
  const get = (id) => (players[id] || (players[id] = {
    dotaId: id, kills: 0, deaths: 0, assists: 0, creepKills: 0, creepDenies: 0,
    neutralKills: 0, gold: 0, hero: null, items: [null, null, null, null, null, null], slot: null,
  }));

  for (const a of (w3mmdActions || [])) {
    if (!a || a.filename !== 'dr.x') continue;
    const data = String(a.missionKey);
    const key = String(a.key);
    const val = a.value >>> 0;
    if (/^\d+$/.test(data)) {                 // тоглогчийн статистик
      const p = get(parseInt(data, 10));
      if (STAT_KEY[key]) p[STAT_KEY[key]] = val;
      else if (key === '9') p.hero = valueToCode(val);
      else if (/^8_[0-5]$/.test(key)) p.items[parseInt(key.slice(2), 10)] = valueToCode(val);
      else if (key === 'id') p.slot = val;
    } else if (data === 'Data') {             // тоглоомын үйл явдал (kill, tower гэх мэт)
      events.push({ key, value: val });
    } else if (data === 'Global') {           // тоглоомын метадата
      meta[key] = val;
    }
  }

  const list = Object.values(players).sort((x, y) => x.dotaId - y.dotaId);
  return {
    players: list,
    sentinel: list.filter((p) => p.dotaId >= 1 && p.dotaId <= 5),
    scourge: list.filter((p) => p.dotaId >= 6 && p.dotaId <= 10),
    meta, eventCount: events.length,
  };
}

module.exports = { decodeDotaStats, valueToCode, STAT_KEY };
