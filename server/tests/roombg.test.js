// roomBg.parseImageDataUrl — mime/хэмжээ/эвдэрсэн оролт. node tests/roombg.test.js
const assert = require('assert');
const { parseImageDataUrl } = require('../src/routes/roomBg');

let n = 0;
const ok = (name) => { n++; console.log('PASS', name); };

const png1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const good = parseImageDataUrl(`data:image/png;base64,${png1x1}`);
assert(good && good.mime === 'image/png' && good.buf.length > 20 && good.buf[0] === 0x89);
ok('png data URL → mime+buffer');

assert(parseImageDataUrl(`data:image/jpeg;base64,${png1x1}`).mime === 'image/jpeg');
assert(parseImageDataUrl(`data:image/webp;base64,${png1x1}`).mime === 'image/webp');
ok('jpeg/webp зөвшөөрнө');

assert.strictEqual(parseImageDataUrl(`data:image/gif;base64,${png1x1}`), null);
assert.strictEqual(parseImageDataUrl(`data:image/svg+xml;base64,${png1x1}`), null);
assert.strictEqual(parseImageDataUrl('https://example.com/x.png'), null);
assert.strictEqual(parseImageDataUrl(''), null);
assert.strictEqual(parseImageDataUrl(`data:image/png;base64,!!!!`), null);
assert.strictEqual(parseImageDataUrl(`data:image/png;base64,`), null);
ok('gif/svg/URL/хоосон/эвдэрсэн base64 → null');

const big = Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64');
assert.strictEqual(parseImageDataUrl(`data:image/png;base64,${big}`), null);
assert(parseImageDataUrl(`data:image/png;base64,${Buffer.alloc(1024).toString('base64')}`));
ok('2MB хязгаар');

console.log(`\n=== roombg: ${n} PASS ===`);
