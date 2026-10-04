'use strict';
// ── Room Live (2026-10-03, эзэн): Discord маягийн дэлгэц дамжуулалт ──
//  • Room-ын «🔴 LIVE» товч → дэлгэц/цонх сонгох → LiveKit SFU (Датаком) руу 720p30 ≤2 Mbps H.264 илгээнэ.
//  • Гишүүдийн жагсаалтад streamer-ийн нэрний ард «● LIVE» + чатын дээр «▶ Үзэх» мөр — дарвал үзэгчийн цонх (live.html).
//  • Сервер: нэг LAN тоглоомд байгаа хүнд татгалзана; тоглоомд нэгдвэл live:kick → цонх хаагдана.
//  • Төлөв серверээс live:state-ээр ирнэ (хэн Live, хэдэн үзэгч / дээд хязгаар).
// ── Найдвартай байдал (2026-10-04, эзэн «LIVE-ийг 100% ажилладаг болго»):
//  • Дэлгэцийг серверээс Live авахаас ӨМНӨ авна (сонгосон даруйд) — дуутай болохгүй бол дуугүйгээр дахин оролдоно.
//  • Socket түр тасрахад Live зогсохгүй: дахин холбогдмогц live:resume (сервер 25с хүлээнэ).
//  • Алдаа бүр серверт live:error-оор бүртгэгдэнэ (дэлгэц авах / LiveKit холболт / үзэгчийн цонх).
//  • LIVE товчийг андуурч дарахад шууд зогсохгүй — баталгаажуулна.
// ── Лобби (үндсэн цонх): нийтийн чатад зарласан Live-үүдийн мөр + үзэх (эзэн 2026-10-03: сурталчилгаа) ──
const gxLiveAck = (sock, ev, data, ms = 10000) => new Promise((res) => {
  let done = false;
  const t = setTimeout(() => { if (!done) { done = true; res({ ok: false, error: 'Сервер хариу өгсөнгүй — дахин оролдоно уу' }); } }, ms);
  try { sock.emit(ev, data, (a) => { if (done) return; done = true; clearTimeout(t); res(a || { ok: false, error: 'Хариу ирсэнгүй' }); }); }
  catch (e) { if (!done) { done = true; clearTimeout(t); res({ ok: false, error: e?.message || 'Илгээж чадсангүй' }); } }
});

