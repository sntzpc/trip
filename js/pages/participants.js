import * as api from '../core/api.js';
import { $ } from '../core/ui.js';
import { createTablePager } from '../core/table_pager.js';

let lastParticipants = [];
let pager = null;

export async function loadParticipants(session, filter='all'){
  const tripId = session?.activeTripId || '';
  const res = await api.getParticipants(session.sessionId, tripId, filter);
  lastParticipants = res.participants || [];

  const container = document.querySelector('.participants-table-container');
  const tbody = $('#participantsTable tbody');

  if (!pager){
    pager = createTablePager({
      containerEl: container,
      tbodyEl: tbody,
      searchPlaceholder: 'Cari nama / NIK / hubungan / region / unit / kendaraan...',
      getRowText: (p)=> {
        const nama = p.Nama || p.name || '';
        const nik  = p.NIK || p.nik || '';
        const rel  = p.Relationship || p.Category || p.relationship || '';
        const reg  = p.Region || p.region || '';
        const est  = p.Estate || p.estate || '';
        const veh  = p.Vehicle || p.vehicle || '';
        return `${nama} ${nik} ${rel} ${reg} ${est} ${veh}`;
      },
      renderRowHtml: (p, idx)=> {
        const arrived = (p.Arrived===true || p.Arrived==='TRUE' || p.Arrived==='true');
        return `
          <tr>
            <td>${idx}</td>
            <td>${esc(p.Nama||p.name||'-')}</td>
            <td>${esc(p.NIK||p.nik||'-')}</td>
            <td>${esc(p.Relationship||p.Category||p.relationship||'-')}</td>

            <!-- ✅ kolom baru -->
            <td>${esc(p.Region||p.region||'-')}</td>
            <td>${esc(p.Estate||p.estate||'-')}</td>

            <td>${esc(p.Vehicle||p.vehicle||'-')}</td>
            <td>${arrived
              ? '<span class="badge success">Tiba</span>'
              : '<span class="badge warning">Belum</span>'
            }</td>
            <td>${esc(p.ArrivalTime ? fmtDt(p.ArrivalTime) : '-')}</td>
          </tr>
        `;
      }
    });
  }

  pager.setData(lastParticipants);
}

export function searchAndRender(q){
  const box = document.querySelector('.pager-search');
  if (box){
    box.value = q || '';
    box.dispatchEvent(new Event('input'));
  }
}

function fmtDt(v){
  try{ return new Date(v).toLocaleString('id-ID'); } catch { return String(v); }
}
function esc(s){
  return String(s ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
