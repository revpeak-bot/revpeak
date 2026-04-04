/* ===========================
   BERITA PAGE — berita.js
   Menampilkan semua konten non-review:
   news, article, list, video
=========================== */

const API_BASE_B  = '/api';
let beritaPage    = 0;
let beritaHasMore = false;
let beritaType    = 'all';   // 'all' | 'news' | 'article' | 'list' | 'video'
let beritaSort    = 'newest'; // 'newest' | 'popular'
let beritaLoading = false;
const BERITA_SIZE = 12;

async function fetchB(endpoint) {
  try {
    const r = await fetch(API_BASE_B + endpoint);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) { console.error('[Berita]', e); return null; }
}

/* ===========================
   TYPE FILTER CHIPS
=========================== */
function initTypeChips() {
  const bar = document.getElementById('type-chips');
  if (!bar) return;

  bar.addEventListener('click', e => {
    const chip = e.target.closest('.type-chip');
    if (!chip) return;
    bar.querySelectorAll('.type-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    beritaType = chip.dataset.type;
    beritaPage = 0;
    loadBerita(true);
  });
}

/* ===========================
   SORT CHANGE
=========================== */
function onBeritaSortChange() {
  beritaSort = document.getElementById('berita-sort')?.value || 'newest';
  beritaPage = 0;
  loadBerita(true);
}

/* ===========================
   CARD HTML
=========================== */
function beritaCardHTML(item) {
  const type = item.post_type || 'article';

  const ribbonMap = {
    news:    ['ribbon-news',    '📰 Berita'],
    article: ['ribbon-article', '📝 Artikel'],
    list:    ['ribbon-list',    '📋 Daftar'],
    video:   ['ribbon-video',   '▶ Video'],
    review:  ['ribbon-review',  '📝 Review'],
  };
  const [ribbonCls, ribbonTxt] = ribbonMap[type] || ['ribbon-article', '📝 Artikel'];

  const mediaHTML = item.video_url && type === 'video'
    ? `<div style="width:100%;height:100%;position:relative">
        <img src="${item.image_url || ''}" alt="${item.title}" loading="lazy" style="width:100%;height:100%;object-fit:cover">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
          <div style="width:48px;height:48px;background:rgba(0,0,0,0.65);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff">▶</div>
        </div>
      </div>`
    : item.image_url
      ? `<img src="${item.image_url}" alt="${item.title}" loading="lazy">`
      : `<div style="font-size:44px">${item.emoji || (type === 'news' ? '📰' : type === 'list' ? '📋' : type === 'video' ? '▶️' : '📝')}</div>`;

  function timeAgo(dateStr) {
    const s = (Date.now() - new Date(dateStr)) / 1000;
    if (s < 60)      return 'baru saja';
    if (s < 3600)    return Math.floor(s / 60) + ' mnt lalu';
    if (s < 86400)   return Math.floor(s / 3600) + ' jam lalu';
    if (s < 2592000) return Math.floor(s / 86400) + ' hari lalu';
    return new Date(dateStr).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtViews(v) {
    if (!v) return '';
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'jt';
    if (v >= 1000)    return (v / 1000).toFixed(1) + 'rb';
    return String(v);
  }

  const catLabel = item.categories?.name || (type === 'news' ? 'Berita' : type === 'list' ? 'Daftar' : 'Artikel');

  return `
    <a href="/${item.slug}" class="content-card" role="listitem">
      <div class="card-media">
        ${mediaHTML}
        <span class="card-ribbon ${ribbonCls}">${ribbonTxt}</span>
        ${type === 'video' && item.duration ? `<span class="card-video-badge">${item.duration}</span>` : ''}
        ${item.views > 100 ? `<span class="card-trending-pill">🔥 ${fmtViews(item.views)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-cat">${catLabel}</div>
        <h3 class="card-title">${item.title}</h3>
        <p class="card-excerpt">${item.excerpt || ''}</p>
        <div class="card-footer">
          <span class="card-time">${timeAgo(item.created_at)}</span>
          ${item.views ? `<span class="card-views">👁 ${fmtViews(item.views)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

/* ===========================
   SKELETON
=========================== */
function renderBeritaSkeleton(count = 6) {
  const grid = document.getElementById('berita-grid');
  if (!grid) return;
  grid.innerHTML = Array(count).fill('').map(() => `
    <div class="skeleton-card" role="listitem">
      <div class="skeleton sk-img"></div>
      <div class="sk-body">
        <div class="skeleton sk-line" style="width:35%;height:11px;margin-bottom:8px"></div>
        <div class="skeleton sk-line" style="width:90%;height:16px;margin-bottom:8px"></div>
        <div class="skeleton sk-line"></div>
      </div>
    </div>`).join('');
}

/* ===========================
   LOAD BERITA
=========================== */
async function loadBerita(reset = false) {
  if (beritaLoading) return;
  beritaLoading = true;

  const grid   = document.getElementById('berita-grid');
  const lmWrap = document.getElementById('load-more-wrap');
  const lmBtn  = document.getElementById('btn-load-more');
  if (!grid) { beritaLoading = false; return; }

  if (reset) {
    beritaPage = 0;
    renderBeritaSkeleton(6);
    if (lmWrap) lmWrap.style.display = 'none';
  }

  const offset    = beritaPage * BERITA_SIZE;
  const sortParam = beritaSort === 'popular' ? '&sort=trending' : '';

  // Bangun URL: jika type=all, gunakan exclude_type=review
  // Jika type spesifik, gunakan type=xxx
  let url;
  if (beritaType === 'all') {
    url = `/reviews?exclude_type=review&limit=${BERITA_SIZE + 1}&offset=${offset}${sortParam}`;
  } else {
    url = `/reviews?type=${beritaType}&limit=${BERITA_SIZE + 1}&offset=${offset}${sortParam}`;
  }

  const data  = await fetchB(url);
  const all   = data?.data || [];
  beritaHasMore = all.length > BERITA_SIZE;
  const items = beritaHasMore ? all.slice(0, BERITA_SIZE) : all;

  if (reset) {
    if (!items.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Belum ada konten</div>
        <div class="empty-desc">Konten untuk kategori ini belum tersedia. Segera hadir!</div>
      </div>`;
    } else {
      grid.innerHTML = items.map(beritaCardHTML).join('');
    }
  } else {
    grid.insertAdjacentHTML('beforeend', items.map(beritaCardHTML).join(''));
  }

  if (lmWrap) lmWrap.style.display = beritaHasMore ? 'flex' : 'none';
  if (lmBtn)  { lmBtn.textContent = 'Muat Lebih Banyak'; lmBtn.disabled = false; }

  beritaLoading = false;
}

/* ===========================
   SEARCH
=========================== */
function initBeritaSearch() {
  const input    = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  if (!input) return;

  let timer;

  input.addEventListener('input', e => {
    const q = e.target.value.trim();
    clearBtn?.classList.toggle('visible', q.length > 0);
    clearTimeout(timer);

    if (!q) { loadBerita(true); return; }

    timer = setTimeout(async () => {
      renderBeritaSkeleton(6);
      document.getElementById('load-more-wrap').style.display = 'none';

      const data  = await fetchB(`/reviews?search=${encodeURIComponent(q)}&exclude_type=review`);
      const items = data?.data || [];
      const grid  = document.getElementById('berita-grid');
      if (!grid) return;

      if (!items.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
          <div class="empty-icon">🔍</div>
          <div class="empty-title">Tidak ditemukan</div>
          <div class="empty-desc">Coba kata kunci lain</div>
        </div>`;
      } else {
        grid.innerHTML = items.map(beritaCardHTML).join('');
      }
    }, 380);
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.remove('visible');
    loadBerita(true);
    input.focus();
  });
}

/* ===========================
   LOAD MORE
=========================== */
document.getElementById('btn-load-more')?.addEventListener('click', () => {
  const btn = document.getElementById('btn-load-more');
  if (btn) { btn.textContent = '⏳ Memuat...'; btn.disabled = true; }
  beritaPage++;
  loadBerita(false);
});

/* ===========================
   INIT
=========================== */
document.addEventListener('DOMContentLoaded', () => {
  initTypeChips();
  initBeritaSearch();
  loadBerita(true);
});
