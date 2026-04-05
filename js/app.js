/* ===========================================
   REVPEAK v3 — app.js
   Tab: Rekomendasi, Trending, Terbaru
   Support: review, list, video, news
=========================================== */

/* ===== CONFIG ===== */
const API_BASE  = '/api';
const PAGE_SIZE = 9;

/* ===== STATE ===== */
let currentTab  = 'rekomendasi';
let currentCat  = 'all';
let currentPage = 0;
let isLoading   = false;
let hasMore     = false;

/* ===== UTILS ===== */
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

function showToast(msg) {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ===== API ===== */
async function fetchAPI(endpoint) {
  try {
    const res = await fetch(API_BASE + endpoint);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.error('[Revpeak API]', err.message);
    return null;
  }
}

/* ===== THEME ===== */
function initTheme() {
  const saved = localStorage.getItem('rp-theme') || 'light';
  applyTheme(saved, false);
}

function applyTheme(theme, animate = true) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('rp-theme', theme);
  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
  }
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ===== DRAWER ===== */
function initDrawer() {
  const overlay   = document.getElementById('drawer-overlay');
  const drawer    = document.getElementById('drawer');
  const hamburger = document.getElementById('hamburger');
  const close     = document.getElementById('drawer-close');
  const toggle    = document.getElementById('theme-toggle');

  function open() {
    drawer?.classList.add('open');
    overlay?.classList.add('open');
    hamburger?.classList.add('open');
    hamburger?.setAttribute('aria-expanded', 'true');
    // [A11Y] Drawer kini terlihat oleh screen reader
    drawer?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // [A11Y] Pindahkan fokus ke tombol tutup agar keyboard user bisa langsung menutup drawer
    setTimeout(() => close?.focus(), 50);
  }

  function close_() {
    drawer?.classList.remove('open');
    overlay?.classList.remove('open');
    hamburger?.classList.remove('open');
    hamburger?.setAttribute('aria-expanded', 'false');
    // [A11Y] Drawer disembunyikan kembali dari screen reader
    drawer?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // [A11Y] Kembalikan fokus ke tombol hamburger setelah drawer ditutup
    hamburger?.focus();
  }

  hamburger?.addEventListener('click', () => {
    drawer?.classList.contains('open') ? close_() : open();
  });

  close?.addEventListener('click', close_);
  overlay?.addEventListener('click', close_);
  toggle?.addEventListener('click', toggleTheme);

  // Close on ESC
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close_(); });
}

/* ===== SEARCH ===== */
function initSearch() {
  const input     = document.getElementById('search-input');
  const clearBtn  = document.getElementById('search-clear');
  if (!input) return;

  let timer;

  function handleSearch(q) {
    clearTimeout(timer);
    if (!q) { loadContent(true); return; }
    timer = setTimeout(async () => {
      renderSkeletons(document.getElementById('content-grid'), 6);
      document.getElementById('load-more-wrap').style.display = 'none';
      const data  = await fetchAPI(`/reviews?search=${encodeURIComponent(q)}`);
      const items = data?.data || data || [];
      const grid  = document.getElementById('content-grid');
      if (!items.length) {
        grid.innerHTML = emptyStateHTML('🔍', 'Tidak ditemukan', 'Coba kata kunci lain');
      } else {
        grid.innerHTML = items.map(contentCardHTML).join('');
      }
    }, 380);
  }

  input.addEventListener('input', e => {
    const q = e.target.value.trim();
    clearBtn?.classList.toggle('visible', q.length > 0);
    handleSearch(q);
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.remove('visible');
    loadContent(true);
    input.focus();
  });
}

