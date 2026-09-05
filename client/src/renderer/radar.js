// 📡 Радар таб — дууссан тоглолтын hero хөдөлгөөн/үхэл/kill-ийн replay симуляц (2026-09-06, эзний хүсэлт).
// Өгөгдөл: GET /radar/games (жагсаалт), GET /radar/:token (paths = [t_ms, x, y] тушаалын зорилтууд; kills = Data:Hero
// үйл явдал). Байрлал = зорилт руу хөдөлгөөний хурдаар симуляцилсан (ойролцоо); үхэл = kill event-ийн мөчид (яг).
// Тоглоомын замд (LAN proxy, relay, main процесс) огт хүрэхгүй — зөвхөн renderer, canvas.
(() => {
  const api = (method, path, body) => window.api.request(method, path, body);
  const el = (id) => document.getElementById(id);
  const SPEED = 300, TP_DIST = 2600;
  const FOUNT = { 1: [-6800, -6850], 2: [6400, 5900] };
  // WC3 стандарт hero кодууд (LoD-ийн custom кодууд (H08B, HC92…) map-ын хамгаалагдсан w3u-д — дараагийн алхам)
  const HERO = { Hamg: 'Archmage', Hmkg: 'Mountain King', Hpal: 'Paladin', Hblm: 'Blood Mage', Obla: 'Blademaster', Ofar: 'Far Seer',
    Otch: 'Tauren Chieftain', Oshd: 'Shadow Hunter', Edem: 'Demon Hunter', Ekee: 'Keeper of the Grove', Emoo: 'Priestess of the Moon',
    Ewar: 'Warden', Udea: 'Death Knight', Ulic: 'Lich', Udre: 'Dreadlord', Ucrl: 'Crypt Lord', Nbrn: 'Brewmaster', Nngs: 'Naga Sea Witch',
    Nplh: 'Pit Lord', Nbst: 'Beastmaster', Ntin: 'Tinker', Nalc: 'Alchemist', Nfir: 'Firelord' };
  const heroName = (c) => HERO[c] || c || '?';
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  let minimapUrl = null, current = null, raf = null;

  async function load() {
    const list = el('rd-list'); if (!list) return;
    try {
      const r = await api('get', '/radar/games?limit=40');
      minimapUrl = r.minimap_url || minimapUrl;
      if (!r.games?.length) { list.innerHTML = '<div class="rd-empty">Радартай тоглолт хараахан алга. Relay-ээр дуусах тоглолт бүр энд автоматаар нэмэгдэнэ.</div>'; return; }
      list.innerHTML = r.games.map((g) => {
        const t1 = g.players.filter((p) => p.team === 1).map((p) => esc(p.name || heroName(p.hero))).join(', ') || '—';
        const t2 = g.players.filter((p) => p.team === 2).map((p) => esc(p.name || heroName(p.hero))).join(', ') || '—';
        const d = g.played_at ? new Date(g.played_at) : null;
        const when = d ? `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
        return `<div class="rd-card" data-token="${esc(g.token)}"><b>${esc(g.room_name || ('Өрөө #' + (g.room_id || '?')))}</b>
          <small>${when} · ${fmt(g.game_time_sec || 0)} · ${g.players.length} тоглогч · ${g.kills} kill${g.winner_team ? (g.winner_team === 1 ? ' · 🏆 Sentinel' : ' · 🏆 Scourge') : ''}</small>
          <small><span class="s">${t1}</span> ⚔ <span class="c">${t2}</span></small></div>`;
      }).join('');
      list.querySelectorAll('.rd-card').forEach((c) => c.addEventListener('click', () => { list.querySelectorAll('.rd-card').forEach((x) => x.classList.toggle('on', x === c)); open(c.dataset.token); }));
    } catch (e) { list.innerHTML = `<div class="rd-empty">Ачаалж чадсангүй: ${esc(e.message || e)}</div>`; }
  }

  async function open(token) {
    const v = el('rd-viewer'); v.innerHTML = '<div class="rd-empty">Радар ачааллаж байна…</div>';
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    let g;
    try { g = await api('get', `/radar/${encodeURIComponent(token)}`); } catch (e) { v.innerHTML = `<div class="rd-empty">${esc(e.message || e)}</div>`; return; }
    current = g; render(g);
  }

  function simulate(g) {
    const T = Math.max(1, Number(g.game_time_sec) || 1);
    const byPid = {}; for (const p of g.players) byPid[p.pid] = p;
    const colourPid = {}; for (const p of g.players) if (p.colour != null) colourPid[p.colour] = p.pid;
    const kills = (g.kills || []).map((k) => ({ t: k.t / 1000, killer: colourPid[k.killer], victim: colourPid[k.victim], kc: k.killer, vc: k.victim })).sort((a, b) => a.t - b.t);
    const sim = {};
    for (const p of g.players) {
      const path = g.paths?.[p.pid] || []; const tm = p.team === 2 ? 2 : 1;
      let pos = FOUNT[tm].slice(), target = null, far = 0, k = 0, dead = false, deadAt = null;
      const deaths = kills.filter((x) => x.victim === p.pid).map((x) => x.t);
      const arr = new Array(T + 1);
      for (let s = 0; s <= T; s++) {
        while (k < path.length && path[k][0] <= s * 1000) {
          const [, x, y] = path[k]; k++;
          if (dead) { dead = false; pos = FOUNT[tm].slice(); }
          const d = Math.hypot(x - pos[0], y - pos[1]);
          if (d > TP_DIST) { far++; if (far >= 2) { pos = [x, y]; far = 0; } } else far = 0;
          target = [x, y];
        }
        if (!dead && deaths.some((dt) => Math.abs(dt - s) < 0.5)) { dead = true; deadAt = pos.slice(); target = null; }
        if (!dead && target) { const d = Math.hypot(target[0] - pos[0], target[1] - pos[1]); pos = d <= SPEED ? target.slice() : [pos[0] + (target[0] - pos[0]) / d * SPEED, pos[1] + (target[1] - pos[1]) / d * SPEED]; }
        arr[s] = { x: pos[0], y: pos[1], dead, deadAt };
      }
      sim[p.pid] = arr;
    }
    return { T, sim, kills, byPid };
  }

  function render(g) {
    const v = el('rd-viewer');
    const { T, sim, kills, byPid } = simulate(g);
    const B = g.bounds || { x0: -8192, x1: 8192, y0: -8192, y1: 8192 };
    const label = (pid) => (pid == null ? null : (byPid[pid]?.name || `Тоглогч #${pid}`));
    // Kill event-ийн victim/killer өнгө тоглогчид таарахгүй бол (Roshan = 12, нейтрал) нэрээр нь
    const who = (pid, colour) => label(pid) || (colour === 12 ? 'Roshan' : `нейтрал (өнгө ${colour})`);
    const teamOf = (pid) => (byPid[pid]?.team === 2 ? 2 : 1);
    const col = (pid) => (teamOf(pid) === 2 ? '#ff5c5c' : '#43d9c9');
    v.innerHTML = `<div class="rd-grid2"><div class="rd-stage">
        <div class="rd-stagewrap" id="rd-stagewrap"><canvas id="rd-cv" width="768" height="768"></canvas></div>
        <div class="rd-row"><button id="rd-play">▶ Тоглуулах</button>
          <button data-speed="1">×1</button><button data-speed="4" class="on">×4</button><button data-speed="16">×16</button><button data-speed="64">×64</button>
          <button id="rd-tilt">Налуу</button><button id="rd-trail" class="on">Зам</button><span class="rd-clock" id="rd-clock">00:00</span></div>
        <div class="rd-timeline"><div class="rd-ticks">${kills.map((k) => `<i style="left:${(k.t / T * 100).toFixed(2)}%"></i>`).join('')}</div><input id="rd-slider" type="range" min="0" max="${T}" value="0" step="1"></div>
        <small class="hint">${esc(g.room_name || '')} · ${esc(g.map_name || '')} · ${fmt(T)} · байрлал ойролцоо (тушаалын зорилтоос), kill/death яг цагаар</small>
      </div>
      <div class="rd-side"><div id="rd-heroes">${g.players.map((p) => `<div class="rd-hero" id="rdh-${p.pid}"><div class="ic" style="background:${col(p.pid)}">${esc((p.hero || '?').slice(0, 4))}</div><div><b>${esc(label(p.pid))}</b> <span class="${teamOf(p.pid) === 2 ? 'c' : 's'}">${teamOf(p.pid) === 2 ? 'Scourge' : 'Sentinel'}</span><br><small class="st"></small><br><small>${esc(heroName(p.hero))}</small></div></div>`).join('')}</div>
        <div class="rd-feed" id="rd-feed">${kills.map((k) => `<div data-t="${k.t}"><time>${fmt(k.t)}</time><b class="${teamOf(k.killer) === 2 ? 'c' : 's'}">${esc(who(k.killer, k.kc))}</b> алав → <b class="${k.victim == null ? '' : (teamOf(k.victim) === 2 ? 'c' : 's')}">${esc(who(k.victim, k.vc))}</b></div>`).join('') || '<div class="past">Kill бүртгэгдээгүй</div>'}</div></div></div>`;
    const cv = el('rd-cv'), ctx = cv.getContext('2d'); const img = new Image(); img.src = g.minimap_url || minimapUrl || '';
    const px = (x, y) => [(x - B.x0) / (B.x1 - B.x0) * cv.width, (B.y1 - y) / (B.y1 - B.y0) * cv.height];
    let now = Math.max(0, Math.floor(kills[0]?.t || 0) - 8), playing = false, speed = 4, trail = true, last = 0;
    const kd = (pid, s) => ({ k: kills.filter((x) => x.t <= s && x.killer === pid).length, d: kills.filter((x) => x.t <= s && x.victim === pid).length });
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, cv.width, cv.height);
      ctx.strokeStyle = 'rgba(120,150,200,.12)'; ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) { const q = i / 8 * cv.width; ctx.beginPath(); ctx.moveTo(q, 0); ctx.lineTo(q, cv.height); ctx.moveTo(0, q); ctx.lineTo(cv.width, q); ctx.stroke(); }
      for (const p of g.players) {
        const pid = p.pid, c = col(pid);
        if (trail) { ctx.beginPath(); ctx.strokeStyle = c; ctx.globalAlpha = .45; ctx.lineWidth = 2; let st = false;
          for (let s = Math.max(0, now - 90); s <= now; s++) { const q = sim[pid][s]; if (!q || q.dead) { st = false; continue; } const [a, b] = px(q.x, q.y); if (!st) { ctx.moveTo(a, b); st = true; } else ctx.lineTo(a, b); }
          ctx.stroke(); ctx.globalAlpha = 1; }
        const q = sim[pid][now]; if (!q) continue;
        const [a, b] = px(q.dead && q.deadAt ? q.deadAt[0] : q.x, q.dead && q.deadAt ? q.deadAt[1] : q.y);
        ctx.beginPath(); ctx.arc(a, b, 15, 0, Math.PI * 2); ctx.fillStyle = q.dead ? '#5b6270' : c; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = q.dead ? '#8a909c' : '#fff'; ctx.stroke();
        ctx.fillStyle = q.dead ? '#cfd3da' : '#04121a'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((p.hero || '?').slice(0, 4), a, b + 1);
        if (q.dead) { ctx.strokeStyle = '#ff2b2b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a - 12, b - 12); ctx.lineTo(a + 12, b + 12); ctx.moveTo(a + 12, b - 12); ctx.lineTo(a - 12, b + 12); ctx.stroke(); }
        ctx.fillStyle = '#e6ecf7'; ctx.font = '600 12px sans-serif'; ctx.fillText(label(pid), a, teamOf(pid) === 2 ? b + 28 : b - 24);
        const h = el('rdh-' + pid); if (h) { h.classList.toggle('dead', !!q.dead); const r = kd(pid, now); h.querySelector('.st').textContent = `${q.dead ? 'ҮХСЭН' : 'амьд'} · K ${r.k} / D ${r.d}`; }
      }
      el('rd-clock').textContent = fmt(now); el('rd-slider').value = now;
      v.querySelectorAll('#rd-feed div[data-t]').forEach((d) => d.classList.toggle('past', Number(d.dataset.t) <= now));
    }
    function tick(ts) { if (!document.body.contains(cv)) return; if (playing) { if (!last) last = ts; const dt = (ts - last) / 1000; if (dt * speed >= 1) { now = Math.min(T, now + Math.floor(dt * speed)); last = ts; if (now >= T) { playing = false; el('rd-play').textContent = '▶ Тоглуулах'; } draw(); } } raf = requestAnimationFrame(tick); }
    img.onload = draw; draw(); raf = requestAnimationFrame(tick);
    el('rd-slider').addEventListener('input', (e) => { now = Number(e.target.value); draw(); });
    el('rd-play').addEventListener('click', (e) => { playing = !playing; last = 0; e.currentTarget.textContent = playing ? '❚❚ Зогсоох' : '▶ Тоглуулах'; if (now >= T) now = 0; });
    v.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { speed = Number(b.dataset.speed); v.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b)); }));
    el('rd-tilt').addEventListener('click', (e) => { const on = el('rd-stagewrap').classList.toggle('tilt'); e.currentTarget.classList.toggle('on', on); });
    el('rd-trail').addEventListener('click', (e) => { trail = !trail; e.currentTarget.classList.toggle('on', trail); draw(); });
  }

  document.getElementById('rd-refresh')?.addEventListener('click', load);
  window.radarTab = { load, open };
})();
