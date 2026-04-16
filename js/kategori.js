/* ===========================
   KATEGORI PAGE — kategori.js
=========================== */

const API_BASE_K = '/api';
let activeCat    = null;
let katPage      = 0;
let katHasMore   = false;
const KAT_SIZE   = 9;
let currentSort  = 'newest'; // 'newest' | 'popular'

async function fetchK(endpoint) {
  try {
    const r = await fetch(API_BASE_K + endpoint);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) { console.error(e); return null; }
}

/* ===========================
   FILTER CHIPS
=========================== */
function renderFilterChips(cats) {
  const bar = document.getElementById('filter-chips');
  if (!bar) return;
  bar.innerHTML =
    `<button class="filter-chip active" data-id="all" onclick="filterByChip('all',null,null)">🌟 Semua</button>` +
    cats.map(c =>
      `<button class="filter-chip" data-id="${c.id}" onclick="filterByChip(${c.id},'${(c.name||'').replace(/'/g,"\\'")}','${c.icon||'📌'}')">${c.icon||'📌'} ${c.name}</button>`
    ).join('');
}

function filterByChip(id, name, icon) {
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.id === String(id));
  });
  if (id === 'all') {
    backToCategories();
    return;
  }
  selectCategory(id, name, icon);
}

function onSortChange() {
  currentSort = document.getElementById('sort-select')?.value || 'newest';
  if (activeCat) loadCatContent(true);
}

/* ===========================
   LOAD CATEGORY CARDS
=========================== */
async function loadCategoryCards() {
  const grid = document.getElementById('cat-grid');
  if (!grid) return;

  const data = await fetchK('/categories');
  const cats = data?.data || data || [];

  if (!cats.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-muted)">
      <div style="font-size:48px;margin-bottom:12px">📭</div>
      <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700">Belum ada kategori</div>
    </div>`;
    return;
  }

  // Load review counts per category (parallel)
  const countPromises = cats.map(c =>
    fetchK(`/reviews?category=${c.id}&limit=1`)
      .then(d => ({ id: c.id, count: Array.isArray(d?.data) ? d.data.length : 0 }))
      .catch(() => ({ id: c.id, count: 0 }))
  );
  const counts = await Promise.allSettled(countPromises);
  const countMap = {};
  counts.forEach(r => { if (r.status === 'fulfilled') countMap[r.value.id] = r.value.count; });

  grid.innerHTML = cats.map(c => `
    <button class="cat-card" data-id="${c.id}" data-name="${c.name}" onclick="selectCategory(${c.id}, '${c.name}', '${c.icon || '📌'}')">
      <span class="cat-card-icon">${c.icon || '📌'}</span>
      <div class="cat-card-name">${c.name}</div>
      <div class="cat-card-count">
        ${c.description
          ? `<span style="color:var(--text-muted)">${c.description}</span>`
          : `<span>Lihat konten →</span>`}
      </div>
    </button>`).join('');

  // Render filter chips
  renderFilterChips(cats);

  // Check URL param
  const urlCat = new URLSearchParams(window.location.search).get('cat');
  if (urlCat) {
    const found = cats.find(c => c.slug === urlCat || String(c.id) === urlCat);
    if (found) selectCategory(found.id, found.name, found.icon || '📌');
  }
}

/* ===========================
   SELECT CATEGORY
=========================== */
function selectCategory(catId, catName, catIcon) {
  activeCat  = catId;
  katPage    = 0;

  // Mark active card
  document.querySelectorAll('.cat-card').forEach(c => {
    c.classList.toggle('active', parseInt(c.dataset.id) === catId);
  });

  // Sync filter chips
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.id === String(catId));
  });

  // Show sort select
  const sortWrap = document.getElementById('filter-sort-wrap');
  if (sortWrap) sortWrap.style.display = 'flex';

  // Show content section
  const contentSection = document.getElementById('cat-content-section');
  const titleEl        = document.getElementById('cat-content-title');
  if (contentSection) contentSection.style.display = 'block';
  if (titleEl) titleEl.textContent = `${catIcon} ${catName}`;

  // Scroll to content
  setTimeout(() => {
    contentSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);

  loadCatContent(true);
}

/* ===========================
   LOAD CAT CONTENT
=========================== */
async function loadCatContent(reset = false) {
  const grid   = document.getElementById('cat-content-grid');
  const lmWrap = document.getElementById('load-more-wrap');
  const lmBtn  = document.getElementById('btn-load-more');
  if (!grid || !activeCat) return;

  if (reset) {
    katPage = 0;
    grid.innerHTML = Array(6).fill('').map(() => `
      <div class="skeleton-card">
        <div class="skeleton sk-img"></div>
        <div class="sk-body">
          <div class="skeleton sk-line" style="width:35%;height:11px;margin-bottom:8px"></div>
          <div class="skeleton sk-line" style="width:88%;height:16px;margin-bottom:8px"></div>
          <div class="skeleton sk-line"></div>
        </div>
      </div>`).join('');
  }

  const offset = katPage * KAT_SIZE;
  const sortParam = currentSort === 'popular' ? '&sort=trending' : '';
  const data   = await fetchK(`/reviews?category=${activeCat}&type=review&limit=${KAT_SIZE + 1}&offset=${offset}${sortParam}`);
  const all    = data?.data || data || [];
  katHasMore   = all.length > KAT_SIZE;
  const items  = katHasMore ? all.slice(0, KAT_SIZE) : all;

  if (reset) {
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Belum ada konten</div>
        <div class="empty-desc">Kategori ini belum memiliki konten. Segera hadir!</div>
      </div>`;
    } else {
      // Gunakan fungsi contentCardHTML dari app.js
      grid.innerHTML = items.map(i => contentCardHTML(i)).join('');
    }
  } else {
    grid.insertAdjacentHTML('beforeend', items.map(i => contentCardHTML(i)).join(''));
  }

  if (lmWrap) lmWrap.style.display = katHasMore ? 'flex' : 'none';
  if (lmBtn)  { lmBtn.textContent = 'Muat Lebih Banyak'; lmBtn.disabled = false; }
}