/* ===== SCROLL TOP ===== */
function initScrollTop() {
  const btn = document.getElementById('scroll-top');
  if (!btn) return;
  window.addEventListener('scroll', () => btn.classList.toggle('show', window.scrollY > 380), { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

/* ===== CATEGORIES ===== */
async function loadCategories() {
  const wrap = document.getElementById('cat-chips');
  if (!wrap) return;
  const data = await fetchAPI('/categories');
  const cats = data?.data || data || [];
  if (!cats.length) return;

  // [A11Y] type="button" ditambahkan pada semua tombol chip yang dibuat dinamis
  const all  = `<button type="button" class="cat-chip active" data-cat="all">🌟 Semua</button>`;
  const rest = cats.map(c =>
    `<button type="button" class="cat-chip" data-cat="${c.id}">${c.icon || '📌'} ${c.name}</button>`
  ).join('');
  wrap.innerHTML = all + rest;

  // Delegated click
  wrap.addEventListener('click', e => {
    const chip = e.target.closest('.cat-chip');
    if (!chip) return;
    wrap.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentCat  = chip.dataset.cat;
    currentPage = 0;
    loadContent(true);
  });
}

/* ===== TABS ===== */
function initTabs() {
  const tabLabels = {
    rekomendasi: '⭐ Rekomendasi',
    trending:    '🔥 Trending',
    terbaru:     '🆕 Terbaru',
  };

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab  = btn.dataset.tab;
      currentPage = 0;
      currentCat  = 'all';

      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        // [A11Y] Perbarui aria-selected agar screen reader tahu tab mana yang aktif
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      // Reset cat chips
      document.querySelectorAll('.cat-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === 'all'));

      // Update section title
      const ttl = document.getElementById('section-title');
      if (ttl) ttl.textContent = tabLabels[currentTab] || currentTab;

      // Scroll ke atas agar user langsung melihat hero yang berubah
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Reload hero dan content sesuai tab aktif
      loadHero(currentTab);
      loadContent(true);
    });
  });
}

/* ===== HERO ===== */
async function loadHero(tab = 'rekomendasi') {
  const heroGrid = document.getElementById('hero-grid');
  if (!heroGrid) return;

  // Tampilkan skeleton hero saat loading ulang
  heroGrid.innerHTML = `
    <div class="hero-main-skeleton skeleton-card">
      <div class="skeleton sk-hero-img"></div>
      <div class="sk-body">
        <div class="skeleton sk-line" style="width:30%;height:11px;margin-bottom:10px"></div>
        <div class="skeleton sk-line" style="width:90%;height:20px;margin-bottom:8px"></div>
        <div class="skeleton sk-line" style="width:100%;margin-bottom:6px"></div>
        <div class="skeleton sk-line" style="width:70%"></div>
      </div>
    </div>
    <div class="hero-side-skeleton">
      <div class="skeleton-card sk-side"><div class="skeleton sk-side-img"></div><div class="sk-side-body"><div class="skeleton sk-line" style="width:80%;height:13px;margin-bottom:6px"></div><div class="skeleton sk-line" style="width:55%"></div></div></div>
      <div class="skeleton-card sk-side"><div class="skeleton sk-side-img"></div><div class="sk-side-body"><div class="skeleton sk-line" style="width:80%;height:13px;margin-bottom:6px"></div><div class="skeleton sk-line" style="width:55%"></div></div></div>
      <div class="skeleton-card sk-side"><div class="skeleton sk-side-img"></div><div class="sk-side-body"><div class="skeleton sk-line" style="width:80%;height:13px;margin-bottom:6px"></div><div class="skeleton sk-line" style="width:55%"></div></div></div>
    </div>`;

  // URL dan label badge sesuai tab
  const urlMap = {
    rekomendasi: '/reviews?limit=4&featured=true',
    trending:    '/reviews?limit=4&sort=trending',
    terbaru:     '/reviews?limit=4',
  };
  const badgeMap = {
    rekomendasi: '⭐ Unggulan',
    trending:    '🔥 Trending',
    terbaru:     '🆕 Terbaru',
  };
  const labelMap = {
    rekomendasi: '⭐ Pilihan Rekomendasi',
    trending:    '🔥 Sedang Trending',
    terbaru:     '🆕 Konten Terbaru',
  };

  // Update label di atas hero grid
  const heroLabel = document.getElementById('hero-tab-label');
  if (heroLabel) heroLabel.textContent = labelMap[tab] || '';

  const data  = await fetchAPI(urlMap[tab] || urlMap.rekomendasi);
  const items = data?.data || data || [];
  if (!items.length) { heroGrid.style.display = 'none'; return; }
  heroGrid.style.display = '';

  const main = items[0];
  const side = items.slice(1, 4);

  // Badge: list/video tetap pakai label tipe konten, selainnya pakai label tab
  const heroBadge = main.post_type === 'list'
    ? '📋 List'
    : main.post_type === 'video'
      ? '▶ Video'
      : badgeMap[tab] || '⭐ Unggulan';

  const mainImgHTML = main.image_url
    ? `<img src="${main.image_url}" alt="${main.title}" loading="eager">`
    : `<div style="font-size:80px;width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#2D2C29,#444)">${main.emoji || '📱'}</div>`;

  const sideHTML = side.map(s => `
    <a href="/${s.slug}" class="hero-side-card">
      <div class="side-thumb">
        ${s.image_url
          ? `<img src="${s.image_url}" alt="${s.title}" loading="lazy">`
          : `<span>${s.emoji || '📌'}</span>`}
      </div>
      <div class="side-body">
        <div class="side-cat">${s.categories?.name || 'Review'}</div>
        <div class="side-title">${s.title}</div>
        <div class="side-meta">
          ${s.rating ? `<span class="rating-star">★ ${s.rating}</span>` : ''}
          <span>${timeAgo(s.created_at)}</span>
        </div>
      </div>
    </a>`).join('');

  heroGrid.innerHTML = `
    <a href="/${main.slug}" class="hero-main">
      <div class="hero-main-img">
        ${mainImgHTML}
        <div class="hero-img-overlay"></div>
        <span class="hero-badge">${heroBadge}</span>
        ${main.views ? `<span class="hero-views-pill">👁 ${fmtViews(main.views)}</span>` : ''}
      </div>
      <div class="hero-main-body">
        <div class="hero-cat">${main.categories?.name || 'Review'}</div>
        <h2 class="hero-title">${main.title}</h2>
        <p class="hero-excerpt">${main.excerpt || ''}</p>
        <div class="hero-footer">
          <div class="hero-meta">
            ${main.rating ? `<span class="rating-star">★ ${main.rating}</span>` : ''}
            <span>${timeAgo(main.created_at)}</span>
          </div>
          <span class="btn-baca">Baca →</span>
        </div>
      </div>
    </a>
    <div class="hero-sidebar">${sideHTML}</div>`;
}

