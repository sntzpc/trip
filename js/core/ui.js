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
  sb?.classList.toggle('show');
}

export function closeSidebarOnMobile(){
  const sb = $('#sidebar');
  if (window.innerWidth <= 768) sb?.classList.remove('show');
}
