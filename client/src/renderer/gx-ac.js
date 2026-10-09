'use strict';
// ── 🚨 Хакны зөрчил (2026-10-04, эзэн) ──
// ЭЗЭН ба ADMIN-д мэдэгдэл (staff:notify type 'anticheat') → 🔔 + эзний самбарын «Хакны зөрчил» таб.
// ADMIN: «Бан жагсаалтад оруулах» (тайлбар заавал) эсвэл «Хэрэгсэхгүй». ЭЗЭН: тайлбарыг харж «⛔ BAN» / «Хэрэгсэхгүй»,
// эсвэл хэн нэгний нэр дээр баруун товч → «⛔ Бан хийх…» (шууд). Бан зөвхөн тухайн account-д (IP/компьютерээр биш).
(() => {
  const q = new URLSearchParams(location.search);
  const isMain = q.get('mode') !== 'room' && q.get('mode') !== 'dm';
  const $ = (id) => document.getElementById(id);
  const api = (m, p, b) => window.api.request(m, p, b);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t = 'info', d = 4000) => { try { showToast(m, t, d); } catch { console.log(m); } };
  const errMsg = (e) => e?.response?.data?.error || e?.message || 'Алдаа гарлаа';
  const confirmBox = async (title, msg) => { try { return await showConfirm(title, msg); } catch { return window.confirm(msg); } };
  const prompt = async (title, label, value = '') => { try { return await window.gxPrompt(title, label, value, { multiline: true, okText: 'Илгээх' }); } catch { return window.prompt(label, value); } };
  const ago = (t) => { const s = Math.max(0, (Date.now() - Date.parse(t || 0)) / 1000); return s < 60 ? 'саяхан' : s < 3600 ? `${Math.floor(s / 60)} мин` : s < 86400 ? `${Math.floor(s / 3600)} цаг` : `${Math.floor(s / 86400)} өдөр`; };
  const STATUS = { new: ['Шинэ', 'st-new'], nominated: ['Бан санал болгосон', 'st-nom'], dismissed: ['Хэрэгсэхгүй', 'st-dis'], banned: ['БАН', 'st-ban'] };
  let isOwner = false, scope = null, counts = { new: 0, nominated: 0 };

  function setBadges() {
    const n = isOwner ? counts.nominated + counts.new : counts.new;
    for (const id of ['gxo-ac-badge']) { const b = $(id); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } }
    const t = $('gxo-ac-tab-n'); if (t) t.textContent = n;
  }
  async function refreshCount() {
    try { const r = await api('get', '/anticheat/cases/count'); counts = { new: r.new || 0, nominated: r.nominated || 0 }; isOwner = !!r.is_owner; scope = 'ok'; setBadges(); return true; }
    catch { scope = null; return false; }
  }

  function detailHTML(c) {
    const d = c.detail || {};
    if (c.kind === 'module' && Array.isArray(d.modules)) return `<div class="ac-det"><b>WC3-д ачаалагдсан DLL:</b>${d.modules.map((m) => `<code>${esc(m)}</code>`).join('')}</div>`;
    if (c.kind === 'memory') {
      const rows = (d.diffs || []).slice(0, 12).map((x) => `<tr><td>+${esc(x.rva)}</td><td>${esc(x.len)}</td><td><code>${esc(x.file)}</code></td><td><code>${esc(x.mem)}</code></td></tr>`).join('');
      return `<div class="ac-det"><b>Game.dll ${esc(d.version || '')}</b> — код хэсэгт <b>${esc(d.diff_bytes)}</b> байт, <b>${esc(d.regions)}</b> газар өөрчлөгдсөн${d.relocated ? ' (relocated)' : ''}.
        <table class="ac-diff"><tr><th>RVA</th><th>урт</th><th>файл</th><th>санах ой</th></tr>${rows}</table>
        <small>Maphack нь Game.dll-ийн кодыг засдаг. Хэрэв ихэнх тоглогчид ижил өөрчлөлт гарвал гэмгүй (жишээ нь цонхны засвар) байж магадгүй — «Хэрэгсэхгүй + цаашид үл тоох».</small></div>`;
    }
    if (c.kind === 'unverified') {
      const dg = d.diag || {};
      const warned = d.warned_at ? `Анхааруулга DM: ${esc(d.warn_count || 1)} удаа, сүүлд ${new Date(Number(d.warned_at)).toLocaleString('mn-MN', { hour12: false })}` : 'Анхааруулга: хараахан илгээгээгүй (дараагийн холбогдоход илгээнэ)';
      return `<div class="ac-det">⚠ WC3 <b>администраторын эрхээр</b> (эсвэл өөр програмаас) ажилласан тул MapHack-ийн шалгалт хийгдэх боломжгүй байв. Зөрчил биш — тоглогчид засах заавар + DM анхааруулга очсон; <b>${esc(c.hits || 1)} удаа</b> давтсан (3/6/10 дээр ADMIN-д дахин мэдэгдэнэ).
        ${d.cause ? `<div><b>Шалтгаан:</b> ${esc(d.cause)}</div>` : ''}
        ${dg.parent || (dg.compat || []).length ? `<div><small>Нээсэн: <code>${esc(dg.parent || '?')}</code>${(dg.compat || []).length ? ` · Compat: <code>${(dg.compat || []).map(esc).join('</code> <code>')}</code>` : ''}${dg.elevated ? ` · elevated=${esc(dg.elevated)}` : ''}${dg.self_admin ? ' · Garena.mn admin' : ''}</small></div>` : ''}
        <div><small>${warned}</small></div></div>`;
    }
    if (c.kind === 'process') return `<div class="ac-det">Хориотой програм ажиллаж байсан: <code>${esc(c.tool)}</code>${d.warnings ? ` · нийт ${esc(d.warnings)} удаа` : ''}. WC3 нээгдээгүй.</div>`;
    return `<div class="ac-det"><code>${esc(JSON.stringify(d).slice(0, 400))}</code></div>`;
  }
  function caseHTML(c) {
    const [sl, sc] = STATUS[c.status] || [c.status, ''];
    const open = c.status === 'new' || c.status === 'nominated';
    const acts = [];
    if (open && isOwner) acts.push(`<button type="button" class="btn btn-sm ac-ban" data-ac-act="ban" data-id="${c.id}" data-name="${esc(c.username)}">⛔ BAN</button>`);
    if (c.status === 'new' && !isOwner) acts.push(`<button type="button" class="btn btn-primary btn-sm" data-ac-act="nominate" data-id="${c.id}" data-name="${esc(c.username)}">⚠ Бан жагсаалтад оруулах</button>`);
    if (open && (isOwner || c.status === 'new')) acts.push(`<button type="button" class="btn btn-sm" data-ac-act="dismiss" data-id="${c.id}" data-review="${c.severity !== 'high' && (c.kind === 'memory' || c.kind === 'module') ? 1 : 0}">Хэрэгсэхгүй</button>`);
    if (c.status === 'nominated' && !isOwner) acts.push('<span class="ac-wait">Эзний шийдвэр хүлээж байна</span>');
    return `<div class="ac-case ${c.severity === 'high' ? 'sev-high' : ''} ${sc}" data-ac-case="${c.id}">
      <div class="ac-h">
        <span class="ac-user"><b class="clickable-name" data-user-id="${esc(c.user_id)}">${esc(c.username || `#${c.user_id}`)}</b>${c.account_no ? `<small>ID ${esc(c.account_no)}</small>` : ''}${c.tier ? `<i class="ac-tier">${esc(c.tier)}</i>` : ''}${c.user_banned ? '<i class="ac-banned">БАНТАЙ</i>' : ''}</span>
        <span class="ac-st ${sc}">${esc(sl)}</span>
      </div>
      <div class="ac-what"><span class="ac-kind">${c.severity === 'high' ? '🔴' : '🟡'} ${esc(c.kind_label || c.kind)}</span><span class="ac-tool">${esc(c.tool || '')}</span></div>
      <div class="ac-meta">${c.hits > 1 ? `${c.hits} удаа · ` : ''}${c.room_name ? `${esc(c.room_name)} · ` : ''}${ago(c.last_at || c.created_at)}${c.user_cases > 1 ? ` · энэ хүний нийт ${c.user_cases} хэрэг` : ''}</div>
      ${c.nominate_note ? `<div class="ac-note">🛡 <b>${esc(c.nominated_by_name || 'ADMIN')}</b>: ${esc(c.nominate_note)}</div>` : ''}
      ${c.decision_note || c.decided_by_name ? `<div class="ac-note dec">${c.status === 'banned' ? '⛔' : '✓'} ${esc(c.decided_by_name || '')}${c.decision_note ? `: ${esc(c.decision_note)}` : ''}</div>` : ''}
      <details class="ac-more"><summary>Дэлгэрэнгүй</summary>${detailHTML(c)}</details>
      ${acts.length ? `<div class="ac-acts">${acts.join('')}</div>` : ''}
    </div>`;
  }

  let curStatus = 'open';
  /** Жагсаалтыг container-т зурна (эзний самбарын таб эсвэл модал). isStale() → true бол хоцорсон хариуг орхино. */
  async function renderList(container, isStale = () => false, only = null) {
    if (!container) return;
    container.innerHTML = '<div class="gx-empty"><b>Ачааллаж байна…</b></div>';
    if (curStatus === 'wc3' && only == null) return renderWc3(container, isStale);
    let r;
    try { r = await api('get', `/anticheat/cases?status=${only ? 'all' : curStatus}`); }
    catch (e) { if (!isStale()) container.innerHTML = `<div class="gx-empty"><b>Ачаалж чадсангүй</b><span>${esc(errMsg(e))}</span></div>`; return; }
    if (isStale()) return;
    isOwner = !!r.is_owner; counts = r.counts || counts; setBadges();
    let list = r.cases || []; if (only != null) list = list.filter((c) => String(c.id) === String(only));
    const tabs = only != null ? '' : `<div class="gx-subtabs ac-tabs">${[['open', `Нээлттэй <i>${(counts.new || 0) + (counts.nominated || 0)}</i>`], ['nominated', `Бан санал <i>${counts.nominated || 0}</i>`], ['closed', 'Шийдсэн'], ['wc3', 'ℹ WC3 мэдээлэл']].map(([k, l]) => `<button type="button" data-ac-tab="${k}" class="${curStatus === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const help = only != null ? '' : `<p class="ac-help">${isOwner ? 'ЭЗЭН: ADMIN-ы санал, тайлбарыг харж <b>⛔ BAN</b> эсвэл <b>Хэрэгсэхгүй</b>. Хэн нэгний нэр дээр баруун товч → «⛔ Бан хийх…» гэж шууд бандаж болно.' : 'ADMIN: хэргийг шалгаад <b>«Бан жагсаалтад оруулах»</b> (тайлбартай) эсвэл <b>«Хэрэгсэхгүй»</b>. Бан хийх эсэхийг эзэн шийднэ.'} Бан зөвхөн тухайн account-д — IP/компьютерээр биш (интернет кафе-гийн бусад тоглогч хохирохгүй).</p>`;
    container.innerHTML = `${tabs}${help}${list.length ? `<div class="ac-list">${list.map(caseHTML).join('')}</div>` : '<div class="gx-empty"><b>Зөрчил алга</b><span>Хакны илрэлт гарвал энд болон 🔔-д мэдэгдэнэ.</span></div>'}`;
    container.onclick = async (e) => {
      const tb = e.target.closest('[data-ac-tab]'); if (tb) { curStatus = tb.dataset.acTab; renderList(container, isStale, only); return; }
      const b = e.target.closest('[data-ac-act]'); if (!b) return;
      await act(b); renderList(container, isStale, only); refreshCount();
    };
  }

  // WC3 сессийн мэдээлэл (эзэн/глобал ADMIN): elevated WC3 = зөрчил биш (эзэн 2026-10-10); Game.dll хэш олонхоос өөр бол сэжигтэй
  async function renderWc3(container, isStale) {
    let r;
    try { r = await api('get', '/anticheat/wc3info'); }
    catch (e) { if (!isStale()) container.innerHTML = tabsHTML() + `<div class="gx-empty"><b>Зөвхөн эзэн / глобал ADMIN</b><span>${esc(errMsg(e))}</span></div>`; bindTabs(container, isStale); return; }
    if (isStale()) return;
    const rows = r.rows || [], hashes = r.hashes || {};
    const common = Object.entries(hashes).sort((a, b) => b[1] - a[1])[0];
    const list = rows.map((w) => {
      const n = w.game_sha ? hashes[w.game_sha] || 0 : 0;
      const odd = !!w.game_sha && common && w.game_sha !== common[0] && rows.length >= 4;
      const dg = w.diag || {};
      return `<div class="ac-case ${odd ? 'ac-odd' : ''}"><div class="ac-head"><b>${esc(w.username)}</b> <span class="ac-sev ${w.verified ? 'review' : 'info'}">${w.verified ? '✅ шалгагдсан' : '🟡 шалгагдаагүй (administrator)'}</span>
        <small>сесс ${esc(w.sessions)} · шалгагдаагүй ${esc(w.unverified_hits)} · сүүлд ${esc(String(w.last_at || '').slice(0, 16).replace('T', ' '))}</small></div>
        <div class="ac-det">${w.game_sha ? `Game.dll ${esc(w.game_ver || '?')} · ${esc(w.game_size || '?')} байт · <code title="${esc(w.game_sha)}">${esc(w.game_sha.slice(0, 12))}…</code> — <b>${n} хэрэглэгч</b> ижил файлтай${odd ? ' · <b style="color:#f59e0b">⚠ олонхоос ӨӨР файл</b>' : ''}` : 'Game.dll мэдээлэл алга (хуучин апп)'}
        ${w.cause ? `<div><small>Шалгагдаагүй шалтгаан: ${esc(w.cause)}</small></div>` : ''}${dg.parent ? `<div><small>WC3-ийг нээсэн: <code>${esc(dg.parent)}</code>${(dg.compat || []).length ? ' · compat: <code>' + (dg.compat || []).map(esc).join('</code> <code>') + '</code>' : ''}</small></div>` : ''}</div></div>`;
    }).join('');
    container.innerHTML = tabsHTML() + `<p class="ac-help">Эзний шийдвэр (2026-10-10): administrator эрхтэй WC3 <b>зөрчил биш</b> — тоглогчдод шаардлага тавихгүй. Апп WC3-ийг энгийн эрхээр асаахыг өөрөө оролддог (RunAsInvoker). Энд: хэн шалгагдсан/шалгагдаагүй, <b>Game.dll файл олонхоос өөр</b> хүн (хакны хувилбар байж болзошгүй — ADMIN сонирхоно).</p>
      ${common ? `<p class="ac-help">Хамгийн түгээмэл Game.dll: <code>${esc(common[0].slice(0, 12))}…</code> — ${common[1]} / ${rows.filter((w) => w.game_sha).length} хэрэглэгч</p>` : ''}
      ${list ? `<div class="ac-list">${list}</div>` : '<div class="gx-empty"><b>Мэдээлэл алга</b><span>Тоглогчид v3.2.7+ аппаар WC3 нээхэд энд цуглана.</span></div>'}`;
    bindTabs(container, isStale);
  }
  function tabsHTML() { return `<div class="gx-subtabs ac-tabs">${[['open', `Нээлттэй <i>${(counts.new || 0) + (counts.nominated || 0)}</i>`], ['nominated', `Бан санал <i>${counts.nominated || 0}</i>`], ['closed', 'Шийдсэн'], ['wc3', 'ℹ WC3 мэдээлэл']].map(([k, l]) => `<button type="button" data-ac-tab="${k}" class="${curStatus === k ? 'on' : ''}">${l}</button>`).join('')}</div>`; }
  function bindTabs(container, isStale) { container.onclick = (e) => { const tb = e.target.closest('[data-ac-tab]'); if (tb) { curStatus = tb.dataset.acTab; renderList(container, isStale, null); } }; }

  async function act(b) {
    const id = b.dataset.id, name = b.dataset.name || '';
    try {
      if (b.dataset.acAct === 'nominate') {
        const note = await prompt('⚠ Бан жагсаалтад оруулах', `${name} — яагаад бан хийх ёстой вэ? Эзэн энэ тайлбарыг харж шийднэ:`);
        if (note == null) return; if (String(note).trim().length < 3) { toast('Тайлбар бичнэ үү', 'warning'); return; }
        await api('post', `/anticheat/cases/${id}/nominate`, { note }); toast('Эзэнд илгээлээ', 'success');
      } else if (b.dataset.acAct === 'dismiss') {
        const note = await prompt('Хэрэгсэхгүй болгох', 'Шалтгаан (заавал биш):'); if (note == null) return;
        let ignore = false;
        if (b.dataset.review === '1') ignore = await confirmBox('Цаашид үл тоох уу?', 'Энэ DLL / Game.dll-ийн ижил өөрчлөлт дахин гарвал хэрэг үүсгэхгүй болгох уу? (Гэмгүй гэдэгт итгэлтэй бол «Тийм»)');
        const r = await api('post', `/anticheat/cases/${id}/dismiss`, { note, ignore }); toast(r.ignored ? `Хэрэгсэхгүй · ${r.ignored} зүйлийг цаашид үл тооно` : 'Хэрэгсэхгүй боллоо', 'info');
      } else if (b.dataset.acAct === 'ban') {
        const note = await prompt(`⛔ ${name}-г бан хийх`, 'Бан хийх шалтгаан (хэрэглэгчид харагдана). Зөвхөн энэ account бан авна:', 'MapHack');
        if (note == null) return;
        if (!await confirmBox('⛔ BAN', `${name}-ийн account-ыг платформоос хорих уу?`)) return;
        await api('post', `/anticheat/cases/${id}/ban`, { note }); toast(`⛔ ${name} бан авлаа`, 'success');
      }
    } catch (e) { toast(errMsg(e), 'error'); }
  }

  /** Нэр дээр баруун товч (эзэн): бантай бол цуцлах, үгүй бол бан хийх. */
  async function banToggle(uid, name) {
    const st = await api('get', `/anticheat/users/${uid}/status`);
    if (st.banned) {
      if (!await confirmBox('Бан цуцлах', `${st.username || name} бантай байна${st.ban_reason ? ` («${st.ban_reason}»)` : ''}. Банг цуцлах уу?`)) return;
      await api('post', `/anticheat/users/${uid}/unban`); toast(`✓ ${st.username || name}-ийн бан цуцлагдлаа`, 'success'); return;
    }
    const reason = await prompt(`⛔ ${st.username || name}-г бан хийх`, `Шалтгаан (хэрэглэгчид харагдана)${st.open_cases ? ` · нээлттэй ${st.open_cases} хакны хэрэг бий` : ''}. Зөвхөн энэ account бан авна:`, st.open_cases ? 'MapHack' : '');
    if (reason == null) return;
    if (!await confirmBox('⛔ BAN', `${st.username || name}-ийн account-ыг платформоос хорих уу?`)) return;
    await api('post', `/anticheat/users/${uid}/ban`, { reason }); toast(`⛔ ${st.username || name} бан авлаа`, 'success'); refreshCount();
  }

  /** Нэг хэргийн модал (Room ADMIN-ы 🔔 «Шалгах» товч). */
  function openCase(id) {
    let ov = $('ac-modal');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'ac-modal'; ov.className = 'ac-modal';
      ov.innerHTML = '<div class="ac-modal-box"><div class="ac-modal-h"><b>🚨 Хакны зөрчил</b><button type="button" class="gx-x" data-ac-close>✕</button></div><div class="ac-modal-body" id="ac-modal-body"></div><button type="button" class="btn btn-sm ac-all" data-ac-all>Бүх хэргийг харах</button></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-ac-close]')) ov.remove(); if (e.target.closest('[data-ac-all]')) { curStatus = 'open'; renderList($('ac-modal-body')); } });
    }
    renderList($('ac-modal-body'), () => false, id);
  }

  // ── Мэдэгдэл (зөвхөн үндсэн цонх; сервер зөвхөн ЭЗЭН/ADMIN-д илгээдэг) ──
  if (isMain) {
    let bound = null;
    setInterval(() => {
      try {
        if (typeof socket === 'undefined' || !socket || socket === bound) return;
        bound = socket;
        socket.on('staff:notify', (p = {}) => {
          if (p.type !== 'anticheat') return;
          refreshCount();
          const txt = p.nominated ? `${p.by_username || 'ADMIN'} ${p.username}-г бан жагсаалтад оруулав` : `${p.username} — ${p.kind_label || p.kind}: ${p.tool || ''}`;
          toast(`🚨 ${txt}`, 'warning', 8000);
          try { playSound('notify'); } catch {}
          try { window.gxNotif?.push({ type: 'ac', icon: p.nominated ? '⚠' : '🚨', caseId: p.case_id, text: txt, sub: p.note || (p.severity === 'high' ? 'Өндөр эрсдэл' : 'Шалгах шаардлагатай'), btn: 'Шалгах' }); } catch {}
          if ($('tab-owner')?.classList.contains('active') && document.querySelector('[data-gxo-tab="cheats"].on')) { try { renderList($('gxo-body')); } catch {} }
        });
        socket.on('user:banned', ({ reason } = {}) => { toast(`🚫 Таны account платформоос хоригдлоо${reason ? ` — ${reason}` : ''}`, 'error', 15000); });
      } catch {}
    }, 1500);
    setTimeout(refreshCount, 3500);
    setInterval(() => { if (scope) refreshCount(); }, 5 * 60 * 1000);
  }

  window.gxAC = { renderList, openCase, banToggle, refreshCount };
})();
