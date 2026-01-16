// js/core/table_pager.js
const norm = (s) => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')  // buang aksen
  .replace(/\s+/g,' ')
  .trim();

function smartMatch(rowText, query){
  query = norm(query);
  if (!query) return true;

  // multi kata: semua token harus match
  const tokens = query.split(' ').filter(Boolean);
  const text = norm(rowText);

  // "pintar": token boleh cocok parsial, urut bebas
  return tokens.every(t => text.includes(t));
}

function makePagerUI(container, opts){
  const wrap = document.createElement('div');
  wrap.className = 'table-pager';
  wrap.style.display = 'flex';
  wrap.style.flexWrap = 'wrap';
  wrap.style.gap = '10px';
  wrap.style.alignItems = 'center';
  wrap.style.justifyContent = 'space-between';
  wrap.style.margin = '10px 0 12px';

  wrap.innerHTML = `
    <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
      <input class="pager-search" type="text" placeholder="${opts.searchPlaceholder || 'Cari...'}"
        style="padding:10px 12px; border:2px solid #ddd; border-radius:8px; min-width:220px;"/>
      <select class="pager-size"
        style="padding:10px 12px; border:2px solid #ddd; border-radius:8px;">
        ${opts.pageSizes.map(n => `<option value="${n}">${n}/halaman</option>`).join('')}
      </select>
      <div class="pager-info" style="color:#666; font-weight:600;"></div>
    </div>
    <div class="pager-nav" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;"></div>
  `;

  container.insertBefore(wrap, container.firstChild);
  return wrap;
}

function renderNav(navEl, page, totalPages, onGo){
  const mkBtn = (label, p, disabled=false, active=false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.padding = '8px 10px';
    b.style.border = '2px solid #ddd';
    b.style.borderRadius = '8px';
    b.style.background = active ? '#ecf0f1' : 'white';
    b.style.fontWeight = active ? '800' : '600';
    b.style.cursor = disabled ? 'not-allowed' : 'pointer';
    b.disabled = disabled;
    b.addEventListener('click', ()=> onGo(p));
    return b;
  };

  navEl.innerHTML = '';
  if (totalPages <= 1) return;

  navEl.appendChild(mkBtn('⟨', 1, page===1));
  navEl.appendChild(mkBtn('‹', Math.max(1,page-1), page===1));

  // ellipsis range: 1 ... (p-2 p-1 p p+1 p+2) ... last
  const pages = new Set([1, totalPages]);
  for (let i = page-2; i <= page+2; i++) if (i>=1 && i<=totalPages) pages.add(i);
  const sorted = Array.from(pages).sort((a,b)=>a-b);

  let prev = 0;
  sorted.forEach(p=>{
    if (prev && p - prev > 1){
      const span = document.createElement('span');
      span.textContent = '…';
      span.style.padding = '0 6px';
      navEl.appendChild(span);
    }
    navEl.appendChild(mkBtn(String(p), p, false, p===page));
    prev = p;
  });

  navEl.appendChild(mkBtn('›', Math.min(totalPages,page+1), page===totalPages));
  navEl.appendChild(mkBtn('⟩', totalPages, page===totalPages));
}

export function createTablePager({
  containerEl,             // element pembungkus table (mis: .admin-table-container)
  tbodyEl,                 // tbody target
  getRowText,              // (row)=> string untuk search
  renderRowHtml,           // (row)=> `<tr>...</tr>`
  pageSizes = [20,50,100,500,1000],
  defaultSize = 20,
  searchPlaceholder = 'Cari...'
}){
  if (!containerEl || !tbodyEl) return null;

  const ui = makePagerUI(containerEl, { pageSizes, searchPlaceholder });

  const input = ui.querySelector('.pager-search');
  const sel = ui.querySelector('.pager-size');
  const info = ui.querySelector('.pager-info');
  const nav  = ui.querySelector('.pager-nav');

  sel.value = String(defaultSize);

  let raw = [];
  let filtered = [];
  let page = 1;

  const apply = () => {
    const q = input.value || '';
    filtered = raw.filter(r => smartMatch(getRowText(r), q));

    const size = Number(sel.value || defaultSize);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    if (page > totalPages) page = totalPages;

    const start = (page-1)*size;
    const chunk = filtered.slice(start, start+size);

    tbodyEl.innerHTML = chunk.map((row, i) => renderRowHtml(row, start + i + 1)).join('');

    const shownFrom = total ? (start+1) : 0;
    const shownTo = Math.min(total, start + chunk.length);
    info.textContent = `Menampilkan ${shownFrom}-${shownTo} dari ${total}`;

    renderNav(nav, page, totalPages, (p)=>{ page=p; apply(); });
  };

  input.addEventListener('input', ()=>{ page=1; apply(); });
  sel.addEventListener('change', ()=>{ page=1; apply(); });

  return {
    setData(rows){
      raw = Array.isArray(rows) ? rows : [];
      page = 1;
      apply();
    },
    refresh(){ apply(); }
  };
}