(() => {
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode === 'room' || mode === 'dm') return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pub = [], boundSock = null;
  function strip() {
    let s = $('gx-live-strip');
    if (!s) {
      const box = $('lobby-chat-messages'); if (!box) return null;
      s = document.createElement('div'); s.id = 'gx-live-strip'; s.className = 'gx-live-strip hidden';
      box.parentElement.insertBefore(s, box);
      s.addEventListener('click', (e) => { const b = e.target.closest('[data-watch]'); if (b) watch(b.dataset.watch); });
    }
    return s;
  }
  function paint() {
    const s = strip(); if (!s) return;
    const me = String((typeof currentUser !== 'undefined' && currentUser?.id) || '');
    if (!pub.length) { s.classList.add('hidden'); s.innerHTML = ''; return; }
    s.classList.remove('hidden');
    s.innerHTML = `<span class="gx-live-strip-h"><i></i>LIVE</span>` + pub.map((l) => `<span class="gx-live-chip${l.viewers >= l.max ? ' full' : ''}"><b>${esc(l.username)}</b><small>${esc(l.roomName || `Room ${l.roomId}`)} · 👁 ${l.viewers}/${l.max}</small>${String(l.userId) === me ? '<em>Таны Live</em>' : `<button type="button" data-watch="${esc(l.userId)}" ${l.viewers >= l.max ? 'disabled' : ''}>Үзэх</button>`}</span>`).join('');
  }
  async function watch(streamerId) {
    if (!boundSock?.connected) { try { showToast('Сервертэй холбогдоогүй байна', 'warning'); } catch {} return; }
    const l = pub.find((x) => String(x.userId) === String(streamerId));
    const r = await gxLiveAck(boundSock, 'live:watch', { streamerId: String(streamerId) });
    if (!r.ok) { try { showToast(r.error || 'Live үзэх боломжгүй', 'warning', 6000); } catch {} return; }
    try { await window.api.liveOpenViewer({ token: r.token, url: r.url, lkRoom: r.lkRoom, streamer: l?.username || r.state?.username || 'Live', streamerId: String(streamerId), max: r.state?.max || 35 }); }
    catch (e) { try { showToast(e?.message || 'Цонх нээж чадсангүй', 'error'); } catch {} try { boundSock.emit('live:leave', { streamerId: String(streamerId) }); } catch {} }
  }
  function bind(s) {
    if (!s || s === boundSock) return; boundSock = s;
    s.on('live:public', ({ lives } = {}) => { pub = Array.isArray(lives) ? lives : []; paint(); });
    s.on('live:ended', ({ streamerId } = {}) => { try { window.api?.liveCloseViewer?.(String(streamerId)); } catch {} });
    s.on('live:kick', ({ streamerId, reason } = {}) => { try { window.api?.liveCloseViewer?.(String(streamerId)); } catch {} try { showToast(reason || 'Live үзэх боломжгүй боллоо', 'warning', 6000); } catch {} });
  }
  setInterval(() => { try { if (typeof socket !== 'undefined' && socket) bind(socket); } catch {} paint(); }, 1500);
  try { window.api?.onLiveViewerClosed?.((streamerId) => { try { boundSock?.emit('live:leave', { streamerId: String(streamerId) }); } catch {} }); } catch {}
  // Үзэгчийн цонхны алдаа (LiveKit-д холбогдож чадаагүй / дүрс ирээгүй) → серверийн логт (үндсэн цонх л илгээнэ — давхардахгүй)
  try { window.api?.onLiveViewerError?.((d = {}) => { try { boundSock?.emit('live:error', { stage: `viewer-${String(d.stage || 'error').slice(0, 12)}`, name: d.name || '', message: d.message || '', kind: `#${d.streamerId || ''}` }); } catch {} }); } catch {}
  window.gxLiveLobby = { watch, _demo: (list) => { pub = list; paint(); } };
})();