/* ===== CONTENT CARD ===== */
function contentCardHTML(item) {
  const type = item.post_type || 'review';

  const ribbonMap  = { review: ['ribbon-review', '📝 Review'], list: ['ribbon-list', '📋 List'], video: ['ribbon-video', '▶ Video'], news: ['ribbon-news', '📰 News'] };
  const [ribbonCls, ribbonTxt] = ribbonMap[type] || ribbonMap.review;

  const mediaHTML = item.video_url && type === 'video'
    ? `<div class="card-video-wrap" style="width:100%;height:100%;position:relative">
        <img src="${item.image_url || ''}" alt="${item.title}" loading="lazy" style="width:100%;height:100%;object-fit:cover">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
          <div style="width:48px;height:48px;background:rgba(0,0,0,0.65);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;color:#fff">▶</div>
        </div>
      </div>`
    : item.image_url
      ? `<img src="${item.image_url}" alt="${item.title}" loading="lazy">`
      : `<div style="font-size:44px">${item.emoji || (type === 'list' ? '📋' : type === 'video' ? '▶️' : '📱')}</div>`;

  const showTrending = item.views > 100;

  // [A11Y] role="listitem" sudah ada — dipertahankan agar sesuai dengan parent role="list"
  return `
    <a href="/${item.slug}" class="content-card" role="listitem">
      <div class="card-media">
        ${mediaHTML}
        <span class="card-ribbon ${ribbonCls}">${ribbonTxt}</span>
        ${item.rating && type !== 'list' ? `<span class="card-rating-pill">★ ${item.rating}</span>` : ''}
        ${type === 'video' && item.duration ? `<span class="card-video-badge">${item.duration}</span>` : ''}
        ${showTrending ? `<span class="card-trending-pill">🔥 ${fmtViews(item.views)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-cat">${item.categories?.name || (type === 'list' ? 'List Produk' : 'Review')}</div>
        <h3 class="card-title">${item.title}</h3>
        <p class="card-excerpt">${item.excerpt || ''}</p>
        <div class="card-footer">
          <span class="card-time">${timeAgo(item.created_at)}</span>
          ${item.views ? `<span class="card-views">👁 ${fmtViews(item.views)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

/* ===== SKELETON ===== */
function renderSkeletons(container, count) {
  if (!container) return;
  // [A11Y] role="listitem" ditambahkan agar child cocok dengan parent role="list"
  container.innerHTML = Array(count).fill('').map(() => `
    <div class="skeleton-card" role="listitem">
      <div class="skeleton sk-img"></div>
      <div class="sk-body">
        <div class="skeleton sk-line" style="width:35%;height:11px;margin-bottom:8px"></div>
        <div class="skeleton sk-line" style="width:90%;height:16px;margin-bottom:8px"></div>
        <div class="skeleton sk-line" style="width:100%;margin-bottom:6px"></div>
        <div class="skeleton sk-line" style="width:55%"></div>
      </div>
    </div>`).join('');
}

/* ===== EMPTY STATE ===== */
function emptyStateHTML(icon, title, desc) {
  return `<div class="empty-state">
    <div class="empty-icon">${icon}</div>
    <div class="empty-title">${title}</div>
    <div class="empty-desc">${desc}</div>
  </div>`;
}

/* ===== LOAD CONTENT ===== */
async function loadContent(reset = false) {
  if (isLoading) return;
  isLoading = true;

  const grid    = document.getElementById('content-grid');
  const lmWrap  = document.getElementById('load-more-wrap');
  const lmBtn   = document.getElementById('btn-load-more');
  if (!grid) return;

  if (reset) {
    currentPage = 0;
    renderSkeletons(grid, 6);
    if (lmWrap) lmWrap.style.display = 'none';
  }

  // Build URL
  let url = `/reviews?limit=${PAGE_SIZE + 1}&offset=${currentPage * PAGE_SIZE}`;
  if (currentTab === 'rekomendasi') url += '&featured=true';
  if (currentTab === 'trending')    url += '&sort=trending';
  if (currentCat !== 'all')         url += `&category=${currentCat}`;

  const data  = await fetchAPI(url);
  const all   = data?.data || data || [];
  hasMore     = all.length > PAGE_SIZE;
  const items = hasMore ? all.slice(0, PAGE_SIZE) : all;

  if (reset) {
    if (!items.length) {
      const msgs = {
        rekomendasi: ['⭐', 'Belum ada rekomendasi', 'Tandai konten sebagai featured di admin panel'],
        trending:    ['🔥', 'Belum ada trending',    'Konten akan muncul seiring bertambahnya pembaca'],
        terbaru:     ['🆕', 'Belum ada konten',       'Upload konten pertama lewat admin panel'],
      };
      const [icon, title, desc] = msgs[currentTab] || ['📭', 'Belum ada', 'Segera hadir'];
      grid.innerHTML = emptyStateHTML(icon, title, desc);
    } else {
      grid.innerHTML = items.map(contentCardHTML).join('');
    }
  } else {
    grid.insertAdjacentHTML('beforeend', items.map(contentCardHTML).join(''));
  }

  if (lmWrap) lmWrap.style.display = hasMore ? 'flex' : 'none';
  if (lmBtn)  { lmBtn.textContent = 'Muat Lebih Banyak'; lmBtn.disabled = false; }

  isLoading = false;
}

/* ===== LOAD MORE ===== */
function initLoadMore() {
  const btn = document.getElementById('btn-load-more');
  btn?.addEventListener('click', async () => {
    btn.textContent = '⏳ Memuat...';
    btn.disabled    = true;
    currentPage++;
    await loadContent(false);
  });
}

/* ===== STICKY HEADER SHADOW ===== */
function initHeaderShadow() {
  const header = document.getElementById('header');
  if (!header) return;
  window.addEventListener('scroll', () => {
    header.style.boxShadow = window.scrollY > 10 ? 'var(--shadow-md)' : '';
  }, { passive: true });
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initDrawer();
  initSearch();
  initScrollTop();
  initTabs();
  initLoadMore();
  initHeaderShadow();
  loadCategories();
  loadHero(currentTab);
  loadContent(true);
});
