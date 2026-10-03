// Брэндийн нэр хамгаалалт (services/brandName.js): Garena/Гарена-г ямар ч хэлбэрээр бичсэн ч танина, гэмгүй нэрийг хаахгүй
const assert = require('assert');
const path = require('path');
const { isBrandName, safeName } = require(path.join(__dirname, '../src/services/brandName'));
let n = 0; const ok = (t) => { n++; console.log('PASS ' + t); };

const BAD = ['Garena', 'garena', 'GARENA', 'GaReNa', 'Garena.mn', 'GarenaPro', 'xX_Garena_Xx', 'ProGarenaMN', 'Гарена', 'ГАРЕНА', 'гарэна', 'Гарена Монгол',
  'GаRеNа' /* кирилл а, е */, 'Gаrеnа', 'G4r3na', 'Gar3n@', 'g@r3n4', 'G a r e n a', 'G.a.r.e.n.a', 'G-a-r-e-n-a', 'G_a_r_e_n_a', 'Gaaarreenaa', 'Ｇａｒｅｎａ', 'Gàrêná', 'Garеna' /* кирилл е */, '🔥Garena🔥', 'Garena1', 'ГарЕна_Admin', 'garenasystem', 'Gаrena'];
for (const s of BAD) assert.strictEqual(isBrandName(s), true, `брэнд гэж танигдах ёстой: ${s}`);
ok(`${BAD.length} хувилбар (том/жижиг, кирилл/латин холилдол, монгол, тоо орлуулалт, зай/цэг, давхар үсэг, өргөн/өргөлттэй үсэг) бүгд танигдана`);

const GOOD = ['Вито Корлеон', 'Billionaire', 'Purevdulam', 'Garden', 'Gareth', 'Arena', 'Garen', 'Garnet', 'Karena', 'Serena', 'Гараа', 'Гэрэл', 'MarenaBoy', 'GG ez', 'Ganaa', 'Gerel', 'Lorena', 'Тоглогч12345', 'Uka', 'FaSi', 'Ранга'];
for (const s of GOOD) assert.strictEqual(isBrandName(s), false, `гэмгүй нэрийг хааж болохгүй: ${s}`);
ok(`${GOOD.length} гэмгүй нэр (Garden, Gareth, Arena, Garen, Karena, Serena, Гэрэл…) хаагдахгүй`);

assert.strictEqual(safeName('GarenaKing', '1253713572631154819'), 'Тоглогч54819'); assert.strictEqual(safeName('Uka', '1'), 'Uka'); ok('safeName: брэнд → Тоглогч#####, бусдыг хөндөхгүй');
assert.strictEqual(isBrandName(''), false); assert.strictEqual(isBrandName(null), false); ok('хоосон утга');
console.log(`\n=== brandname: ${n} PASS ===`);
