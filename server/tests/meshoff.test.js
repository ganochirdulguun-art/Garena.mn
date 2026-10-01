'use strict';
// MESH_DISABLED=1 (2026-10-01, эзэн: bot1 шиг зөвхөн relay): login_server null, түлхүүр олгохгүй, mesh тэмдэггүй.
const assert = require('node:assert/strict');
const path = require('node:path');
const serverDir = path.resolve(__dirname, '..');
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
Object.assign(process.env, { NODE_ENV: 'test', HEADSCALE_URL: 'https://hs.example', HEADSCALE_API_KEY: 'k', MESH_DISABLED: '1' });
const mesh = require(path.join(serverDir, 'src', 'routes', 'mesh.js'));
assert.equal(mesh.meshDisabled(), true); assert.equal(mesh.meshConfigured(), false); assert.equal(mesh.loginServer(), null);
ok('MESH_DISABLED=1 → mesh унтраалттай, login_server null');
process.env.MESH_DISABLED = '';
assert.equal(mesh.meshConfigured(), true); assert.equal(mesh.loginServer(), 'https://hs.example');
ok('MESH_DISABLED хоосон → mesh хэвийн');
console.log(`=== meshoff: ${pass} PASS ===`);
process.exit(0);
