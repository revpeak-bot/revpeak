/* ===== REVPEAK JS - app.js ===== */
/* Semua koneksi ke Supabase lewat Cloudflare Worker (/api/*) */
/* Sehingga aman saat DNS orange (proxied) */

// ===== CONFIG =====
const API_BASE = '/api'; // Cloudflare Worker menangani ini

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
  if (r >= 2.0) return 'Di Bawah Rata-rata';
  return 'Buruk';
}

function timeAgo(date) {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return Math.floor(diff / 60) + ' menit lalu';
  if (diff < 86400) return Math.floor(diff / 3600) + ' jam lalu';
  if (diff < 2592000) return Math.floor(diff / 86400) + ' hari lalu';
  return new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
}

// Toast notification
function showToast(msg, type = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌' };
  const wrap = document.getElementById('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  wrap.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// ===== API CALLS (semua via Worker) =====
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

// ===== THEME MANAGER =====
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
  window.addEventListener('scroll', () => {
    btn.classList.toggle('show', window.scrollY > 400);
  });
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

// ===== SKELETON LOADER =====
function renderSkeletons(container, count = 6) {
  container.innerHTML = Array(count).fill('').map(() => `
    <div class="skeleton-card">
      <div class="skeleton sk-img"></div>
      <div class="sk-body">
        <div class="skeleton sk-line short" style="width:40%;margin-bottom:8px"></div>
        <div class="skeleton sk-line medium" style="height:18px;margin-bottom:8px"></div>
        <div class="skeleton sk-line" style="margin-bottom:6px"></div>
        <div class="skeleton sk-line" style="width:75%"></div>
      </div>
    </div>
  `).join('');
}

// ===== RENDER REVIEW CARD =====
function reviewCardHTML(r) {
  const stars = starsHTML(r.rating || 0);
  const img = r.image_url
    ? `<img src="${r.image_url}" alt="${r.title}" loading="lazy">`
    : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#E2E8F0,#CBD5E1);display:flex;align-items:center;justify-content:center;font-size:48px">${r.emoji || '📱'}</div>`;

  return `
    <article class="review-card">
      <div class="card-img">
        ${img}
        <span class="badge badge-blue">${r.categories?.name || r.category || 'Review'}</span>
        <span class="card-rating-pill"><span class="star">★</span> ${r.rating || '–'}</span>
      </div>
      <div class="card-body">
        <div class="card-category">${r.categories?.name || r.category || ''}</div>
        <h3 class="card-title"><a href="review.html?slug=${r.slug}">${r.title}</a></h3>
        <p class="card-excerpt">${r.excerpt || ''}</p>
        <div class="card-footer">
          <div>
            <div class="card-stars">${stars}</div>
            <div class="card-meta">${timeAgo(r.created_at)}</div>
          </div>
          <a href="review.html?slug=${r.slug}" class="btn-read-more">Baca →</a>
        </div>
      </div>
    </article>
  `;
}

// ===== INDEX PAGE =====
async function initIndexPage() {
  const grid = document.getElementById('reviews-grid');
  const catTabs = document.getElementById('cat-tabs');
  const heroFeatured = document.getElementById('hero-featured');

  if (!grid) return;

  // Load categories
  if (catTabs) {
    const cats = await fetchAPI('/categories');
    if (cats) {
      const allBtn = `<button class="cat-tab active" data-cat="all">
        <span class="cat-icon">🌟</span> Semua
      </button>`;
      const catBtns = (cats.data || cats).map(c => `
        <button class="cat-tab" data-cat="${c.id}">
          <span class="cat-icon">${c.icon || '📌'}</span> ${c.name}
        </button>
      `).join('');
      catTabs.innerHTML = allBtn + catBtns;

      catTabs.addEventListener('click', e => {
        const tab = e.target.closest('.cat-tab');
        if (!tab) return;
        $$('.cat-tab', catTabs).forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadReviews(tab.dataset.cat);
      });
    }
  }

  // Load hero featured review
  async function loadFeatured() {
    if (!heroFeatured) return;
    const data = await fetchAPI('/reviews?limit=1&featured=true');
    const review = data?.data?.[0] || data?.[0];
    if (!review) return;
    heroFeatured.innerHTML = `
      <div class="hero-featured-img">
        ${review.image_url ? `<img src="${review.image_url}" alt="${review.title}">` : ''}
      </div>
      <div class="hero-featured-body">
        <span class="badge badge-gold">⭐ Review Unggulan</span>
        <h3 class="hero-featured-title"><a href="review.html?slug=${review.slug}">${review.title}</a></h3>
        <div class="hero-featured-meta">
          <span class="stars-display">${starsHTML(review.rating)}</span>
          <span>${review.rating}/5</span>
          <span>${timeAgo(review.created_at)}</span>
        </div>
      </div>
    `;
  }

  // Load reviews
  async function loadReviews(catId = 'all') {
    renderSkeletons(grid, 6);
    const url = catId === 'all' ? '/reviews?limit=9' : `/reviews?category=${catId}&limit=9`;
    const data = await fetchAPI(url);
    const reviews = data?.data || data || [];

    if (!reviews.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">🔍</div>
          <h3>Belum ada review</h3>
          <p>Review untuk kategori ini segera hadir!</p>
        </div>
      `;
      return;
    }
    grid.innerHTML = reviews.map(reviewCardHTML).join('');
  }

  loadFeatured();
  loadReviews();

  // Search
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let searchTimer;
    searchInput.addEventListener('input', e => {
      clearTimeout(searchTimer);
      const q = e.target.value.trim();
      if (!q) { loadReviews(); return; }
      searchTimer = setTimeout(async () => {
        renderSkeletons(grid, 6);
        const data = await fetchAPI(`/reviews?search=${encodeURIComponent(q)}`);
        const reviews = data?.data || data || [];
        if (!reviews.length) {
          grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🔍</div><h3>Tidak ditemukan</h3><p>Coba kata kunci lain</p></div>`;
        } else {
          grid.innerHTML = reviews.map(reviewCardHTML).join('');
        }
      }, 400);
    });
  }
}

