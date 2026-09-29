// ══════════════════════════════════════════════════════════════
// Өрөөний цонх — CS 1.6 / Quake III сервер (2026-09-30, Ш1).
// Хост: «Сервер нээх» → тоглоом listen сервертэй нээгдэж, mesh IP өрөөнд зарлагдана (/rooms/:id/ipserver).
// Гишүүд: «Нэгдэх» → тоглоом `+connect IP:PORT`-оор шууд холбогдоно. Энэ өрөөнд WC3-ийн LAN самбар нуугдана.
// ══════════════════════════════════════════════════════════════
(function gxIpGame() {
  if (new URLSearchParams(location.search).get('mode') !== 'room') return;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => escHtml(t ?? '');
  const api = (m, p, b) => window.api.request(m, p, b);
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const LABEL = { cs16: { t: '🎯 Counter-Strike 1.6 сервер', map: 'de_dust2' }, q3: { t: '⚡ Quake III сервер', map: 'q3dm17' } };
  let kind = null, server = null, started = false;

  const mine = () => server && String(server.host_user_id) === String(currentUser?.id);
  function setState(txt, state) { const s = $('ipg-state'); if (s) { s.textContent = state === 'live' ? 'НЭЭЛТТЭЙ' : 'БЭЛЭН'; s.dataset.state = state === 'live' ? 'hosting' : 'idle'; } const t = $('ipg-text'); if (t) t.textContent = txt; }
  function render() {
    const amHost = !!currentRoom?.isHost;
    const box = $('ipg-server');
    $('ipg-host-row')?.classList.toggle('hidden', !amHost || !!server);
    if (!server) {
      box?.classList.add('hidden');
      setState(amHost ? 'Map сонгоод «Сервер нээх» дарна. Тоглоом таны PC дээр сервертэй нээгдэж, өрөөнийхөн нэг товчоор нэгдэнэ.' : 'Хост сервер нээхийг хүлээнэ үү — нээгдмэгц энд «Нэгдэх» товч гарна.', 'idle');
      return;
    }
    setState(mine() ? 'Таны сервер нээлттэй. Өрөөнийхэн «Нэгдэх» дарж орно.' : `«${server.host_username}» сервер нээлээ.`, 'live');
    box.classList.remove('hidden');
    box.innerHTML = `<div class="ipg-srv"><span class="ipg-dot"></span><div><b>${esc(server.host_username)}</b>-ийн сервер · ${esc(server.map || '')}<small>${esc(server.ip)}:${esc(server.port)} · mesh</small></div></div>
      <div class="ipg-acts">${mine()
        ? '<button type="button" class="btn btn-sm" id="btn-ipg-relaunch">Тоглоом дахин нээх</button><button type="button" class="btn btn-sm btn-danger-soft" id="btn-ipg-stop">Сервер хаах</button>'
        : '<button type="button" class="btn btn-primary btn-block" id="btn-ipg-join">Нэгдэх</button>'}</div>`;
    $('btn-ipg-join')?.addEventListener('click', join);
    $('btn-ipg-stop')?.addEventListener('click', stop);
    $('btn-ipg-relaunch')?.addEventListener('click', join);
  }
  async function host() {
    const b = $('btn-ipg-host'); if (b) { b.disabled = true; b.textContent = 'Нээж байна…'; }
    try {
      const r = await window.api.ipGameHost({ gameType: currentRoom.gameType, map: $('ipg-map')?.value.trim(), maxPlayers: currentRoom.maxPlayers || 10 });
      const res = await api('post', `/rooms/${currentRoom.id}/ipserver`, { kind: r.kind, ip: r.ip, port: r.port, map: r.map });
      server = res.server; render();
      appendSysMsg?.(`🎮 Сервер нээгдлээ (${r.map}). Windows «Firewall» зөвшөөрөл асуувал «Allow» дарна уу — эс бөгөөс бусад нь холбогдож чадахгүй.`);
    } catch (e) { showToast(errMsg(e), 'error', 6000); }
    finally { if (b) { b.disabled = false; b.textContent = 'Сервер нээх'; } }
  }
  async function join() {
    if (!server) return;
    try { await window.api.ipGameJoin({ gameType: currentRoom.gameType, ip: server.ip, port: server.port }); appendSysMsg?.(`▶ ${server.ip}:${server.port} руу холбогдож байна…`); }
    catch (e) { showToast(errMsg(e), 'error', 6000); }
  }
  async function stop() {
    try { await api('delete', `/rooms/${currentRoom.id}/ipserver`); server = null; render(); } catch (e) { showToast(errMsg(e), 'error'); }
  }
  async function init() {
    kind = await window.api.ipGameKind?.(currentRoom.gameType).catch(() => null);
    if (!kind) return;
    document.body.classList.add('ipgame-room');
    $('ip-game-panel')?.classList.remove('hidden');
    $('ipg-title').textContent = LABEL[kind].t;
    const eb = document.querySelector('#page-room .room-eyebrow'); if (eb) eb.textContent = kind === 'cs16' ? 'Counter-Strike 1.6 room' : 'Quake III room';
    const m = $('ipg-map'); if (m && !m.value) m.placeholder = `Map (ж: ${LABEL[kind].map})`;
    try { server = (await api('get', `/rooms/${currentRoom.id}/ipserver`))?.server || null; } catch { server = null; }
    render();
  }
  $('btn-ipg-host')?.addEventListener('click', host);
  document.addEventListener('garena:host-changed', () => render());
  const t = setInterval(() => {
    if (!started && typeof currentRoom !== 'undefined' && currentRoom?.id) { started = true; init(); }
    if (typeof socket !== 'undefined' && socket && !socket.__ipg) {
      socket.__ipg = true;
      socket.on('room:ipserver', (s) => { const fresh = !server; server = s; render(); if (fresh && !mine()) appendSysMsg?.(`🎯 «${s.host_username}» ${s.label} сервер нээлээ — «Нэгдэх» дарна уу.`); });
      socket.on('room:ipserver_gone', () => { server = null; render(); appendSysMsg?.('⏹ Сервер хаагдлаа.'); });
    }
  }, 700);
  window.addEventListener('beforeunload', () => { clearInterval(t); if (mine()) api('delete', `/rooms/${currentRoom.id}/ipserver`).catch(() => {}); });
})();