/* ===========================
   BACK TO CATEGORIES
=========================== */
function backToCategories() {
  activeCat = null;
  currentSort = 'newest';
  document.querySelectorAll('.cat-card').forEach(c => c.classList.remove('active'));

  // Reset chips to "Semua"
  document.querySelectorAll('.filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.id === 'all');
  });

  // Reset & hide sort
  const sortWrap = document.getElementById('filter-sort-wrap');
  if (sortWrap) sortWrap.style.display = 'none';
  const sortSel = document.getElementById('sort-select');
  if (sortSel) sortSel.value = 'newest';

  const contentSection = document.getElementById('cat-content-section');
  if (contentSection) contentSection.style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ===========================
   LOAD MORE
=========================== */
document.getElementById('btn-load-more')?.addEventListener('click', () => {
  const btn = document.getElementById('btn-load-more');
  if (btn) { btn.textContent = '⏳ Memuat...'; btn.disabled = true; }
  katPage++;
  loadCatContent(false);
});

/* ===========================
   SEARCH (override dari app.js)
=========================== */
const searchInputK = document.getElementById('search-input');
if (searchInputK) {
  let timer;
  searchInputK.addEventListener('input', e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) { loadCategoryCards(); document.getElementById('cat-content-section').style.display = 'none'; return; }
    timer = setTimeout(async () => {
      const contentSection = document.getElementById('cat-content-section');
      const titleEl        = document.getElementById('cat-content-title');
      const grid           = document.getElementById('cat-content-grid');
      if (!grid) return;

      if (contentSection) contentSection.style.display = 'block';
      if (titleEl) titleEl.textContent = `🔍 Hasil: "${q}"`;

      grid.innerHTML = Array(3).fill('').map(() => `
        <div class="skeleton-card">
          <div class="skeleton sk-img"></div>
          <div class="sk-body"><div class="skeleton sk-line sk-title"></div></div>
        </div>`).join('');

      const data  = await fetchK(`/reviews?search=${encodeURIComponent(q)}&type=review`);
      const items = data?.data || data || [];
      document.getElementById('load-more-wrap').style.display = 'none';

      if (!items.length) {
        grid.innerHTML = `<div class="empty-state">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">Tidak ditemukan</div>
          <div class="empty-desc">Coba kata kunci lain</div>
        </div>`;
      } else {
        grid.innerHTML = items.map(i => contentCardHTML(i)).join('');
      }
    }, 380);
  });
}

/* ===========================
   INIT
=========================== */
document.addEventListener('DOMContentLoaded', () => {
  loadCategoryCards();
});
