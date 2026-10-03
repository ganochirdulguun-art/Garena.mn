'use strict';
// Room Live үзэгчийн цонх (2026-10-03): ?token=&url=&room=&streamer=&max=&streamerId=  (demo=1 → preview)
// LiveKit SFU-д зөвхөн subscribe-ээр холбогдоно; үзэгчийн тоо = өрөөний оролцогч − 1 (streamer).
(() => {
  const q = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const streamer = q.get('streamer') || 'Live';
  const max = Number(q.get('max') || 35);
  const streamerId = q.get('streamerId') || '';
  document.title = `● LIVE — ${streamer} — Garena.mn`;
  $('streamer').textContent = streamer;
  $('v-max').textContent = String(max);
  const video = $('video');
  let room = null, muted = false;

  const setMsg = (text, spin = false) => { const m = $('msg'); if (!text) { m.classList.add('hidden'); return; } m.classList.remove('hidden'); m.querySelector('.spin').style.display = spin ? '' : 'none'; $('msg-text').innerHTML = text; };
  const setViewers = (nNow) => { $('v-now').textContent = String(Math.max(0, nNow)); $('viewers').classList.toggle('full', nNow >= max); };

  const close = () => { try { room?.disconnect(); } catch {} try { window.api?.liveViewerClosed?.(streamerId); } catch {} window.close(); };
  $('btn-close').addEventListener('click', close);
  $('btn-full').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); });
  $('btn-mute').addEventListener('click', () => { muted = !muted; video.muted = muted; $('btn-mute').textContent = muted ? '🔇' : '🔊'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen(); else if (e.key === 'Escape') close(); if (e.key === 'f' || e.key === 'F') $('btn-full').click(); if (e.key === 'm' || e.key === 'M') $('btn-mute').click(); });
  video.addEventListener('dblclick', () => $('btn-full').click());
  window.addEventListener('beforeunload', () => { try { room?.disconnect(); } catch {} try { window.api?.liveViewerClosed?.(streamerId); } catch {} });

  // Preview / demo: сервергүйгээр харагдах байдал
  if (q.get('demo')) {
    setViewers(Number(q.get('viewers') || 12));
    setMsg('');
    const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
    const ctx = cv.getContext('2d');
    let t = 0;
    const draw = () => {
      t += 0.02;
      const g = ctx.createLinearGradient(0, 0, 1280, 720); g.addColorStop(0, '#1b2a4a'); g.addColorStop(1, '#3a1b2a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 12; i++) ctx.fillRect(100 + i * 95, 360 + Math.sin(t + i) * 120, 40, 40);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 44px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('Warcraft III — дэлгэцийн дамжуулалт (demo)', 640, 330);
      ctx.font = '22px Segoe UI'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText('720p · 30fps · 2 Mbps · H.264', 640, 380);
      requestAnimationFrame(draw);
    };
    draw();
    video.style.display = 'none'; cv.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000'; document.querySelector('.stage').appendChild(cv);
    $('stats').textContent = '1280×720 · 30fps · 1.9 Mbps';
    return;
  }

  const token = q.get('token'), url = q.get('url');
  if (!token || !url || typeof LivekitClient === 'undefined') { setMsg('<b>Холбогдож чадсангүй</b>Live-ийн мэдээлэл дутуу'); return; }
  const LK = LivekitClient;
  room = new LK.Room({ adaptiveStream: true, dynacast: false, disconnectOnPageLeave: true });
  const recount = () => setViewers(Math.max(0, room.numParticipants - 1));   // streamer-ийг хасна
  const attach = (track) => {
    if (track.kind === LK.Track.Kind.Video) { track.attach(video); setMsg(''); }
    else if (track.kind === LK.Track.Kind.Audio) { const a = track.attach(); a.muted = muted; document.body.appendChild(a); }
  };
  room
    .on(LK.RoomEvent.TrackSubscribed, (track) => attach(track))
    .on(LK.RoomEvent.TrackUnsubscribed, (track) => { try { track.detach(); } catch {} })
    .on(LK.RoomEvent.ParticipantConnected, recount)
    .on(LK.RoomEvent.ParticipantDisconnected, (p) => { recount(); if (p.identity === `u${streamerId}`) setMsg('<b>Live дууслаа</b>Streamer дамжуулалтаа зогсоолоо'); })
    .on(LK.RoomEvent.Disconnected, () => setMsg('<b>Холболт тасарлаа</b>Live дууссан эсвэл сүлжээ тасарсан'))
    .on(LK.RoomEvent.Reconnecting, () => setMsg('Дахин холбогдож байна…', true))
    .on(LK.RoomEvent.Reconnected, () => setMsg(''))
    .on(LK.RoomEvent.ConnectionQualityChanged, () => {});
  // Статистик: бит/с, нягтрал (5с тутам)
  setInterval(async () => {
    try {
      const pub = [...room.remoteParticipants.values()].flatMap((p) => [...p.videoTrackPublications.values()])[0];
      const tr = pub?.track; if (!tr) return;
      const st = await tr.getRTCStatsReport?.();
      let bytes = 0, w = 0, h = 0, fps = 0;
      st?.forEach((s) => { if (s.type === 'inbound-rtp' && s.kind === 'video') { bytes = s.bytesReceived; w = s.frameWidth; h = s.frameHeight; fps = s.framesPerSecond; } });
      if (!w) return;
      const now = Date.now(); const prev = window.__lkPrev || { t: now, b: bytes }; window.__lkPrev = { t: now, b: bytes };
      const mbps = prev.t === now ? 0 : ((bytes - prev.b) * 8 / ((now - prev.t) / 1000)) / 1e6;
      $('stats').textContent = `${w}×${h} · ${Math.round(fps || 0)}fps · ${mbps.toFixed(1)} Mbps`;
    } catch {}
  }, 5000);
  (async () => {
    try {
      setMsg('Холбогдож байна…', true);
      await room.connect(url, token, { autoSubscribe: true });
      recount();
      const hasVideo = [...room.remoteParticipants.values()].some((p) => p.videoTrackPublications.size);
      setMsg(hasVideo ? '' : 'Streamer-ийн дэлгэцийг хүлээж байна…', true);
    } catch (e) { setMsg(`<b>Холбогдож чадсангүй</b>${String(e?.message || e).slice(0, 120)}`); }
  })();
})();
