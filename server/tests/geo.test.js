// services/geo.js — IP → улс, "хол зай" туг (офлайн DB)
const assert = require('assert');
const geo = require('../src/services/geo');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS ' + name); };

ok('clientIp: X-Forwarded-For эхний IP, ::ffff: угтварыг арилгана', () => {
  assert.strictEqual(geo.clientIp({ 'x-forwarded-for': '1.1.1.1, 10.0.0.1' }, '::ffff:9.9.9.9'), '1.1.1.1');
  assert.strictEqual(geo.clientIp({}, '::ffff:202.131.1.34'), '202.131.1.34');
  assert.strictEqual(geo.clientIp({}, ''), '');
});
ok('geoInfo: Монгол IP → far=false; Австрали/Солонгос → far=true + монгол нэр', () => {
  assert.ok(geo.available, 'geoip DB алга');
  const mn = geo.geoInfo('202.131.1.34');
  assert.strictEqual(mn.country, 'MN'); assert.strictEqual(mn.far, false); assert.strictEqual(mn.country_name, 'Монгол');
  const au = geo.geoInfo('139.130.4.5');   // Telstra (Австрали)
  assert.strictEqual(au.country, 'AU'); assert.strictEqual(au.far, true); assert.strictEqual(au.country_name, 'Австрали');
  const kr = geo.geoInfo('168.126.63.1');
  assert.strictEqual(kr.country, 'KR'); assert.strictEqual(kr.country_name, 'Солонгос');
});
ok('geoInfo: дотоод/тодорхойгүй IP → country=null, far=false (гадаад гэж андуурахгүй)', () => {
  const p = geo.geoInfo('192.168.1.1');
  assert.strictEqual(p.country, null); assert.strictEqual(p.far, false); assert.strictEqual(p.country_name, '');
  assert.deepStrictEqual(geo.geoInfo(''), { country: null, country_name: '', far: false });
  assert.deepStrictEqual(geo.geoInfo('not-an-ip'), { country: null, country_name: '', far: false });
});
ok('countryName: map-д байхгүй код → кодыг өөрийг нь', () => {
  assert.strictEqual(geo.countryName('ZZ'), 'ZZ'); assert.strictEqual(geo.countryName(null), '');
});
console.log(`\n=== geo: ${n} PASS ===`);
