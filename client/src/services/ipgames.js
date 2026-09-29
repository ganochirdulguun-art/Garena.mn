// ══════════════════════════════════════════════════════════════
// IP-ээр холбогддог тоглоом (2026-09-30, Ш1): Counter-Strike 1.6, Quake III Arena.
// Хост: listen сервер нээж (+map) эхлүүлнэ; тоглогч: `+connect IP:PORT`-оор эхлүүлнэ.
// Холболт нь Tailscale mesh (100.64/10) — LAN broadcast дамждаггүй тул сервер жагсаалтын оронд шууд IP.
// Бүх үйлдэл async; exe-г тухайн хавтаснаас (cwd) ажиллуулна (hl.exe/quake3.exe үүнийг шаарддаг).
// ══════════════════════════════════════════════════════════════
const path = require('path');
const fsp = require('fs').promises;
const { spawn } = require('child_process');

const KINDS = {
  cs16: { label: 'Counter-Strike 1.6', port: 27015, defaultMap: 'de_dust2' },
  q3: { label: 'Quake III Arena', port: 27960, defaultMap: 'q3dm17' },
};

/** Тоглоомын төрлийг exe/нэр/хавтаснаас таних → 'cs16' | 'q3' | null (WC3 болон бусад) */
function kindOf(game) {
  const hay = `${game?.name || ''} ${game?.path || ''}`.toLowerCase();
  if (/war3|warcraft|frozen throne|wc3|game\.dll/.test(hay)) return null;
  if (/cstrike|counter[-\s]?strike|\bcs\s?1\.6\b|\\hl\.exe$|\/hl\.exe$|\bhl\.exe\b/.test(hay)) return 'cs16';
  if (/quake\s?(3|iii)|ioquake3|quake3e?\.exe|\bq3a?\b/.test(hay)) return 'q3';
  return null;
}
const safeMap = (m, kind) => (String(m || '').replace(/[^\w.-]/g, '').slice(0, 40) || KINDS[kind].defaultMap);
const clampPlayers = (n) => Math.max(2, Math.min(32, Number(n) || 10));

function hostArgs(kind, { map, maxPlayers, port }) {
  const p = String(port || KINDS[kind].port);
  if (kind === 'cs16') return ['-game', 'cstrike', '-console', '-port', p, '+sv_lan', '0', '+maxplayers', String(clampPlayers(maxPlayers)), '+map', safeMap(map, kind)];
  return ['+set', 'net_port', p, '+set', 'sv_maxclients', String(clampPlayers(maxPlayers)), '+set', 'sv_pure', '0', '+map', safeMap(map, kind)];
}
function joinArgs(kind, { ip, port }) {
  const addr = `${ip}:${port || KINDS[kind].port}`;
  return kind === 'cs16' ? ['-game', 'cstrike', '+connect', addr] : ['+connect', addr];
}
function isMeshIp(ip) {
  const p = String(ip || '').split('.').map(Number);
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}

async function launch(game, args) {
  if (!game?.path) throw new Error('Тоглоом тохируулагдаагүй байна (Тохиргоо → Тоглоом)');
  try { await fsp.access(game.path); } catch { throw new Error(`"${game.name}" файл олдсонгүй: ${game.path}`); }
  const child = spawn(game.path, args, { cwd: path.dirname(game.path), detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => {});
  child.unref();
  return true;
}

module.exports = { KINDS, kindOf, hostArgs, joinArgs, launch, isMeshIp };
