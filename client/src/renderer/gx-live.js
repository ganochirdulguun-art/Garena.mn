'use strict';
// ── Room Live (2026-10-03, эзэн): Discord маягийн дэлгэц дамжуулалт ──
//  • Room-ын толгойд «🔴 Live» товч → дэлгэц/цонх сонгох → LiveKit SFU (Датаком) руу 720p30 ≤2 Mbps H.264 илгээнэ.
//  • Гишүүдийн жагсаалтад streamer-ийн нэрний ард «● LIVE» — дарвал үзэгчийн цонх (live.html) нээгдэнэ.
//  • Сервер: нэг LAN тоглоомд байгаа хүнд татгалзана; тоглоомд нэгдвэл live:kick → цонх хаагдана.
//  • Төлөв серверээс live:state-ээр ирнэ (хэн Live, хэдэн үзэгч / дээд хязгаар).
(() => {
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode !== 'room') return;   // зөвхөн өрөөний цонх
  const $ = (id) => document.getElementById(id);
  const toast = (m, t = 'info', d = 4000) => { try { showToast(m, t, d); } catch { console.log(m); } };
  let lives = new Map();        // streamerId → { userId, username, viewers, max }
  let my = null;                // { room, tracks[] } — миний Live
  let boundSock = null;

  // ── Socket (app.js-ийн socket дахин үүсэхэд дахин холбоно) ──
  function bind(s) {
    if (!s || s === boundSock) return; boundSock = s;
    s.on('live:state', ({ lives: arr } = {}) => { lives = new Map((arr || []).map((l) => [String(l.userId), l])); paint(); });
    s.on('live:ended', ({ streamerId } = {}) => { try { window.api?.liveCloseViewer?.(String(streamerId)); } catch {} const l = lives.get(String(streamerId)); if (l) toast(`${l.username}-ийн Live дууслаа`, 'info'); });
    s.on('live:kick', ({ streamerId, reason } = {}) => { try { window.api?.liveCloseViewer?.(String(streamerId)); } catch {} toast(reason || 'Live үзэх боломжгүй боллоо', 'warning', 6000); });
    s.on('disconnect', () => { if (my) stopLive('disconnect'); });
  }
  setInterval(() => { try { if (typeof socket !== 'undefined' && socket) bind(socket); } catch {} }, 1000);
  try { window.api?.onLiveViewerClosed?.((streamerId) => { try { boundSock?.emit('live:leave', { streamerId: String(streamerId) }); } catch {} }); } catch {}

  // ── Товч (room-header-actions) ──
  function ensureButton() {
    if ($('btn-live')) return $('btn-live');
    const host = document.getElementById('rgc-actions') || document.querySelector('.room-header-actions'); if (!host) return null;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'btn-live'; b.className = 'btn btn-sm btn-live'; b.title = 'Дэлгэцээ Room-ын гишүүдэд шууд дамжуулах (720p · 30fps). Нэг LAN тоглоомд байгаа хүн үзэхгүй.';
    b.innerHTML = '<span class="live-dot"></span>Live';
    host.insertBefore(b, host.firstChild);
    b.addEventListener('click', () => (my ? stopLive('user') : startLive()));
    return b;
  }
  setInterval(ensureButton, 1500);

  function paint() {
    const me = String((typeof currentUser !== 'undefined' && currentUser?.id) || '');
    const mine = lives.get(me);
    const b = ensureButton();
    if (b) {
      if (my && mine) { b.classList.add('on'); b.innerHTML = `<span class="live-dot"></span>Live зогсоох <small>👁 ${mine.viewers}/${mine.max}</small>`; }
      else if (my) { b.classList.add('on'); b.innerHTML = '<span class="live-dot"></span>Live зогсоох'; }
      else { b.classList.remove('on'); b.innerHTML = '<span class="live-dot"></span>Live'; }
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
  }
  const ml = $('members-list');
  if (ml) new MutationObserver(() => paint()).observe(ml, { childList: true });

  // ── Дэлгэц сонгох цонх ──
  function pickSource() {
    return new Promise(async (resolve) => {
      let sources = [];
      try { sources = await window.api.liveSources(); } catch (e) { toast(e?.message || 'Дэлгэцийн жагсаалт авч чадсангүй', 'error'); return resolve(null); }
      if (!sources?.length) { toast('Дамжуулах дэлгэц/цонх олдсонгүй', 'warning'); return resolve(null); }
      const ov = document.createElement('div'); ov.className = 'live-picker';
      ov.innerHTML = `<div class="live-picker-box"><div class="live-picker-h"><b>🔴 Live — юуг дамжуулах вэ?</b><span>720p · 30fps · ~2 Mbps · Room-ын гишүүд үзнэ (нэг LAN тоглоомд байгаа хүн үзэхгүй)</span><button type="button" class="btn btn-sm" data-x>✕</button></div>
        <div class="live-picker-grid">${sources.map((s) => `<button type="button" class="live-src" data-id="${s.id}"><img src="${s.thumbnail}" alt=""><span>${s.kind === 'screen' ? '🖥 ' : '🪟 '}${escHtml(String(s.name || '').slice(0, 48))}</span></button>`).join('')}</div>
        <div class="live-picker-f"><label><input type="checkbox" id="live-audio" checked> Тоглоомын дууг хамт дамжуулах</label></div></div>`;
      document.body.appendChild(ov);
      const done = (v) => { ov.remove(); resolve(v); };
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) return done(null); const b = e.target.closest('.live-src'); if (b) done({ id: b.dataset.id, audio: !!ov.querySelector('#live-audio')?.checked }); });
    });
  }

  async function startLive() {
    if (my) return;
    if (typeof LivekitClient === 'undefined') { toast('Live модуль ачаалагдаагүй — аппаа шинэчилнэ үү', 'error'); return; }
    if (!boundSock?.connected) { toast('Сервертэй холбогдоогүй байна', 'warning'); return; }
    const pick = await pickSource(); if (!pick) return;
    const b = ensureButton(); if (b) { b.disabled = true; b.innerHTML = '<span class="live-dot"></span>Эхлүүлж байна…'; }
    try {
      await window.api.liveSelectSource(pick.id);
      const r = await new Promise((res) => boundSock.emit('live:start', {}, (a) => res(a || { ok: false, error: 'Хариу ирсэнгүй' })));
      if (!r.ok) throw new Error(r.error || 'Live эхлүүлж чадсангүй');
      const enc = r.encoding || { width: 1280, height: 720, fps: 30, maxBitrate: 2_000_000, codec: 'h264' };
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: enc.width, max: enc.width }, height: { ideal: enc.height, max: enc.height }, frameRate: { ideal: enc.fps, max: enc.fps } },
        audio: !!pick.audio,
      });
      const LK = LivekitClient;
      const room = new LK.Room({ adaptiveStream: false, dynacast: false });
      await room.connect(r.url, r.token);
      const vt = stream.getVideoTracks()[0];
      await room.localParticipant.publishTrack(vt, { source: LK.Track.Source.ScreenShare, simulcast: false, videoCodec: enc.codec, videoEncoding: { maxBitrate: enc.maxBitrate, maxFramerate: enc.fps }, degradationPreference: 'maintain-framerate' });
      const at = stream.getAudioTracks()[0];
      if (at) { try { await room.localParticipant.publishTrack(at, { source: LK.Track.Source.ScreenShareAudio, dtx: false, red: false }); } catch (e) { console.warn('[Live] audio:', e.message); } }
      vt.addEventListener('ended', () => stopLive('source-ended'));   // Windows «Share зогсоох» / цонх хаагдах
      my = { room, tracks: stream.getTracks() };
      toast('🔴 Live эхэллээ — Room-ын гишүүд таны нэрний ард LIVE харж үзнэ', 'success', 6000);
    } catch (e) {
      console.warn('[Live] start:', e);
      toast(e?.name === 'NotAllowedError' ? 'Дэлгэц сонгоогүй' : (e?.message || 'Live эхлүүлж чадсангүй'), 'error', 6000);
      try { boundSock.emit('live:stop'); } catch {}
      my = null;
    } finally { if (b) b.disabled = false; paint(); }
  }

  function stopLive(reason = 'user') {
    const m = my; my = null;
    try { m?.tracks.forEach((t) => t.stop()); } catch {}
    try { m?.room.disconnect(); } catch {}
    try { boundSock?.emit('live:stop'); } catch {}
    if (m && reason === 'user') toast('Live зогслоо', 'info');
    paint();
  }
  window.addEventListener('beforeunload', () => { if (my) stopLive('unload'); });

  async function watchLive(streamerId) {
    if (!boundSock?.connected) { toast('Сервертэй холбогдоогүй байна', 'warning'); return; }
    const l = lives.get(String(streamerId));
    const r = await new Promise((res) => boundSock.emit('live:watch', { streamerId: String(streamerId) }, (a) => res(a || { ok: false, error: 'Хариу ирсэнгүй' })));
    if (!r.ok) { toast(r.error || 'Live үзэх боломжгүй', r.code === 'SAME_GAME' ? 'warning' : 'error', 6000); return; }
    try { await window.api.liveOpenViewer({ token: r.token, url: r.url, lkRoom: r.lkRoom, streamer: l?.username || r.state?.username || 'Live', streamerId: String(streamerId), max: r.state?.max || 35 }); }
    catch (e) { toast(e?.message || 'Цонх нээж чадсангүй', 'error'); try { boundSock.emit('live:leave', { streamerId: String(streamerId) }); } catch {} }
  }

  // Preview / туршилт: window.gxLive._demo({ lives:[...] })
  window.gxLive = { start: startLive, stop: stopLive, watch: watchLive, _demo: (s) => { lives = new Map((s.lives || []).map((l) => [String(l.userId), l])); if (s.mine) my = { room: { disconnect() {} }, tracks: [] }; paint(); }, _pick: pickSource };
})();
