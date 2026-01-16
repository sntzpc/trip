import * as api from '../core/api.js';
import { $, showNotification } from '../core/ui.js';

export async function loadDashboard(session){
  const tripId = session?.activeTripId || '';
  const res = await api.getDashboard(session.sessionId, tripId);
  const d = res.data;
  $('#totalParticipants').textContent = d.totalParticipants||0;
  $('#totalVehicles').textContent = d.totalVehicles||0;
  $('#totalArrived').textContent = d.totalArrived||0;
  $('#totalOnRoad').textContent = d.totalOnRoad||0;

  // Dynamic breakdown (categories)
  const breakdown = d.breakdown || {};
  renderBreakdown(breakdown);
}

function renderBreakdown(breakdown){
  // If old UI has 3 fixed cards, we fill if available, else show first 3.
  const keys = Object.keys(breakdown);
  const mapIds = [
    { key: 'staff', id: 'staffArrived', label: 'Staff' },
    { key: 'istri', id: 'wifeArrived', label: 'Istri' },
    { key: 'anak', id: 'childArrived', label: 'Anak' }
  ];
  // Fill known
  mapIds.forEach(({key,id})=>{
    if ($('#'+id)) $('#'+id).textContent = breakdown[key] ?? 0;
  });

  // Extra categories -> append cards
  const container = $('#arrivalDetails .summary-cards');
  if (!container) return;

  // Remove previously generated extras
  container.querySelectorAll('[data-dyn="1"]').forEach(el=>el.remove());

  keys.filter(k => !mapIds.some(m=>m.key===k)).forEach(k=>{
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.dataset.dyn = '1';
    card.innerHTML = `<h4>${escapeHtml(k)}</h4><p>${breakdown[k]||0}</p>`;
    container.appendChild(card);
  });
}

function escapeHtml(str){
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
