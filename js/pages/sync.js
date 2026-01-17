import * as api from '../core/api.js';
import { $, showNotification } from '../core/ui.js';
import { queueList, queueUpdate, queueDelete, resetAllOfflineData } from '../core/idb.js';

function fmtTs(ms){
  try{ return ms ? new Date(ms).toLocaleString('id-ID') : '-'; }catch{ return '-'; }
}

function escapeHtml(str){
  return String(str||'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

export async function renderSyncPage(session){
  const sum = await api.getQueueSummary();
  $('#syncTotal') && ($('#syncTotal').textContent = sum.total);
  $('#syncPending') && ($('#syncPending').textContent = sum.pending);
  $('#syncSynced') && ($('#syncSynced').textContent = sum.synced);
  $('#syncFailed') && ($('#syncFailed').textContent = sum.failed);

  const list = await queueList();
  const tbody = $('#syncTableBody');
  if (!tbody) return;

  tbody.innerHTML = (list||[]).map((it, idx)=>{
    const st = it.status || 'pending';
    const badge = st==='pending' ? 'warning' : st==='synced' ? 'success' : 'danger';
    const msg = (st==='failed') ? (it.lastError||'') : (it.result?.message||'');
    return `
      <tr data-id="${it.id}">
        <td>${idx+1}</td>
        <td><span class="badge ${badge}">${escapeHtml(st)}</span></td>
        <td>${escapeHtml(it.action||'-')}</td>
        <td style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;">${escapeHtml(it.opId||'-')}</td>
        <td>${fmtTs(it.createdAt)}</td>
        <td>${fmtTs(it.lastAttemptAt)}</td>
        <td>${escapeHtml(msg||'-')}</td>
        <td style="white-space:nowrap;">
          ${st!=='synced' ? `<button class="btn-mini" data-act="retry">Retry</button>` : ''}
          <button class="btn-mini danger" data-act="del">Hapus</button>
        </td>
      </tr>
    `;
  }).join('') || `
    <tr><td colspan="8" style="text-align:center; color:#777; padding:18px;">Tidak ada antrian.</td></tr>
  `;

  tbody.querySelectorAll('button[data-act]')?.forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const tr = e.target.closest('tr');
      const id = Number(tr?.dataset?.id||0);
      const act = e.target.dataset.act;
      if (!id) return;
      if (act === 'del'){
        await queueDelete(id);
        showNotification('Antrian dihapus', 'success');
        await renderSyncPage(session);
      } else if (act === 'retry'){
        await queueUpdate(id, { status:'pending', lastError:'' });
        const r = await api.processQueue(session.sessionId, { maxItems: 1 });
        showNotification(r?.success ? 'Diproses' : (r?.message||'Gagal'), r?.success ? 'success' : 'error');
        await renderSyncPage(session);
      }
    });
  });

  bindSyncButtons(session);
}

let _bound = false;
function bindSyncButtons(session){
  if (_bound) return;
  _bound = true;

  $('#btnSyncNow')?.addEventListener('click', async ()=>{
    const r = await api.processQueue(session.sessionId, { maxItems: 50 });
    if (!r.success) showNotification(r.message||'Gagal', 'error');
    else showNotification(`Selesai memproses ${r.processed} antrian`, 'success');
    await renderSyncPage(session);
  });

  $('#btnRetryFailed')?.addEventListener('click', async ()=>{
    const r = await api.retryFailed(session.sessionId, { maxItems: 50 });
    if (!r.success) showNotification(r.message||'Gagal', 'error');
    else showNotification(`Selesai memproses ${r.processed} antrian`, 'success');
    await renderSyncPage(session);
  });

  $('#btnResetOffline')?.addEventListener('click', async ()=>{
    if (!confirm('Reset offline akan menghapus cache & antrian di perangkat ini. Lanjutkan?')) return;
    await resetAllOfflineData();
    showNotification('Offline data direset', 'success');
    await renderSyncPage(session);
  });
}
