// 📡 Радар таб — hero хөдөлгөөн/үхэл/kill-ийн симуляц (2026-09-06, эзний хүсэлт).
// Replay: GET /radar/games, /radar/:token. LIVE (Шат 2): GET /radar/live, /radar/live/:token?since= — саатлыг СЕРВЕР
// хэрэгжүүлнэ (эзэн 0 с, бусад бүгд 120 с); клиент зөвхөн ирсэн өгөгдлийг зурна. Эрх: GET /radar/access — GOLD
// гишүүнчлэл; Bronze/Silver → демо симуляц (/radar/demo) + GOLD болох заавар.
// Гацалтгүй зарчим: зөвхөн renderer/canvas; таб идэвхгүй үед poll хийхгүй; тоглоомын зам (LAN proxy, relay, main) огт хүрэхгүй.
(() => {
  const api = (method, path, body) => window.api.request(method, path, body);
  const el = (id) => document.getElementById(id);
  const SPEED = 300, TP_DIST = 2600;
  const FOUNT = { 1: [-6800, -6850], 2: [6400, 5900] };
  const LIVE_POLL_MS = 5000, LIVE_LIST_MS = 15000;
  const hName = (p) => (p && (p.hero_name || p.hero)) || '?';
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const isTabOn = () => !!el('tab-radar')?.classList.contains('active');
  let minimapUrl = null, raf = null, pollTimer = null, listTimer = null, access = null, viewer = null;

  function stopViewer() {
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    viewer = null;
  }
  function stopAll() { stopViewer(); if (listTimer) { clearInterval(listTimer); listTimer = null; } }

  // ── Эрх шалгаад таб зурна ──
  async function load() {
    stopAll();
    const locked = el('rd-locked'), wrap = el('rd-wrap');
    try { access = await api('get', '/radar/access'); } catch (e) { access = { ok: false, tier: '?', error: e.message || String(e) }; }
    if (!access.ok) { wrap.hidden = true; locked.hidden = false; return renderLocked(); }
    locked.hidden = true; wrap.hidden = false;
    const b = el('rd-access');
    if (b) b.innerHTML = access.tier === 'owner' ? '<span class="rd-pill own">👑 Эзэн · шууд (0 с)</span>' : `<span class="rd-pill gold">🥇 GOLD · ${access.delay_sec} с саатал</span>`;
    await Promise.all([loadLive(), loadReplays()]);
    listTimer = setInterval(() => { if (isTabOn()) loadLive(); }, LIVE_LIST_MS);
  }

  // ── Bronze/Silver: демо + заавар ──
  async function renderLocked() {
    const t = el('rd-lock-tier'); if (t) t.textContent = access?.tier === 'silver' ? 'Silver' : 'Bronze';
    const go = el('rd-go-gold');
    if (go && !go.dataset.wired) { go.dataset.wired = '1'; go.addEventListener('click', () => { try { showTab('profile'); setTimeout(() => el('membership-current')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150); } catch {} }); }
    const v = el('rd-demo-viewer'); if (!v) return;
    v.innerHTML = '<div class="rd-empty">Демо ачааллаж байна…</div>';
    try {
      const g = await api('get', '/radar/demo');
      minimapUrl = g.minimap_url || minimapUrl;
      render(g, { demo: true, mount: v });
    } catch (e) { v.innerHTML = `<div class="rd-empty">Демо ачаалж чадсангүй: ${esc(e.message || e)}</div>`; }
  }

  // ── LIVE жагсаалт ──
  async function loadLive() {
    const box = el('rd-live'); if (!box) return;
    let r;
    try { r = await api('get', '/radar/live'); } catch (e) { box.innerHTML = `<div class="rd-empty small">LIVE: ${esc(e.message || e)}</div>`; return; }
    const games = r.games || [];
    if (!games.length) { box.innerHTML = `<div class="rd-livehead"><span class="dot"></span> LIVE</div><div class="rd-empty small">Яг одоо явж буй тоглолт алга. Relay-ээр эхлэх тоглолт бүр энд ${r.delay_sec ? r.delay_sec + ' с саатлаар' : 'шууд'} гарна.</div>`; return; }
    box.innerHTML = `<div class="rd-livehead"><span class="dot"></span> LIVE · ${games.length}</div>` + games.map((g) => {
      const t1 = g.players.filter((p) => p.team === 1).map((p) => esc(p.name || hName(p))).join(', ') || '—';
      const t2 = g.players.filter((p) => p.team === 2).map((p) => esc(p.name || hName(p))).join(', ') || '—';
      const st = g.ended ? '⏹ дууссан (саатал дуустал үзнэ)' : g.visible_in_sec > 0 ? `⏳ ${g.visible_in_sec} с-ийн дараа харагдана` : `${fmt(g.game_time_sec)} · ${g.kills} kill`;
      return `<div class="rd-card live${viewer?.token === g.token ? ' on' : ''}" data-live="${esc(g.token)}"><b>🔴 ${esc(g.room_name || (g.host_name ? g.host_name + '-ын тоглолт' : 'Тоглолт'))}</b>
        <small>${st} · ${g.delay_sec ? g.delay_sec + ' с саатал' : 'шууд'}</small>
        <small><span class="s">${t1}</span> ⚔ <span class="c">${t2}</span></small></div>`;
    }).join('');
    box.querySelectorAll('.rd-card[data-live]').forEach((c) => c.addEventListener('click', () => { markOn(c); openLive(c.dataset.live); }));
  }
  function markOn(card) { document.querySelectorAll('#tab-radar .rd-card').forEach((x) => x.classList.toggle('on', x === card)); }

  // ── Replay жагсаалт ──
  async function loadReplays() {
    const list = el('rd-list'); if (!list) return;
    try {
      const r = await api('get', '/radar/games?limit=40');
      minimapUrl = r.minimap_url || minimapUrl;
      if (!r.games?.length) { list.innerHTML = '<div class="rd-empty">Радартай тоглолт хараахан алга. Relay-ээр дуусах тоглолт бүр энд автоматаар нэмэгдэнэ.</div>'; return; }
      list.innerHTML = '<div class="rd-livehead rp">▶ Replay · ' + r.games.length + '</div>' + r.games.map((g) => {
        const t1 = g.players.filter((p) => p.team === 1).map((p) => esc(p.name || hName(p))).join(', ') || '—';
        const t2 = g.players.filter((p) => p.team === 2).map((p) => esc(p.name || hName(p))).join(', ') || '—';
        const d = g.played_at ? new Date(g.played_at) : null;
        const when = d ? `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
        return `<div class="rd-card" data-token="${esc(g.token)}"><b>${esc(g.room_name || ('Өрөө #' + (g.room_id || '?')))}</b>
          <small>${when} · ${fmt(g.game_time_sec || 0)} · ${g.players.length} тоглогч · ${g.kills} kill${g.winner_team ? (g.winner_team === 1 ? ' · 🏆 Sentinel' : ' · 🏆 Scourge') : ''}</small>
          <small><span class="s">${t1}</span> ⚔ <span class="c">${t2}</span></small></div>`;
      }).join('');
      list.querySelectorAll('.rd-card[data-token]').forEach((c) => c.addEventListener('click', () => { markOn(c); open(c.dataset.token); }));
    } catch (e) { list.innerHTML = `<div class="rd-empty">Ачаалж чадсангүй: ${esc(e.message || e)}</div>`; }
  }

  async function open(token) {
    const v = el('rd-viewer'); v.innerHTML = '<div class="rd-empty">Радар ачааллаж байна…</div>';
    stopViewer();
    let g;
    try { g = await api('get', `/radar/${encodeURIComponent(token)}`); } catch (e) { v.innerHTML = `<div class="rd-empty">${esc(e.message || e)}</div>`; return; }
    render(g, { mount: v });
  }

  // ── LIVE үзэгч: 5 с тутам delta (since = сүүлд харсан тоглоомын цаг) ──
  async function openLive(token) {
    const v = el('rd-viewer'); v.innerHTML = '<div class="rd-empty">LIVE радар холбогдож байна…</div>';
    stopViewer();
    let g;
    try { g = await api('get', `/radar/live/${encodeURIComponent(token)}`); } catch (e) { v.innerHTML = `<div class="rd-empty">${esc(e.message || e)}</div>`; return; }
    minimapUrl = g.minimap_url || minimapUrl;
    const ctl = render(g, { mount: v, live: true });
    viewer = { token, g, ctl };
    let stalls = 0;
    pollTimer = setInterval(async () => {
      if (!viewer || viewer.token !== token) return;
      if (!isTabOn()) return;                                  // таб идэвхгүй — сүлжээ хэрэглэхгүй
      let d;
      try { d = await api('get', `/radar/live/${encodeURIComponent(token)}?since=${Math.max(-1, Number(g.game_time_ms) || -1)}`); }
      catch (e) { if (++stalls >= 6) { ctl.setStatus('⏹ LIVE дууслаа — Replay жагсаалтад удахгүй гарна'); clearInterval(pollTimer); pollTimer = null; } return; }
      stalls = 0;
      for (const [pid, arr] of Object.entries(d.paths || {})) (g.paths[pid] = g.paths[pid] || []).push(...arr);
      g.kills.push(...(d.kills || [])); g.events.push(...(d.events || []));
      g.players = d.players || g.players; g.game_time_ms = d.game_time_ms; g.game_time_sec = d.game_time_sec; g.ended = d.ended; g.visible_in_sec = d.visible_in_sec;
      ctl.update(g);
    }, LIVE_POLL_MS);
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

  // opts: { mount, live, demo } → { update(g), setStatus(text) }
  function render(g, opts = {}) {
    const v = opts.mount || el('rd-viewer');
    const live = !!opts.live, demo = !!opts.demo;
    let S = simulate(g);
    const B = g.bounds || { x0: -8192, x1: 8192, y0: -8192, y1: 8192 };
    const label = (pid) => (pid == null ? null : (S.byPid[pid]?.name || `Тоглогч #${pid}`));
    const who = (pid, colour) => label(pid) || (colour === 12 ? 'Roshan' : `нейтрал (өнгө ${colour})`);
    const teamOf = (pid) => (S.byPid[pid]?.team === 2 ? 2 : 1);
    const col = (pid) => (teamOf(pid) === 2 ? '#ff5c5c' : '#43d9c9');
    const heroCard = (p) => `<div class="rd-hero" id="rdh-${p.pid}">${p.hero_icon ? `<img class="ic" src="${esc(p.hero_icon)}" alt="" style="object-fit:cover;border:2px solid ${col(p.pid)}">` : `<div class="ic" style="background:${col(p.pid)}">${esc((p.hero || '?').slice(0, 4))}</div>`}<div><b>${esc(p.name || ('Тоглогч #' + p.pid))}</b><br><small>${esc(hName(p))}${p.hero_proper ? ' · ' + esc(p.hero_proper) : ''}</small><br><small class="st">амьд</small></div></div>`;
    const feedRow = (k) => `<div data-t="${k.t}"><time>${fmt(k.t)}</time><b class="${teamOf(k.killer) === 2 ? 'c' : 's'}">${esc(who(k.killer, k.kc))}</b> алав → <b class="${k.victim == null ? '' : (teamOf(k.victim) === 2 ? 'c' : 's')}">${esc(who(k.victim, k.vc))}</b></div>`;
    const status = live ? (g.delay_sec ? `🔴 LIVE · ${g.delay_sec} с саатал` : '🔴 LIVE · шууд') : demo ? '🎬 ДЕМО · дууссан тоглолтын симуляц' : '';
    v.innerHTML = `<div class="rd-grid2${demo ? ' demo' : ''}"><div class="rd-stage">
        <div class="rd-stagewrap" id="rd-stagewrap"><canvas id="rd-cv" width="768" height="768"></canvas>${status ? `<div class="rd-status ${live ? 'live' : 'demo'}" id="rd-status">${status}</div>` : ''}${demo ? '<div class="rd-watermark">GOLD</div>' : ''}</div>
        <div class="rd-row"${demo ? ' hidden' : ''}><button id="rd-play">▶ Тоглуулах</button>
          <button data-speed="1"${live ? ' class="on"' : ''}>×1</button><button data-speed="4"${live ? '' : ' class="on"'}>×4</button><button data-speed="16">×16</button><button data-speed="64">×64</button>
          ${live ? '<button id="rd-follow" class="on">🔴 LIVE дага</button>' : ''}
          <button id="rd-tilt">Налуу</button><button id="rd-trail" class="on">Зам</button><span class="rd-clock" id="rd-clock">00:00</span></div>
        <div class="rd-timeline"${demo ? ' hidden' : ''}><div class="rd-ticks" id="rd-ticks">${S.kills.map((k) => `<i style="left:${(k.t / S.T * 100).toFixed(2)}%"></i>`).join('')}</div><input id="rd-slider" type="range" min="0" max="${S.T}" value="0" step="1"></div>
        <small class="hint" id="rd-hint">${esc(g.room_name || '')} · ${esc(g.map_name || '')} · ${fmt(S.T)} · байрлал ойролцоо (тушаалын зорилтоос), kill/death яг цагаар</small>
      </div>
      <div class="rd-side"><div id="rd-heroes">${g.players.map(heroCard).join('')}</div>
        <div class="rd-feed" id="rd-feed">${S.kills.map(feedRow).join('')}</div></div></div>`;
    const cv = v.querySelector('#rd-cv'), ctx = cv.getContext('2d'); const img = new Image(); img.src = g.minimap_url || minimapUrl || '';
    const icons = {};
    const loadIcons = () => { for (const p of g.players) if (p.hero_icon && !icons[p.pid]) { const im = new Image(); im.onload = () => draw(); im.onerror = () => { delete icons[p.pid]; }; im.src = p.hero_icon; icons[p.pid] = im; } };
    loadIcons();
    const px = (x, y) => [(x - B.x0) / (B.x1 - B.x0) * cv.width, (B.y1 - y) / (B.y1 - B.y0) * cv.height];
    let now = live ? S.T : demo ? 0 : Math.max(0, Math.floor(S.kills[0]?.t || 0) - 8);
    let playing = live || demo, speed = live ? 1 : demo ? 8 : 4, trail = true, last = 0, follow = live;
    const kd = (pid, s) => ({ k: S.kills.filter((x) => x.t <= s && x.killer === pid).length, d: S.kills.filter((x) => x.t <= s && x.victim === pid).length });
    const q = (sel) => v.querySelector(sel);
    function draw() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, cv.width, cv.height);
      ctx.strokeStyle = 'rgba(120,150,200,.12)'; ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) { const qq = i / 8 * cv.width; ctx.beginPath(); ctx.moveTo(qq, 0); ctx.lineTo(qq, cv.height); ctx.moveTo(0, qq); ctx.lineTo(cv.width, qq); ctx.stroke(); }
      for (const p of g.players) {
        const pid = p.pid, c = col(pid), arr = S.sim[pid]; if (!arr) continue;
        if (trail) { ctx.beginPath(); ctx.strokeStyle = c; ctx.globalAlpha = .45; ctx.lineWidth = 2; let st = false;
          for (let s = Math.max(0, now - 90); s <= now; s++) { const r = arr[s]; if (!r || r.dead) { st = false; continue; } const [a, b] = px(r.x, r.y); if (!st) { ctx.moveTo(a, b); st = true; } else ctx.lineTo(a, b); }
          ctx.stroke(); ctx.globalAlpha = 1; }
        const r = arr[now]; if (!r) continue;
        const [a, b] = px(r.dead && r.deadAt ? r.deadAt[0] : r.x, r.dead && r.deadAt ? r.deadAt[1] : r.y);
        const ic = icons[pid];
        if (ic && ic.complete && ic.naturalWidth) {
          ctx.save(); ctx.beginPath(); ctx.arc(a, b, 17, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
          try { ctx.filter = r.dead ? 'grayscale(1) brightness(.55)' : 'none'; } catch {}
          ctx.drawImage(ic, a - 17, b - 17, 34, 34); try { ctx.filter = 'none'; } catch {}
          ctx.restore();
          ctx.beginPath(); ctx.arc(a, b, 17, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = r.dead ? '#8a909c' : c; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(a, b, 15, 0, Math.PI * 2); ctx.fillStyle = r.dead ? '#5b6270' : c; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = r.dead ? '#8a909c' : '#fff'; ctx.stroke();
          ctx.fillStyle = r.dead ? '#cfd3da' : '#04121a'; ctx.font = '700 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText((p.hero || '?').slice(0, 4), a, b + 1);
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (r.dead) { ctx.strokeStyle = '#ff2b2b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(a - 12, b - 12); ctx.lineTo(a + 12, b + 12); ctx.moveTo(a + 12, b - 12); ctx.lineTo(a - 12, b + 12); ctx.stroke(); }
        ctx.fillStyle = '#e6ecf7'; ctx.font = '600 12px sans-serif'; ctx.fillText(label(pid), a, teamOf(pid) === 2 ? b + 28 : b - 24);
        const h = v.querySelector('#rdh-' + pid); if (h) { h.classList.toggle('dead', !!r.dead); const kk = kd(pid, now); h.querySelector('.st').textContent = `${r.dead ? 'ҮХСЭН' : 'амьд'} · K ${kk.k} / D ${kk.d}`; }
      }
      const clock = q('#rd-clock'); if (clock) clock.textContent = fmt(now);
      const sl = q('#rd-slider'); if (sl) sl.value = now;
      v.querySelectorAll('#rd-feed div[data-t]').forEach((d) => d.classList.toggle('past', Number(d.dataset.t) <= now));
    }
    function tick(ts) {
      if (!document.body.contains(cv)) return;
      if (playing && (isTabOn() || !demo)) {
        if (!last) last = ts; const dt = (ts - last) / 1000;
        if (dt * speed >= 1) {
          now = Math.min(S.T, now + Math.floor(dt * speed)); last = ts;
          if (now >= S.T) { if (demo) now = 0; else if (!live) { playing = false; const pb = q('#rd-play'); if (pb) pb.textContent = '▶ Тоглуулах'; } }
          draw();
        }
      }
      raf = requestAnimationFrame(tick);
    }
    img.onload = draw; draw(); if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    q('#rd-slider')?.addEventListener('input', (e) => { now = Number(e.target.value); follow = false; q('#rd-follow')?.classList.remove('on'); draw(); });
    q('#rd-play')?.addEventListener('click', (e) => { playing = !playing; last = 0; e.currentTarget.textContent = playing ? '❚❚ Зогсоох' : '▶ Тоглуулах'; if (now >= S.T && !live) now = 0; });
    if (playing) { const pb = q('#rd-play'); if (pb) pb.textContent = '❚❚ Зогсоох'; }
    v.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => { speed = Number(b.dataset.speed); v.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b)); }));
    q('#rd-follow')?.addEventListener('click', (e) => { follow = true; playing = true; speed = 1; now = S.T; e.currentTarget.classList.add('on'); draw(); });
    q('#rd-tilt')?.addEventListener('click', (e) => { const on = q('#rd-stagewrap').classList.toggle('tilt'); e.currentTarget.classList.toggle('on', on); });
    q('#rd-trail')?.addEventListener('click', (e) => { trail = !trail; e.currentTarget.classList.toggle('on', trail); draw(); });

    // LIVE: шинэ delta ирэхэд симуляцийг дахин тооцоолж, картуудыг шинэчилнэ
    function update(g2) {
      const prevPlayers = S.byPid, prevKills = S.kills.length;
      S = simulate(g2);
      const sl = q('#rd-slider'); if (sl) sl.max = S.T;
      if (Object.keys(S.byPid).length !== Object.keys(prevPlayers).length) { const hb = q('#rd-heroes'); if (hb) hb.innerHTML = g2.players.map(heroCard).join(''); loadIcons(); }
      if (S.kills.length !== prevKills) { const fb = q('#rd-feed'); if (fb) { fb.innerHTML = S.kills.map(feedRow).join(''); fb.scrollTop = fb.scrollHeight; } const tk = q('#rd-ticks'); if (tk) tk.innerHTML = S.kills.map((k) => `<i style="left:${(k.t / S.T * 100).toFixed(2)}%"></i>`).join(''); }
      const hint = q('#rd-hint'); if (hint) hint.textContent = `${g2.room_name || ''} · ${g2.map_name || ''} · ${fmt(S.T)} · байрлал ойролцоо (тушаалын зорилтоос), kill/death яг цагаар`;
      if (g2.visible_in_sec > 0) setStatus(`⏳ ${g2.visible_in_sec} с-ийн дараа харагдана (${g2.delay_sec} с саатал)`);
      else if (g2.ended) setStatus(`⏹ Тоглолт дууссан · саатлын үлдэгдэл үзэгдэж байна`);
      else setStatus(g2.delay_sec ? `🔴 LIVE · ${g2.delay_sec} с саатал` : '🔴 LIVE · шууд');
      if (follow) { now = S.T; playing = true; }
      draw();
    }
    function setStatus(t) { const s = q('#rd-status'); if (s) s.textContent = t; }
    return { update, setStatus };
  }

  document.getElementById('rd-refresh')?.addEventListener('click', load);
  window.radarTab = { load, open, openLive, stop: stopAll };
})();
