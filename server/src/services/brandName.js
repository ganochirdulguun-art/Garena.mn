'use strict';
// ── Брэндийн нэр хамгаалалт (2026-10-04, эзэн): «Garena» / «Гарена»-г зөвхөн эзэмшигч тал ашиглана ──
// Хэрэглэгчийн нэр, кланы нэр/тагт брэнд орсон эсэхийг автоматаар таньна:
//   • том/жижиг үсэг, кирилл/латин холилдол (Гарена, GаRеNа — кирилл а/е), монгол үсэг (гарэна)
//   • тоо/тэмдэгт орлуулалт (G4r3na, Gar3n@), өргөлттэй/өргөн үсэг (Gàrêná, Ｇａｒｅｎａ)
//   • хооронд нь зай/цэг/зураас/emoji оруулах (G.a.r.e.n.a, G a r e n a), давхардсан үсэг (Gaaarreenaa)
// Хоёр төрлийн хөрвүүлэлт: (1) кирилл → латин галиглал (г→g, р→r, н→n), (2) харагдах байдлаар ижил үсэг (р→p, н→h, с→c)
// — аль нэгэнд нь «garena» гарвал брэнд гэж үзнэ.

const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'j', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ү: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', ш: 's', щ: 's', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'a', ѐ: 'e', ї: 'i', і: 'i', ґ: 'g' };
const LOOKALIKE = { а: 'a', в: 'b', г: 'r', д: 'g', е: 'e', ё: 'e', з: '3', к: 'k', м: 'm', н: 'h', о: 'o', ө: 'o', п: 'n', р: 'p', с: 'c', т: 't', у: 'y', ү: 'y', х: 'x', ь: 'b', э: 'e', ѕ: 's', і: 'i', ј: 'j', ԁ: 'd', ɡ: 'g', ɑ: 'a', α: 'a', ε: 'e', η: 'n', ρ: 'p', γ: 'y', ν: 'v', ο: 'o' };
const LEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'l', '€': 'e', '£': 'e', '&': 'e' };
const BRAND = 'garena';

function normalize(raw, table) {
  let s = String(raw || '').normalize('NFKC').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');   // өргөлт хасах, өргөн үсэг → энгийн
  let out = '';
  for (const ch of s) {
    if (table[ch] !== undefined) out += table[ch];
    else if (LEET[ch] !== undefined) out += LEET[ch];
    else if (/[a-z]/.test(ch)) out += ch;
    // бусад (зай, цэг, зураас, emoji, тоо) — хасна
  }
  return out.replace(/(.)\1+/g, '$1');   // давхардсан үсэг: gaaarreenaa → garena
}

/** Нэрэнд «Garena»/«Гарена» брэнд агуулагдаж байна уу. */
function isBrandName(name) {
  if (!name) return false;
  const a = normalize(name, TRANSLIT), b = normalize(name, LOOKALIKE);
  if (a.includes(BRAND) || b.includes(BRAND)) return true;
  // «гарена»-ийн кирилл → харагдацаар: г→r, р→p, н→h → «rapeha» — галиглалаар аль хэдийн баригдана; «grn» товчлол биш
  return false;
}

const BRAND_ERROR = '«Garena» / «Гарена» брэндийн нэрийг зөвхөн платформын эзэмшигч ашиглана — өөр нэр сонгоно уу';

/** Брэнд агуулсан бол аюулгүй орлуулах нэр (Discord / TierSystem-ээс ирсэн нэрэнд). */
function safeName(name, seed = '') {
  if (!isBrandName(name)) return name;
  const tail = String(seed || '').replace(/\D/g, '').slice(-5) || String(Math.floor(10000 + Math.random() * 89999));
  return `Тоглогч${tail}`;
}

module.exports = { isBrandName, safeName, BRAND_ERROR, _normalize: normalize };
