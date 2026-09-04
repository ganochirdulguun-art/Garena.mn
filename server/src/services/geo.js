// ── Холболтын IP → улс (офлайн GeoIP, гадаад дуудлагагүй) ──
// Зорилго: өрөөний ping тэмдэгт гадаадаас холбогдсон тоглогчийг "хол зай (Австрали)" гэж шар өнгөөр харуулах.
// ҮНДСЭН ЧИГ БАРИМТЛАЛ: тоглоомын зам (клиентийн LAN proxy, relay)-д огт хамаагүй — socket холбогдох үед НЭГ удаа
// санах ойн хүснэгтээс хайна (микросекунд), тоглолтын явцад ямар ч нэмэлт ажил хийхгүй.
let geoip = null;
try { geoip = require('geoip-country'); } catch { try { geoip = require('geoip-lite'); } catch { geoip = null; } }

const HOME = 'MN';
// Улсын нэр (монголоор) — байхгүй бол 2 үсгийн код харуулна
const NAMES = {
  MN: 'Монгол', AU: 'Австрали', KR: 'Солонгос', JP: 'Япон', US: 'АНУ', CN: 'Хятад', RU: 'Орос', KZ: 'Казахстан',
  DE: 'Герман', GB: 'Их Британи', CA: 'Канад', TR: 'Турк', CZ: 'Чех', PL: 'Польш', FR: 'Франц', SG: 'Сингапур',
  HK: 'Хонконг', TW: 'Тайвань', AE: 'АНЭУ', SE: 'Швед', NL: 'Нидерланд', HU: 'Унгар', IT: 'Итали', ES: 'Испани',
  TH: 'Тайланд', MY: 'Малайз', IN: 'Энэтхэг', VN: 'Вьетнам', NZ: 'Шинэ Зеланд', FI: 'Финланд', NO: 'Норвег',
  DK: 'Дани', AT: 'Австри', CH: 'Швейцарь', BE: 'Бельги', IE: 'Ирланд', UA: 'Украин', PH: 'Филиппин', ID: 'Индонез',
  QA: 'Катар', SA: 'Саудын Араб', IL: 'Израиль', BR: 'Бразил', MX: 'Мексик', KG: 'Киргиз', UZ: 'Узбекистан',
};

function clientIp(headers = {}, fallback = '') {
  // Railway/proxy-ийн ард: X-Forwarded-For-ийн ЭХНИЙ (жинхэнэ клиент) IP
  const xff = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xff || String(fallback || '').trim();
  return ip.replace(/^::ffff:/, '');
}

function countryOf(ip) {
  if (!geoip || !ip) return null;
  try {
    const r = geoip.lookup(ip);
    const c = r && r.country ? String(r.country).toUpperCase() : null;
    return c && /^[A-Z]{2}$/.test(c) ? c : null;
  } catch { return null; }
}

function countryName(code) {
  return code ? (NAMES[code] || code) : '';
}

/** {country, country_name, far} — far = Монголоос гадуур (хол зай). Тодорхойгүй/дотоод IP → far=false. */
function geoInfo(ip) {
  const country = countryOf(ip);
  return { country, country_name: countryName(country), far: !!country && country !== HOME };
}

module.exports = { clientIp, countryOf, countryName, geoInfo, HOME, NAMES, available: !!geoip };
