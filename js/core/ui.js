// core/ui.js
export const $ = (s, r=document) => r.querySelector(s);
export const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

export function showNotification(message, type='info', timeout=3500){
  const container = $('#notificationContainer');
  if (!container) { alert(message); return; }
  const n = document.createElement('div');
  n.className = `notification ${type}`;
  n.innerHTML = `
    <div class="notification-content">
      <div class="notification-icon">
        <i class="fas ${type==='success'?'fa-check-circle':type==='error'?'fa-exclamation-circle':'fa-info-circle'}"></i>
      </div>
      <div class="notification-message">${escapeHtml(message)}</div>
    </div>
    <div class="notification-close"><i class="fas fa-times"></i></div>
  `;
  container.appendChild(n);
  const close = n.querySelector('.notification-close');
  close?.addEventListener('click', ()=> n.remove());
  setTimeout(()=>{ n.classList.add('show'); }, 10);
  setTimeout(()=>{ n.classList.remove('show'); setTimeout(()=> n.remove(), 300); }, timeout);
}

function escapeHtml(str){
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

export function setButtonLoading(btn, on){
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const sp = btn.querySelector('.btn-spinner');
  if (on){
    text && (text.style.display='none');
    sp && (sp.style.display='inline-block');
    btn.classList.add('processing');
    btn.disabled = true;
  } else {
    text && (text.style.display='inline-block');
    sp && (sp.style.display='none');
    btn.classList.remove('processing');
    btn.disabled = false;
  }
}

export function activateMenu(itemEl){
  $$('.menu-item').forEach(a=>a.classList.remove('active'));
  if (itemEl) itemEl.classList.add('active');
}

export function showPage(pageId){
  $$('.content-page').forEach(p=>p.style.display='none');
  const el = $('#'+pageId);
  if (el) el.style.display='block';
}

export function toggleSidebar(){
  const sb = $('#sidebar');
  if (!sb) return;
  const willOpen = !sb.classList.contains('open');
  sb.classList.toggle('open', willOpen);
  document.body.classList.toggle('sidebar-open', willOpen);
}

export function closeSidebarOnMobile(){
  const sb = $('#sidebar');
  if (!sb) return;
  if (window.innerWidth <= 768){
    sb.classList.remove('open');
    document.body.classList.remove('sidebar-open');
  }
}

// ===== MAP TRACKING UI (dipindahkan dari map.js) =====
export function ensureMapTrackingUI({ onStart, onStop } = {}){
  const bar = document.getElementById('trackBar');
  if (!bar) return null;

  // tampilkan bar (kalau mapPage dibuka)
  bar.style.display = 'flex';

  // bind event sekali saja
  if (bar.dataset.bound === '1') return bar;
  bar.dataset.bound = '1';

  const btnStart = document.getElementById('btnStartTrack');
  const btnStop  = document.getElementById('btnStopTrack');

  btnStart?.addEventListener('click', () => {
    try { onStart && onStart(); } catch (e) {}
  });

  btnStop?.addEventListener('click', () => {
    try { onStop && onStop(); } catch (e) {}
  });

  return bar;
}

export function setMapTrackingButtons(isTracking){
  const btnStart = document.getElementById('btnStartTrack');
  const btnStop  = document.getElementById('btnStopTrack');
  if (btnStart) btnStart.disabled = !!isTracking;
  if (btnStop)  btnStop.disabled  = !isTracking;
}

export function setTrackVehicleOptionsUI(vehicles, { keepValue = true } = {}){
  const sel = document.getElementById('trackVehiclePick');
  if (!sel) return;

  const cur = keepValue ? (sel.value || '') : '';
  const opts = (vehicles || []).map(v => {
    const code = String(v.code || '');
    const type = String(v.type || '');
    const st   = String(v.status || '');
    // aman: karena value dari server, minimal escape attribute
    const safeVal = code.replaceAll('"','&quot;');
    const label = `${code} • ${type} • ${st}`;
    return `<option value="${safeVal}">${label}</option>`;
  }).join('');

  sel.innerHTML = `<option value="">Pilih kendaraan...</option>${opts}`;

  if (cur) sel.value = cur;
}

// ============================
// ✅ GPS Permission Gate + Beep
// ============================
let _gpsBlockerEl = null;

export function showGpsBlocker({
  title = 'Izin Lokasi Diperlukan',
  message = 'Aplikasi ini memerlukan akses GPS/Location.',
  detail = '',
  showLogout = false,
  onRequest = null,
  onLogout = null
} = {}){
  if (_gpsBlockerEl){
    const t = _gpsBlockerEl.querySelector('[data-gps-title]');
    const m = _gpsBlockerEl.querySelector('[data-gps-message]');
    const d = _gpsBlockerEl.querySelector('[data-gps-detail]');
    if (t) t.textContent = title;
    if (m) m.textContent = message;
    if (d) d.textContent = detail || '';
    const lo = _gpsBlockerEl.querySelector('[data-gps-logout]');
    if (lo) lo.style.display = showLogout ? 'inline-flex' : 'none';

    // ✅ update callbacks (agar tombol tidak "stuck" memakai handler lama)
    _gpsBlockerEl.__onRequest = onRequest;
    _gpsBlockerEl.__onLogout = onLogout;
    return _gpsBlockerEl;
  }

  const wrap = document.createElement('div');
  wrap.id = 'gpsBlocker';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(2,6,23,.75);backdrop-filter:blur(6px);padding:16px;';
  wrap.innerHTML = `
    <div style="max-width:520px;width:100%;background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden;">
      <div style="padding:16px 18px;border-bottom:1px solid #eee;display:flex;gap:10px;align-items:center;">
        <div style="width:40px;height:40px;border-radius:14px;background:#0ea5e9;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">📍</div>
        <div style="flex:1;">
          <div data-gps-title style="font-weight:1000;font-size:16px;line-height:1.2;">${title}</div>
          <div data-gps-message style="font-weight:700;font-size:12px;color:#475569;margin-top:4px;">${message}</div>
        </div>
      </div>
      <div style="padding:16px 18px;">
        <div data-gps-detail style="font-size:12px;color:#334155;line-height:1.4;white-space:pre-wrap;">${detail || ''}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;">
          <button data-gps-request class="btn-primary" style="border-radius:14px;">
            <span class="btn-text">Izinkan Lokasi</span>
            <span class="btn-spinner" style="display:none;"><i class="fas fa-spinner fa-spin"></i></span>
          </button>
          <button data-gps-retry class="btn-secondary" style="border-radius:14px;">
            <span class="btn-text">Cek Lagi</span>
            <span class="btn-spinner" style="display:none;"><i class="fas fa-spinner fa-spin"></i></span>
          </button>
          <button data-gps-logout class="btn-danger" style="border-radius:14px;display:${showLogout ? 'inline-flex' : 'none'};">
            <span class="btn-text">Logout</span>
            <span class="btn-spinner" style="display:none;"><i class="fas fa-spinner fa-spin"></i></span>
          </button>
        </div>
        <div style="margin-top:10px;font-size:11px;color:#64748b;line-height:1.35;">
          Jika Anda menekan <b>Block</b>, buka pengaturan browser & aktifkan izin Lokasi untuk situs ini.
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  _gpsBlockerEl = wrap;

  // simpan callback terbaru
  wrap.__onRequest = onRequest;
  wrap.__onLogout = onLogout;

  const runBtn = async (btn, fn) => {
    if (!btn) return;
    try{
      setButtonLoading(btn, true);
      await Promise.resolve(fn && fn());
    }catch(e){
      // ignore
    }finally{
      setButtonLoading(btn, false);
    }
  };

  wrap.querySelector('[data-gps-request]')?.addEventListener('click', ()=>{
    runBtn(wrap.querySelector('[data-gps-request]'), ()=> wrap.__onRequest && wrap.__onRequest(false));
  });
  wrap.querySelector('[data-gps-retry]')?.addEventListener('click', ()=>{
    runBtn(wrap.querySelector('[data-gps-retry]'), ()=> wrap.__onRequest && wrap.__onRequest(true));
  });
  wrap.querySelector('[data-gps-logout]')?.addEventListener('click', ()=>{
    runBtn(wrap.querySelector('[data-gps-logout]'), ()=> wrap.__onLogout && wrap.__onLogout());
  });

  return wrap;
}

export function hideGpsBlocker(){
  if (!_gpsBlockerEl) return;
  try{ _gpsBlockerEl.remove(); }catch(e){}
  _gpsBlockerEl = null;
}

export function playBeep({ durationMs=180, freq=880, volume=0.18 } = {}){
  try{
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = playBeep._ctx || (playBeep._ctx = new AC());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = Number(freq) || 880;
    gain.gain.value = Math.max(0, Math.min(Number(volume) || 0.18, 1));
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + Math.max(0.05, durationMs/1000));
  }catch(e){}
}


// =============================
// Voice (TTS) helpers for proximity notifications
// =============================
let _voiceUnlocked = false;
export async function unlockVoiceOnce(){
  if (_voiceUnlocked) return true;
  try{
    // beberapa browser perlu resume audio context + permission dari gesture user
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC){
      const ctx = playBeep._ctx || (playBeep._ctx = new AC());
      if (ctx.state === 'suspended') await ctx.resume();
    }
  }catch(e){}
  _voiceUnlocked = true;
  return true;
}

export function speakText(text, { lang='id-ID', rate=1.0, pitch=1.0, volume=1.0 } = {}){
  try{
    const t = String(text||'').trim();
    if (!t) return false;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;

    // stop queue sebelumnya agar tidak menumpuk
    try{ window.speechSynthesis.cancel(); }catch(e){}

    const u = new SpeechSynthesisUtterance(t);
    u.lang = lang;
    u.rate = Math.max(0.7, Math.min(Number(rate)||1.0, 1.2));
    u.pitch = Math.max(0.8, Math.min(Number(pitch)||1.0, 1.2));
    u.volume = Math.max(0, Math.min(Number(volume)||1.0, 1));

    window.speechSynthesis.speak(u);
    return true;
  }catch(e){
    return false;
  }
}
