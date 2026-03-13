/* ===== REVPEAK JS - app.js ===== */
/* Update: Tab Terbaru, Rekomendasi, Trending + List Article */

const API_BASE = '/api';

// ===== STATE =====
let currentTab = 'terbaru';
let currentCat = 'all';
let currentPage = 0;
const PAGE_SIZE = 9;
let hasMore = false;

// ===== UTILITY =====
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function starsHTML(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

function ratingVerdict(r) {
  if (r >= 4.5) return 'Luar Biasa';
  if (r >= 4.0) return 'Sangat Bagus';
  if (r >= 3.5) return 'Bagus';
  if (r >= 3.0) return 'Cukup';
  return 'Di Bawah Rata-rata';
}

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return Math.floor(diff / 60) + ' menit lalu';
  if (diff < 86400) return Math.floor(diff / 3600) + ' jam lalu';
  if (diff < 2592000) return Math.floor(diff / 86400) + ' hari lalu';
  return new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function showToast(msg, type = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };
  let wrap = document.getElementById('toast-container');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-container';
    wrap.className = 'toast-container';
    document.body.appendChild(wrap);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ===== API =====
async function fetchAPI(endpoint) {
  try {
    const res = await fetch(`${API_BASE}${endpoint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('API Error:', err);
    return null;
  }
}

// ===== THEME =====
const ThemeManager = {
  init() {
    const saved = localStorage.getItem('revpeak-theme') || 'light';
    this.set(saved);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', () => this.toggle());
  },
  set(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('revpeak-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  },
  toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    this.set(current === 'dark' ? 'light' : 'dark');
  }
};

// ===== SCROLL TOP =====
function initScrollTop() {
  const btn = document.getElementById('scroll-top');
  if (!btn) return;
  window.addEventListener('scroll', () => btn.classList.toggle('show', window.scrollY > 400));
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

// ===== MOBILE MENU =====
function initMobileMenu() {
  const btn = document.getElementById('hamburger');
  const nav = document.getElementById('main-nav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', nav.classList.contains('open'));
  });
}

// ===== SKELETON =====
function renderSkeletons(container, count = 6) {
  container.innerHTML = Array(count).fill('').map(() => `
    <div class="skeleton-card">
      <div class="skeleton sk-img"></div>
      <div class="sk-body">
        <div class="skeleton sk-line" style="width:40%;height:12px;margin-bottom:8px"></div>
        <div class="skeleton sk-line" style="height:18px;margin-bottom:8px"></div>
        <div class="skeleton sk-line" style="margin-bottom:6px"></div>
        <div class="skeleton sk-line" style="width:75%"></div>
      </div>
    </div>
  `).join('');
}

// ===== RENDER REVIEW CARD =====
// Mendukung 2 tipe: 'review' (normal) dan 'list' (artikel rekomendasi banyak produk)
function reviewCardHTML(r) {
  const isListType = r.post_type === 'list';
  const stars = starsHTML(r.rating || 0);

  // Badge berdasarkan tipe konten
  const badge = isListType
    ? `<span class="badge badge-purple">📋 List</span>`
    : `<span class="badge badge-blue">${r.categories?.name || 'Review'}</span>`;

  // Label trending jika ada views
  const trendingBadge = r.views > 100
    ? `<span class="trending-pill">🔥 ${r.views > 999 ? (r.views/1000).toFixed(1)+'rb' : r.views} views</span>`
    : '';

  const img = r.image_url
    ? `<img src="${r.image_url}" alt="${r.title}" loading="lazy">`
    : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#E2E8F0,#CBD5E1);display:flex;align-items:center;justify-content:center;font-size:48px">${r.emoji || (isListType ? '📋' : '📱')}</div>`;

  // Footer berbeda untuk list vs review biasa
  const cardFooter = isListType
    ? `<div class="card-footer">
        <div>
          <div class="card-meta list-count-badge">📦 ${r.product_count || 'Beberapa'} produk</div>
          <div class="card-meta">${timeAgo(r.created_at)}</div>
        </div>
        <a href="review.html?slug=${r.slug}" class="btn-read-more">Lihat Semua →</a>
      </div>`
    : `<div class="card-footer">
        <div>
          <div class="card-stars">${stars}</div>
          <div class="card-meta">${timeAgo(r.created_at)}</div>
        </div>
        <a href="review.html?slug=${r.slug}" class="btn-read-more">Baca →</a>
      </div>`;

  return `
    <article class="review-card ${isListType ? 'card-list-type' : ''}" role="listitem">
      <div class="card-img">
        ${img}
        ${badge}
        ${trendingBadge}
        ${!isListType && r.rating ? `<span class="card-rating-pill"><span class="star">★</span> ${r.rating}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-category">${r.categories?.name || (isListType ? 'List Produk' : 'Review')}</div>
        <h3 class="card-title"><a href="review.html?slug=${r.slug}">${r.title}</a></h3>
        <p class="card-excerpt">${r.excerpt || ''}</p>
        ${cardFooter}
      </div>
    </article>
  `;
}

// ===== SWITCH TAB =====
function switchTab(tab) {
  currentTab = tab;
  currentPage = 0;
  currentCat = 'all';

  // Update active tab button
  $$('.main-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
    t.setAttribute('aria-selected', t.dataset.tab === tab);
  });

  // Update tab description
  $$('[id^="tab-desc-"]').forEach(d => d.style.display = 'none');
  const desc = document.getElementById('tab-desc-' + tab);
  if (desc) desc.style.display = 'block';

  // Reset kategori filter ke "Semua"
  $$('.cat-tab').forEach(t => t.classList.remove('active'));
  const allTab = document.querySelector('.cat-tab[data-cat="all"]');
  if (allTab) allTab.classList.add('active');

  // Load konten tab
  loadReviews(true);
}

// ===== LOAD REVIEWS =====
async function loadReviews(reset = false) {
  const grid = document.getElementById('reviews-grid');
  if (!grid) return;

  if (reset) {
    currentPage = 0;
    renderSkeletons(grid, 6);
  }

  const offset = currentPage * PAGE_SIZE;
  let url = `/reviews?limit=${PAGE_SIZE + 1}&offset=${offset}`;

  // Filter berdasarkan tab
  if (currentTab === 'rekomendasi') {
    url += '&featured=true';
  } else if (currentTab === 'trending') {
    url += '&sort=trending';
  }
  // terbaru = default (order by created_at desc)

  // Filter kategori
  if (currentCat !== 'all') {
    url += `&category=${currentCat}`;
  }

  const data = await fetchAPI(url);
  const allItems = data?.data || data || [];

  // Cek apakah masih ada halaman berikutnya
  hasMore = allItems.length > PAGE_SIZE;
  const reviews = hasMore ? allItems.slice(0, PAGE_SIZE) : allItems;

  // Render
  if (reset) {
    if (!reviews.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">${currentTab === 'trending' ? '📊' : currentTab === 'rekomendasi' ? '⭐' : '📭'}</div>
          <h3>${currentTab === 'trending' ? 'Belum ada konten trending' : currentTab === 'rekomendasi' ? 'Belum ada rekomendasi' : 'Belum ada konten'}</h3>
          <p>${currentTab === 'trending' ? 'Konten akan muncul seiring bertambahnya pembaca' : 'Segera hadir!'}</p>
        </div>`;
    } else {
      grid.innerHTML = reviews.map(reviewCardHTML).join('');
    }
  } else {
    // Append untuk load more
    grid.insertAdjacentHTML('beforeend', reviews.map(reviewCardHTML).join(''));
  }

  // Toggle tombol load more
  const loadMoreWrap = document.getElementById('load-more-wrap');
  if (loadMoreWrap) loadMoreWrap.style.display = hasMore ? 'flex' : 'none';
}

// ===== LOAD MORE =====
function loadMore() {
  currentPage++;
  const btn = document.getElementById('btn-load-more');
  if (btn) {
    btn.textContent = '⏳ Memuat...';
    btn.disabled = true;
  }
  loadReviews(false).then(() => {
    if (btn) {
      btn.textContent = 'Muat Lebih Banyak ↓';
      btn.disabled = false;
    }
  });
}

// ===== INDEX PAGE =====
async function initIndexPage() {
  const grid = document.getElementById('reviews-grid');
  const catTabs = document.getElementById('cat-tabs');
  if (!grid) return;

  // Load categories
  if (catTabs) {
    const cats = await fetchAPI('/categories');
    if (cats) {
      const list = cats.data || cats;
      const allBtn = `<button class="cat-tab active" data-cat="all" onclick="filterByCat('all')">
        <span class="cat-icon">🌟</span> Semua
      </button>`;
      const catBtns = list.map(c => `
        <button class="cat-tab" data-cat="${c.id}" onclick="filterByCat('${c.id}')">
          <span class="cat-icon">${c.icon || '📌'}</span> ${c.name}
        </button>
      `).join('');
      catTabs.innerHTML = allBtn + catBtns;
    }
  }

  // Load hero featured
  loadFeatured();

  // Load konten tab default (Terbaru)
  loadReviews(true);

  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let timer;
    searchInput.addEventListener('input', e => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      if (!q) { loadReviews(true); return; }
      timer = setTimeout(async () => {
        renderSkeletons(grid, 6);
        const data = await fetchAPI(`/reviews?search=${encodeURIComponent(q)}`);
        const reviews = data?.data || data || [];
        if (!reviews.length) {
          grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
            <div class="empty-state-icon">🔍</div>
            <h3>Tidak ditemukan</h3>
            <p>Coba kata kunci lain</p>
          </div>`;
        } else {
          grid.innerHTML = reviews.map(reviewCardHTML).join('');
        }
        document.getElementById('load-more-wrap').style.display = 'none';
      }, 400);
    });
  }
}

// Filter by kategori
function filterByCat(catId) {
  currentCat = catId;
  currentPage = 0;
  $$('.cat-tab').forEach(t => t.classList.toggle('active', t.dataset.cat === catId));
  loadReviews(true);
}

// Load hero featured
async function loadFeatured() {
  const heroFeatured = document.getElementById('hero-featured');
  if (!heroFeatured) return;
  const data = await fetchAPI('/reviews?limit=1&featured=true');
  const review = data?.data?.[0] || data?.[0];
  if (!review) return;
  heroFeatured.innerHTML = `
    <div class="hero-featured-img">
      ${review.image_url
        ? `<img src="${review.image_url}" alt="${review.title}" loading="lazy">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:64px;background:linear-gradient(135deg,#1D4ED8,#3B82F6)">${review.emoji || '📱'}</div>`}
    </div>
    <div class="hero-featured-body">
      <span class="badge badge-gold">⭐ ${review.post_type === 'list' ? 'List Unggulan' : 'Review Unggulan'}</span>
      <h3 class="hero-featured-title"><a href="review.html?slug=${review.slug}">${review.title}</a></h3>
      <div class="hero-featured-meta">
        ${review.post_type !== 'list' ? `<span class="stars-display">${starsHTML(review.rating || 0)}</span>` : '<span>📋 List Produk</span>'}
        <span>${timeAgo(review.created_at)}</span>
      </div>
    </div>
  `;
}

// ===== REVIEW DETAIL PAGE =====
async function initReviewPage() {
  const container = document.getElementById('review-container');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  if (!slug) { window.location.href = '/'; return; }

  container.innerHTML = `<div class="empty-state" style="padding:80px 20px">
    <div class="empty-state-icon">⏳</div><h3>Memuat...</h3>
  </div>`;

  // Tracking view
  fetchAPI(`/track-view?slug=${slug}`).catch(() => {});

  const data = await fetchAPI(`/reviews/${slug}`);
  const review = data?.data || data;

  if (!review) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">😕</div>
      <h3>Review tidak ditemukan</h3>
      <p><a href="/" style="color:var(--primary)">Kembali ke beranda</a></p></div>`;
    return;
  }

  document.title = `${review.title} - Revpeak`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = review.excerpt || '';

  // Cek tipe konten
  if (review.post_type === 'list') {
    renderListArticle(container, review);
  } else {
    renderReviewArticle(container, review);
  }

  loadRelated(review.category_id, review.slug);
}

// ===== RENDER REVIEW BIASA =====
function renderReviewArticle(container, review) {
  let pros = [], cons = [];
  try { pros = typeof review.pros === 'string' ? JSON.parse(review.pros) : (review.pros || []); } catch(e) {}
  try { cons = typeof review.cons === 'string' ? JSON.parse(review.cons) : (review.cons || []); } catch(e) {}

  const stars = starsHTML(review.rating || 0);

  container.innerHTML = `
    <div class="review-layout">
      <main class="review-main">
        <header class="review-header">
          <nav class="review-breadcrumb">
            <a href="/">Beranda</a> › 
            <a href="/?cat=${review.category_id}">${review.categories?.name || 'Review'}</a> › 
            ${review.title}
          </nav>
          <h1 class="review-title">${review.title}</h1>
          <div class="review-meta-bar">
            <span class="badge badge-blue">${review.categories?.name || 'Review'}</span>
            <span class="review-meta-date">📅 ${new Date(review.created_at).toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'})}</span>
            <span class="review-meta-author">✍️ ${review.author || 'Admin'}</span>
            ${review.views ? `<span class="review-meta-date">👁️ ${review.views} views</span>` : ''}
          </div>
        </header>

        ${review.image_url
          ? `<img class="review-hero-img" src="${review.image_url}" alt="${review.title}">`
          : `<div class="review-hero-img-placeholder">${review.emoji || '📱'}</div>`}

        <div class="review-score-bar">
          <div class="review-score-num">${review.rating}<span>/5</span></div>
          <div class="review-score-details">
            <div class="review-score-stars">${stars}</div>
            <div class="review-score-verdict">${ratingVerdict(review.rating || 0)}</div>
          </div>
        </div>

        ${(pros.length || cons.length) ? `
          <div class="pros-cons" style="margin-bottom:28px">
            ${pros.length ? `<div class="pros"><div class="pros-cons-title">👍 Kelebihan</div>
              <ul>${pros.map(p => `<li>${p}</li>`).join('')}</ul></div>` : ''}
            ${cons.length ? `<div class="cons"><div class="pros-cons-title">👎 Kekurangan</div>
              <ul>${cons.map(c => `<li>${c}</li>`).join('')}</ul></div>` : ''}
          </div>` : ''}

        <div class="review-content">${review.content || '<p>Konten review sedang ditulis...</p>'}</div>
      </main>

      <aside class="review-sidebar">
        <div class="sidebar-sticky">
          ${review.rating ? `
            <div class="sidebar-card">
              <div class="sidebar-title">Penilaian Kami</div>
              <div class="rating-widget">
                <div class="rating-score">${review.rating}<span>/5</span></div>
                <div class="rating-stars-big">${stars}</div>
                <div class="rating-label">${ratingVerdict(review.rating)}</div>
              </div>
            </div>` : ''}
          ${review.affiliate_url ? `
            <div class="sidebar-card">
              <div class="sidebar-title">🛒 Dapatkan Sekarang</div>
              <a href="${review.affiliate_url}" target="_blank" rel="nofollow noopener" class="btn-affiliate">
                🛍️ Cek Harga Terbaik
              </a>
              <p class="btn-affiliate-note">* Link afiliasi – mendukung kami tanpa biaya tambahan</p>
            </div>` : ''}
          <div class="sidebar-card">
            <div class="sidebar-title">📤 Bagikan</div>
            <div style="display:flex;gap:8px">
              <button onclick="shareReview('wa')" class="btn-read-more" style="flex:1;text-align:center">WhatsApp</button>
              <button onclick="shareReview('copy')" class="btn-read-more" style="flex:1;text-align:center">Copy Link</button>
            </div>
          </div>
        </div>
      </aside>
    </div>`;
}

// ===== RENDER LIST ARTICLE =====
// Format: "Rekomendasi 5 Baju Lebaran", dll
function renderListArticle(container, review) {
  // products disimpan di kolom 'products' sebagai JSON array
  // Format: [{ name, price, image, affiliate_url, description, rating }]
  let products = [];
  try {
    products = typeof review.products === 'string'
      ? JSON.parse(review.products)
      : (review.products || []);
  } catch(e) {}

  const productsHTML = products.length
    ? products.map((p, i) => `
        <div class="list-product-card">
          <div class="list-product-rank">${i + 1}</div>
          <div class="list-product-img">
            ${p.image
              ? `<img src="${p.image}" alt="${p.name}" loading="lazy">`
              : `<div class="list-product-img-placeholder">${p.emoji || '🛍️'}</div>`}
          </div>
          <div class="list-product-body">
            <h3 class="list-product-name">${p.name}</h3>
            ${p.description ? `<p class="list-product-desc">${p.description}</p>` : ''}
            <div class="list-product-footer">
              ${p.price ? `<span class="list-product-price">${p.price}</span>` : ''}
              ${p.rating ? `<span class="list-product-rating">★ ${p.rating}</span>` : ''}
              ${p.affiliate_url ? `
                <a href="${p.affiliate_url}" target="_blank" rel="nofollow noopener" class="btn-affiliate-small">
                  🛍️ Cek Harga
                </a>` : ''}
            </div>
          </div>
        </div>
      `).join('')
    : `<p style="color:var(--text-muted)">Produk sedang dimuat...</p>`;

  container.innerHTML = `
    <div class="review-layout">
      <main class="review-main">
        <header class="review-header">
          <nav class="review-breadcrumb">
            <a href="/">Beranda</a> › 
            <a href="/?cat=${review.category_id}">${review.categories?.name || 'List'}</a> › 
            ${review.title}
          </nav>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span class="badge badge-purple">📋 List Produk</span>
            <span class="badge badge-blue">${review.categories?.name || ''}</span>
          </div>
          <h1 class="review-title">${review.title}</h1>
          <div class="review-meta-bar">
            <span class="review-meta-date">📅 ${new Date(review.created_at).toLocaleDateString('id-ID', {day:'numeric',month:'long',year:'numeric'})}</span>
            <span class="review-meta-author">✍️ ${review.author || 'Admin'}</span>
            ${review.views ? `<span class="review-meta-date">👁️ ${review.views} views</span>` : ''}
          </div>
        </header>

        ${review.image_url
          ? `<img class="review-hero-img" src="${review.image_url}" alt="${review.title}">`
          : `<div class="review-hero-img-placeholder">${review.emoji || '📋'}</div>`}

        ${review.excerpt ? `
          <div class="list-intro">
            <p>${review.excerpt}</p>
          </div>` : ''}

        ${review.content ? `<div class="review-content">${review.content}</div>` : ''}

        <!-- Daftar Produk -->
        <div class="list-products-section">
          <h2 class="list-products-title">
            🛍️ ${products.length ? products.length + ' Produk' : 'Daftar Produk'} Rekomendasi
          </h2>
          <div class="list-products-grid">
            ${productsHTML}
          </div>
        </div>

      </main>

      <aside class="review-sidebar">
        <div class="sidebar-sticky">
          <div class="sidebar-card">
            <div class="sidebar-title">📋 Isi Artikel</div>
            <div class="toc-list">
              ${products.map((p, i) => `
                <div class="toc-item">
                  <span class="toc-num">${i + 1}</span>
                  <span class="toc-name">${p.name}</span>
                </div>`).join('')}
            </div>
          </div>
          <div class="sidebar-card">
            <div class="sidebar-title">📤 Bagikan</div>
            <div style="display:flex;gap:8px">
              <button onclick="shareReview('wa')" class="btn-read-more" style="flex:1;text-align:center">WhatsApp</button>
              <button onclick="shareReview('copy')" class="btn-read-more" style="flex:1;text-align:center">Copy Link</button>
            </div>
          </div>
        </div>
      </aside>
    </div>`;
}

// ===== RELATED =====
async function loadRelated(categoryId, currentSlug) {
  const section = document.getElementById('related-section');
  if (!section || !categoryId) return;
  const data = await fetchAPI(`/reviews?category=${categoryId}&limit=4`);
  const reviews = (data?.data || data || []).filter(r => r.slug !== currentSlug).slice(0, 3);
  if (!reviews.length) { section.style.display = 'none'; return; }
  const grid = section.querySelector('.reviews-grid');
  if (grid) grid.innerHTML = reviews.map(reviewCardHTML).join('');
}

// ===== SHARE =====
function shareReview(method) {
  const url = window.location.href;
  const title = document.title;
  if (method === 'wa') {
    window.open(`https://wa.me/?text=${encodeURIComponent(title + '\n' + url)}`, '_blank');
  } else {
    navigator.clipboard.writeText(url).then(() => showToast('Link berhasil disalin! ✅', 'success'));
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  ThemeManager.init();
  initScrollTop();
  initMobileMenu();
  initIndexPage();
  initReviewPage();
});