// ===== REVIEW DETAIL PAGE =====
async function initReviewPage() {
  const container = document.getElementById('review-container');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  if (!slug) { window.location.href = '/'; return; }

  container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⏳</div><h3>Memuat review...</h3></div>`;

  const data = await fetchAPI(`/reviews/${slug}`);
  const review = data?.data || data;

  if (!review) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">😕</div><h3>Review tidak ditemukan</h3><p><a href="/" style="color:var(--primary)">Kembali ke beranda</a></p></div>`;
    return;
  }

  // Update page title & meta
  document.title = `${review.title} - Revpeak`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.content = review.excerpt || '';

  // Parse pros/cons (bisa string JSON atau array)
  let pros = [], cons = [];
  try {
    pros = typeof review.pros === 'string' ? JSON.parse(review.pros) : (review.pros || []);
    cons = typeof review.cons === 'string' ? JSON.parse(review.cons) : (review.cons || []);
  } catch(e) {}

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
            ${pros.length ? `
              <div class="pros">
                <div class="pros-cons-title">👍 Kelebihan</div>
                <ul>${pros.map(p => `<li>${p}</li>`).join('')}</ul>
              </div>` : ''}
            ${cons.length ? `
              <div class="cons">
                <div class="pros-cons-title">👎 Kekurangan</div>
                <ul>${cons.map(c => `<li>${c}</li>`).join('')}</ul>
              </div>` : ''}
          </div>
        ` : ''}

        <div class="review-content">
          ${review.content || '<p>Konten review sedang ditulis...</p>'}
        </div>
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
            </div>
          ` : ''}

          ${review.affiliate_url ? `
            <div class="sidebar-card">
              <div class="sidebar-title">🛒 Dapatkan Sekarang</div>
              <a href="${review.affiliate_url}" target="_blank" rel="nofollow noopener" class="btn-affiliate" onclick="trackAffiliate('${review.slug}')">
                🛍️ Cek Harga Terbaik
              </a>
              <p class="btn-affiliate-note">* Link afiliasi – mendukung kami tanpa biaya tambahan</p>
            </div>
          ` : ''}

          <div class="sidebar-card">
            <div class="sidebar-title">📤 Bagikan</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button onclick="shareReview('wa')" class="btn-read-more" style="flex:1;text-align:center">WhatsApp</button>
              <button onclick="shareReview('copy')" class="btn-read-more" style="flex:1;text-align:center">Copy Link</button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  `;

  // Load related reviews
  loadRelated(review.category_id, review.slug);
}

async function loadRelated(categoryId, currentSlug) {
  const section = document.getElementById('related-section');
  if (!section || !categoryId) return;
  const data = await fetchAPI(`/reviews?category=${categoryId}&limit=3`);
  const reviews = (data?.data || data || []).filter(r => r.slug !== currentSlug).slice(0, 3);
  if (!reviews.length) { section.style.display = 'none'; return; }
  const grid = section.querySelector('.reviews-grid');
  if (grid) grid.innerHTML = reviews.map(reviewCardHTML).join('');
}

// Share
function shareReview(method) {
  const url = window.location.href;
  const title = document.title;
  if (method === 'wa') {
    window.open(`https://wa.me/?text=${encodeURIComponent(title + '\n' + url)}`, '_blank');
  } else if (method === 'copy') {
    navigator.clipboard.writeText(url).then(() => showToast('Link berhasil disalin! ✅', 'success'));
  }
}

// Track affiliate click (analytics)
function trackAffiliate(slug) {
  fetchAPI(`/track-affiliate?slug=${slug}`).catch(() => {});
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  ThemeManager.init();
  initScrollTop();
  initMobileMenu();
  initIndexPage();
  initReviewPage();
});
