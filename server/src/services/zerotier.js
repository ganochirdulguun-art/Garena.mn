// ── ZeroTier сүлжээний удирдлага: хоёр backend ──
//  1) Өөрийн controller (VPS дээрх zerotier-one, үнэгүй, төхөөрөмжийн хязгааргүй):
//       ZT_CONTROLLER_URL=https://<vps>:8443  ZT_CONTROLLER_TOKEN=<authtoken.secret>
//     API: /controller/network/<id>, /controller/network/<id>/member/<node>  (header X-ZT1-Auth)
//  2) ZeroTier Central (my.zerotier.com, төхөөрөмж тутамд төлбөртэй): ZEROTIER_API_TOKEN
//     API: https://api.zerotier.com/api/v1/network, .../member/<node>  (header Authorization: token …)
// Controller URL тохируулсан бол тэр нь давуу; үгүй бол Central; хоёулаа байхгүй бол ZeroTier идэвхгүй.
const axios = require('axios');
const https = require('https');

const CENTRAL_API = 'https://api.zerotier.com/api/v1';
// Subnet-ийг env-ээр удирдана (renumber үед энэ нэг л газраас өөрчлөгдөнө). Одоогийн бодит сүлжээ 10.147.99.0/24.
const _ztSub = String(process.env.ZT_SUBNET_PREFIX || '10.147.99').replace(/\.$/, '');
const POOL = { start: `${_ztSub}.1`, end: `${_ztSub}.254`, route: `${_ztSub}.0/24` };

function controllerCfg() {
  const url = String(process.env.ZT_CONTROLLER_URL || '').replace(/\/+$/, '');
  const token = process.env.ZT_CONTROLLER_TOKEN || '';
  return url && token ? { url, token } : null;
}
function centralToken() { return process.env.ZEROTIER_API_TOKEN || ''; }
function mode() {
  if (controllerCfg()) return 'controller';
  if (centralToken()) return 'central';
  return 'off';
}
function configured() { return mode() !== 'off'; }

// Өөрийн controller: self-signed TLS (sslip.io/caddy) эсвэл http — сертификатыг шалгахгүй, нууц token хамгаална
const insecureAgent = new https.Agent({ rejectUnauthorized: false });
function ctl() {
  const c = controllerCfg();
  return axios.create({
    baseURL: c.url, timeout: 10000,
    headers: { 'X-ZT1-Auth': c.token, 'Content-Type': 'application/json' },
    httpsAgent: process.env.ZT_CONTROLLER_INSECURE === 'false' ? undefined : insecureAgent,
  });
}
function central() {
  return axios.create({ baseURL: CENTRAL_API, timeout: 10000, headers: { Authorization: `token ${centralToken()}` } });
}

let _controllerAddress = null;
async function controllerAddress() {
  if (_controllerAddress) return _controllerAddress;
  const { data } = await ctl().get('/status');
  _controllerAddress = String(data.address || '').toLowerCase();
  if (!/^[0-9a-f]{10}$/.test(_controllerAddress)) throw new Error('controller address уншигдсангүй');
  return _controllerAddress;
}

/** Сүлжээ үүсгэнэ → network id (16 hex) эсвэл null */
async function createNetwork(name) {
  const m = mode();
  if (m === 'off') return null;
  const safeName = String(name || 'WC3').slice(0, 64);
  if (m === 'controller') {
    const addr = await controllerAddress();
    const { data } = await ctl().post(`/controller/network/${addr}______`, {
      name: safeName, private: true, enableBroadcast: true,
      v4AssignMode: { zt: true },
      ipAssignmentPools: [{ ipRangeStart: POOL.start, ipRangeEnd: POOL.end }],
      routes: [{ target: POOL.route, via: null }],
      multicastLimit: 64,
    });
    return String(data.nwid || data.id || '').toLowerCase() || null;
  }
  const { data } = await central().post('/network', {
    config: {
      name: safeName, private: true, enableBroadcast: true,
      v4AssignMode: { zt: true },
      ipAssignmentPools: [{ ipRangeStart: POOL.start, ipRangeEnd: POOL.end }],
      routes: [{ target: POOL.route }],
    },
  });
  return data.id || null;
}

/** Сүлжээг private + broadcast болгож баталгаажуулна (аль хэдийн байгаа сүлжээнд) */
async function hardenNetwork(networkId) {
  const m = mode();
  if (m === 'off' || !networkId) return false;
  if (m === 'controller') {
    await ctl().post(`/controller/network/${networkId}`, { private: true, enableBroadcast: true, v4AssignMode: { zt: true } });
    return true;
  }
  await central().post(`/network/${networkId}`, { config: { private: true, enableBroadcast: true } });
  return true;
}

/** Гишүүнийг зөвшөөрнө (клиентийн node id 10 hex) */
async function authorizeMember(networkId, nodeId) {
  const m = mode();
  if (m === 'off') throw new Error('no-api-token');
  // Түр зуурын алдаа (controller/Central timeout, 5xx) дээр 3 хүртэл дахин оролдоно —
  // нэг сүлжээний blip тоглогчийн ZeroTier join-ыг унагахгүй.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (m === 'controller') {
        await ctl().post(`/controller/network/${networkId}/member/${nodeId}`, { authorized: true });
      } else {
        await central().post(`/network/${networkId}/member/${nodeId}`, { config: { authorized: true } });
      }
      return true;
    } catch (e) {
      lastErr = e;
      const status = e && e.response && e.response.status;
      if (status && status >= 400 && status < 500) throw e;   // 4xx — дахин оролдох утгагүй
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

async function deleteNetwork(networkId) {
  const m = mode();
  if (m === 'off' || !networkId) return false;
  if (m === 'controller') { await ctl().delete(`/controller/network/${networkId}`); return true; }
  await central().delete(`/network/${networkId}`);
  return true;
}

module.exports = { mode, configured, createNetwork, hardenNetwork, authorizeMember, deleteNetwork, POOL };
