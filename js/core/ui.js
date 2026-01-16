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
