import * as api from '../core/api.js';
import { $, showNotification, setButtonLoading } from '../core/ui.js';

export function renderFamily(user){
  const list = $('#familyList');
  if (!list) return;
  const fam = user?.family || [];
  if (!fam.length){
    list.innerHTML = '<p class="empty-text">Tidak ada data keluarga.</p>';
    return;
  }
  list.innerHTML = fam.map(m=>`
    <div class="family-member">
      <label>
        <input type="checkbox" class="famChk" value="${escapeHtml(m.nik)}" checked>
        <span>${escapeHtml(m.name)} <small>(${escapeHtml(m.relationship||m.category||'-')})</small></span>
      </label>
    </div>
  `).join('');
}

export async function confirmArrival(session, user){
  const btn = $('#confirmArrivalBtn');
  try{
    setButtonLoading(btn,true);
    const nikList = [user.nik];
    document.querySelectorAll('.famChk:checked').forEach(ch=> nikList.push(ch.value));
    await api.confirmArrival(session.sessionId, JSON.stringify(nikList), session.activeTripId || '');
    showNotification('Kedatangan berhasil dikonfirmasi', 'success');
    updateStatusUI(true);
  } catch(err){
    showNotification(err.message||'Gagal konfirmasi', 'error');
    throw err;
  } finally {
    setButtonLoading(btn,false);
  }
}

export function updateStatusUI(arrived){
  const card = $('#userArrivalStatus');
  if (!card) return;
  if (arrived){
    card.classList.add('arrived');
    card.querySelector('.status-icon i').className = 'fas fa-check-circle';
    card.querySelector('.status-details h4').textContent = 'Telah Konfirmasi';
    card.querySelector('.status-details p').textContent = 'Terima kasih. Status Anda sudah tercatat.';
  }
}

function escapeHtml(str){
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