(() => {
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode !== 'room') return;   // зөвхөн өрөөний цонх
  const $ = (id) => document.getElementById(id);
  const toast = (m, t = 'info', d = 4000) => { try { showToast(m, t, d); } catch { console.log(m); } };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ENC = { width: 1280, height: 720, fps: 30, maxBitrate: 2_000_000, codec: 'vp8' };   // сервертэй ижил; VP8 — H264 (OpenH264) дэлгэцийг 320×180 болгодог байв
  let lives = new Map();        // streamerId → { userId, username, viewers, max }
  let my = null;                // { room, stream, tracks[], lkRoom } — миний Live
  let starting = false;
  let boundSock = null;

  const report = (stage, e, extra = {}) => {
    try { boundSock?.emit('live:error', { stage, name: e?.name || '', message: String(e?.message || e || '').slice(0, 300), ...extra }); } catch {}
  };

  // ── Socket (app.js-ийн socket дахин үүсэхэд дахин холбоно) ──
  function bind(s) {
    if (!s || s === boundSock) return; boundSock = s;
    s.on('live:state', ({ lives: arr } = {}) => { lives = new Map((arr || []).map((l) => [String(l.userId), l])); paint(); });
    s.on('live:ended', ({ streamerId } = {}) => { try { window.api?.liveCloseViewer?.(String(streamerId)); } catch {} const l = lives.get(String(streamerId)); if (l) toast(`${l.username}-ийн Live дууслаа`, 'info'); });
    s.on('live:kick', ({ streamerId, reason } = {}) => { try { window.api?.liveCloseViewer?.(String(streamerId)); } catch {} toast(reason || 'Live үзэх боломжгүй боллоо', 'warning', 6000); });
    // Socket түр тасрахад Live-ийг ЗОГСООХГҮЙ (LiveKit тусдаа холболтоор үргэлжилнэ) — дахин холбогдмогц сэргээнэ
    s.on('connect', () => { if (my) resumeLive(); });
  }
  setInterval(() => { try { if (typeof socket !== 'undefined' && socket) bind(socket); } catch {} }, 1000);
  try { window.api?.onLiveViewerClosed?.((streamerId) => { try { boundSock?.emit('live:leave', { streamerId: String(streamerId) }); } catch {} }); } catch {}

  async function resumeLive() {
    const m = my; if (!m || !boundSock) return;
    const r = await gxLiveAck(boundSock, 'live:resume', { lkRoom: m.lkRoom }, 8000);
    if (r.ok || my !== m) return;
    report('resume', { message: r.error || 'resume failed' });
    toast('Сервертэй холболт удаан тасарсан тул Live зогслоо — LIVE товчоор дахин эхлүүлнэ үү', 'warning', 9000);
    stopLive('resume-failed');
  }

  // ── Товч (RGC доод цэс эсвэл room-header-actions) ──
  function ensureButton() {
    // Товч RGC-ийн доод цэсэнд (gx-rgc.js: MENU · FORUM · START · LADDER · SHOP · LIVE); RGC биш бол толгойн мөрөнд
    let b = $('btn-live');
    if (!b) {
      const host = document.querySelector('.room-header-actions'); if (!host) return null;
      b = document.createElement('button');
      b.type = 'button'; b.id = 'btn-live'; b.className = 'btn btn-sm btn-live'; b.title = 'Дэлгэцээ Room-ын гишүүдэд шууд дамжуулах (720p · 30fps). Нэг LAN тоглоомд байгаа хүн үзэхгүй.';
      b.innerHTML = '<span class="live-dot"></span>LIVE';
      host.insertBefore(b, host.firstChild);
    }
    if (!b.dataset.liveBound) { b.dataset.liveBound = '1'; b.addEventListener('click', () => (my ? confirmStop() : startLive())); }
    return b;
  }
  setInterval(ensureButton, 1500);

  async function confirmStop() {
    let yes = true;
    try { yes = typeof showConfirm === 'function' ? await showConfirm('Та итгэлтэй байна уу?', 'Live дамжуулалтаа зогсоох уу? Үзэж буй хүмүүсийн цонх хаагдана.', { ok: 'Тийм', cancel: 'Үгүй' }) : window.confirm('Live зогсоох уу?'); } catch {}
    if (yes && my) stopLive('user');
  }

  function roomBar() {
    let bar = $('gx-live-roombar');
    if (!bar) {
      const chat = $('chat-messages'); if (!chat || !chat.parentElement) return null;
      bar = document.createElement('div'); bar.id = 'gx-live-roombar'; bar.className = 'gx-live-strip hidden';
      chat.parentElement.insertBefore(bar, chat);
      bar.addEventListener('click', (e) => { const b = e.target.closest('[data-watch]'); if (b && !b.disabled) watchLive(b.dataset.watch); });
    }
    return bar;
  }

  function paint() {
    const me = String((typeof currentUser !== 'undefined' && currentUser?.id) || '');
    const mine = lives.get(me);
    const b = ensureButton();
    if (b && !starting) {
      if (my && mine) { b.classList.add('on'); b.innerHTML = `<span class="live-dot"></span>LIVE <small>👁 ${mine.viewers}/${mine.max} · зогсоох</small>`; }
      else if (my) { b.classList.add('on'); b.innerHTML = '<span class="live-dot"></span>LIVE <small>зогсоох</small>'; }
      else { b.classList.remove('on'); b.innerHTML = '<span class="live-dot"></span>LIVE'; }
    }
    // Гишүүдийн нэрний ард LIVE тэмдэг
    document.querySelectorAll('#members-list li[data-uid]').forEach((li) => {
      const uid = String(li.dataset.uid || ''); const l = lives.get(uid);
      let badge = li.querySelector('.live-badge');
      if (!l) { badge?.remove(); return; }
      if (!badge) {
        badge = document.createElement('span'); badge.className = 'live-badge'; badge.dataset.liveUid = uid;
        badge.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (uid !== me) watchLive(uid); });
        const name = li.querySelector('.clickable-name, .m-self'); (name?.parentElement || li).insertBefore(badge, name ? name.nextSibling : null);
      }
      badge.title = uid === me ? 'Таны Live' : `${l.username}-ийн дэлгэцийг үзэх · 👁 ${l.viewers}/${l.max}`;
      badge.innerHTML = `<i></i>LIVE <small>${l.viewers}/${l.max}</small>`;
      badge.classList.toggle('full', l.viewers >= l.max);
    });
    // Чатын дээрх «▶ Үзэх» мөр — жижиг тэмдгийг анзаараагүй ч шууд харагдана (2026-10-04)
    const bar = roomBar();
    if (bar) {
      const others = [...lives.values()].filter((l) => String(l.userId) !== me);
      if (!others.length) { bar.classList.add('hidden'); bar.innerHTML = ''; }
      else {
        bar.classList.remove('hidden');
        bar.innerHTML = `<span class="gx-live-strip-h"><i></i>LIVE</span>` + others.map((l) => {
          const full = l.viewers >= l.max;
          return `<span class="gx-live-chip${full ? ' full' : ''}"><b>${esc(l.username)}</b><small>дэлгэцээ дамжуулж байна · 👁 ${l.viewers}/${l.max}</small><button type="button" data-watch="${esc(l.userId)}" ${full ? 'disabled' : ''}>▶ Үзэх</button></span>`;
        }).join('');
      }
    }
  }
  const ml = $('members-list');
  if (ml) new MutationObserver(() => paint()).observe(ml, { childList: true });

  // ── Дэлгэц сонгох цонх ──
  function pickSource() {
    return new Promise(async (resolve) => {
      let sources = [];
      try { sources = await window.api.liveSources(); } catch (e) { report('sources', e); toast(e?.message || 'Дэлгэцийн жагсаалт авч чадсангүй', 'error'); return resolve(null); }
      if (!sources?.length) { report('sources', { message: 'empty' }); toast('Дамжуулах дэлгэц/цонх олдсонгүй', 'warning'); return resolve(null); }
      // Бүтэн дэлгэц эхэнд, санал болгоно: WC3 бүтэн дэлгэцээр тоглоход ч, цонх солигдоход ч Live тасрахгүй
      sources = sources.slice().sort((a, b) => (a.kind === 'screen' ? 0 : 1) - (b.kind === 'screen' ? 0 : 1));
      const firstScreen = sources.find((s) => s.kind === 'screen');
      const label = (s) => (s.kind === 'screen' ? `🖥 Бүтэн дэлгэц${sources.filter((x) => x.kind === 'screen').length > 1 ? ` (${escHtml(String(s.name || '').slice(0, 24))})` : ''}` : `🪟 ${escHtml(String(s.name || '').slice(0, 48))}`);
      const ov = document.createElement('div'); ov.className = 'live-picker';
      ov.innerHTML = `<div class="live-picker-box"><div class="live-picker-h"><b>🔴 Live — юуг дамжуулах вэ?</b><span>720p · 30fps · ~2 Mbps · Room-ын гишүүд үзнэ (нэг LAN тоглоомд байгаа хүн үзэхгүй)</span><button type="button" class="btn btn-sm" data-x>✕</button></div>
        <div class="live-picker-tip">💡 Warcraft III-г дамжуулах бол <b>«Бүтэн дэлгэц»</b>-ийг сонгоорой. Цонх сонговол тэр цонх хаагдах/жижгэрэхэд Live зогсоно.</div>
        <div class="live-picker-grid">${sources.map((s) => `<button type="button" class="live-src${s === firstScreen ? ' rec' : ''}" data-id="${s.id}" data-kind="${s.kind}">${s === firstScreen ? '<em class="live-rec">⭐ Санал болгож буй</em>' : ''}<img src="${s.thumbnail}" alt=""><span>${label(s)}</span></button>`).join('')}</div>
        <div class="live-picker-f"><label><input type="checkbox" id="live-audio" checked> Тоглоомын дууг хамт дамжуулах</label><label title="Бүх онлайн хэрэглэгчид нийтийн чатын дээрх LIVE мөрөөс үзэх боломжтой болно (Room-д байх шаардлагагүй)"><input type="checkbox" id="live-public" checked> 📣 Нийтийн чатад зарлах — Room-д байхгүй хүмүүс ч үзнэ</label></div></div>`;
      document.body.appendChild(ov);
      const done = (v) => { ov.remove(); resolve(v); };
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) return done(null); const b = e.target.closest('.live-src'); if (b) done({ id: b.dataset.id, kind: b.dataset.kind || 'window', audio: !!ov.querySelector('#live-audio')?.checked, public: !!ov.querySelector('#live-public')?.checked }); });
    });
  }

  // Сонгосон эх сурвалжийг авна; дуутай болохгүй бол дуугүйгээр дахин (зарим компьютерт системийн дуу авах боломжгүй)
  async function capture(pick) {
    const video = { width: { ideal: ENC.width, max: ENC.width }, height: { ideal: ENC.height, max: ENC.height }, frameRate: { ideal: ENC.fps, max: ENC.fps } };
    await window.api.liveSelectSource(pick.id);
    try { return await navigator.mediaDevices.getDisplayMedia({ video, audio: !!pick.audio }); }
    catch (e) {
      if (!pick.audio) throw e;
      report('capture-audio', e, { kind: pick.kind });
      await window.api.liveSelectSource(pick.id);
      const s = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
      toast('Тоглоомын дууг авч чадсангүй — Live дуугүй явна', 'warning', 6000);
      return s;
    }
  }

  async function startLive() {
    if (my || starting) return;
    if (typeof LivekitClient === 'undefined') { report('init', { message: 'LivekitClient undefined' }); toast('Live модуль ачаалагдаагүй — аппаа шинэчилнэ үү', 'error'); return; }
    if (!boundSock?.connected) { toast('Сервертэй холбогдоогүй байна', 'warning'); return; }
    const pick = await pickSource(); if (!pick) return;
    starting = true;
    const b = ensureButton(); if (b) { b.disabled = true; b.innerHTML = '<span class="live-dot"></span>Эхлүүлж байна…'; }
    let stream = null, room = null, started = false;
    const LK = LivekitClient;
    try {
      // 1) Дэлгэц — серверээс өмнө (сонгосон даруйд)
      try { stream = await capture(pick); }
      catch (e) {
        report('capture', e, { kind: pick.kind });
        throw new Error(pick.kind === 'window'
          ? 'Энэ цонхыг дамжуулж чадсангүй — «Бүтэн дэлгэц»-ийг сонгоод дахин оролдоно уу'
          : `Дэлгэцийг авч чадсангүй (${e?.name || 'алдаа'}) — дахин оролдоно уу`);
      }
      const vt = stream.getVideoTracks()[0];
      if (!vt || vt.readyState === 'ended') { report('capture', { message: 'no live video track' }, { kind: pick.kind }); throw new Error('Дэлгэцийн дүрс ирсэнгүй — «Бүтэн дэлгэц»-ийг сонгоно уу'); }
      // 2) Сервер — Live бүртгэж токен авна
      const r = await gxLiveAck(boundSock, 'live:start', { public: !!pick.public }, 12000);
      if (!r.ok) throw new Error(r.error || 'Live эхлүүлж чадсангүй');
      started = true;
      const enc = r.encoding || ENC;
      // 3) LiveKit SFU (Датаком) — холбогдож дүрсээ илгээнэ
      room = new LK.Room({ adaptiveStream: false, dynacast: false });
      try { await room.connect(r.url, r.token); }
      catch (e) { report('connect', e); throw new Error('Live серверт холбогдож чадсангүй — интернэтээ шалгаад дахин оролдоно уу'); }
      try { await room.localParticipant.publishTrack(vt, { source: LK.Track.Source.ScreenShare, simulcast: false, videoCodec: enc.codec, videoEncoding: { maxBitrate: enc.maxBitrate, maxFramerate: enc.fps }, degradationPreference: 'maintain-framerate' }); }
      catch (e) { report('publish', e); throw new Error('Дэлгэцийн дүрсийг илгээж чадсангүй — дахин оролдоно уу'); }
      const at = stream.getAudioTracks()[0];
      if (at) { try { await room.localParticipant.publishTrack(at, { source: LK.Track.Source.ScreenShareAudio, dtx: false, red: false }); } catch (e) { report('publish-audio', e); } }
      const mine = { room, stream, tracks: stream.getTracks(), lkRoom: r.lkRoom };
      vt.addEventListener('ended', () => {   // Windows «Share зогсоох» / дамжуулж байсан цонх хаагдах
        if (my !== mine) return;
        report('source-ended', { message: 'video track ended' }, { kind: pick.kind });
        toast(pick.kind === 'window' ? 'Дамжуулж байсан цонх хаагдсан тул Live зогслоо — дараагийн удаа «Бүтэн дэлгэц»-ийг сонгоорой' : 'Дэлгэцийн дамжуулалт зогссон тул Live дууслаа', 'warning', 9000);
        stopLive('source-ended');
      });
      room.on(LK.RoomEvent.Disconnected, (reason) => {   // LiveKit өөрөө дахин холбогдох оролдлого бүтэлгүйтсэн
        if (my !== mine) return;
        report('lk-disconnected', { message: `reason=${reason}` });
        toast('Live сервертэй холболт тасарсан тул Live зогслоо — интернэтээ шалгаад дахин эхлүүлнэ үү', 'warning', 9000);
        stopLive('lk-disconnected');
      });
      my = mine;
      toast(pick.public ? '🔴 Live эхэллээ — Room-ын гишүүд ба нийтийн чатаас бүгд үзэж болно' : '🔴 Live эхэллээ — Room-ын гишүүд таны нэрний ард LIVE харж үзнэ', 'success', 6000);
    } catch (e) {
      console.warn('[Live] start:', e);
      toast(e?.message || 'Live эхлүүлж чадсангүй', 'error', 8000);
      try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
      try { room?.disconnect(); } catch {}
      if (started) { try { boundSock.emit('live:stop', { reason: 'start-failed' }); } catch {} }
      my = null;
    } finally { starting = false; if (b) b.disabled = false; paint(); }
  }

  function stopLive(reason = 'user') {
    const m = my; my = null;
    try { m?.tracks.forEach((t) => t.stop()); } catch {}
    try { m?.room.disconnect(); } catch {}
    try { boundSock?.emit('live:stop', { reason }); } catch {}
    if (m && reason === 'user') toast('Live зогслоо', 'info');
    paint();
  }
  window.addEventListener('beforeunload', () => { if (my) stopLive('unload'); });

  async function watchLive(streamerId) {
    if (!boundSock?.connected) { toast('Сервертэй холбогдоогүй байна', 'warning'); return; }
    const l = lives.get(String(streamerId));
    const r = await gxLiveAck(boundSock, 'live:watch', { streamerId: String(streamerId) });
    if (!r.ok) { toast(r.error || 'Live үзэх боломжгүй', r.code === 'SAME_GAME' ? 'warning' : 'error', 6000); return; }
    try { await window.api.liveOpenViewer({ token: r.token, url: r.url, lkRoom: r.lkRoom, streamer: l?.username || r.state?.username || 'Live', streamerId: String(streamerId), max: r.state?.max || 35 }); }
    catch (e) { report('viewer-open', e); toast(e?.message || 'Цонх нээж чадсангүй', 'error'); try { boundSock.emit('live:leave', { streamerId: String(streamerId) }); } catch {} }
  }

  // Preview / туршилт: window.gxLive._demo({ lives:[...] })
  window.gxLive = { get isLive() { return !!my; }, start: startLive, stop: stopLive, watch: watchLive, _demo: (s) => { lives = new Map((s.lives || []).map((l) => [String(l.userId), l])); if (s.mine) my = { room: { disconnect() {} }, tracks: [], lkRoom: 'demo' }; paint(); }, _pick: pickSource };
})();
