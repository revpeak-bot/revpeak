/* ===========================
REVIEW DETAIL — review.js
Support: review, list, video, news
=========================== */
const API_BASE_R = '/api';
async function fetchR(endpoint) {
  try {
    const r = await fetch(API_BASE_R + endpoint);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) { console.error(e); return null; }
}

/* Utils */
function starsHTML(r) {
  r = parseFloat(r) || 0;
  const full = Math.floor(r), half = r % 1 >= 0.5 ? 1 : 0;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - half);
}
function ratingVerdict(r) {
  r = parseFloat(r) || 0;
  if (r >= 4.5) return 'Luar Biasa';
  if (r >= 4.0) return 'Sangat Bagus';
  if (r >= 3.5) return 'Bagus';
  if (r >= 3.0) return 'Cukup';
  return 'Di Bawah Rata-rata';
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtViews(v) {
  if (!v) return '';
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'jt';
  if (v >= 1000)    return (v / 1000).toFixed(1) + 'rb';
  return String(v);
}
function parseJSON(val, fallback = []) {
  if (!val) return fallback;
  if (typeof val !== 'string') return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

/* ===========================
MAIN INIT
=========================== */
async function initReviewPage() {
  const params = new URLSearchParams(window.location.search);
  const slug   = params.get('slug');
  if (!slug) { window.location.href = '/'; return; }
    fetchR(`/track-view?slug=${slug}`).catch(() => {});
  
  const data   = await fetchR(`/reviews/${slug}`);
  const review = data?.data || data;
  
  const loading   = document.getElementById('review-loading');
  const container = document.getElementById('review-container');
  if (loading)   loading.style.display   = 'none';
  if (container) container.style.display = 'block';
  
  if (!review) {
    container.innerHTML = `<div style="text-align:center;padding:80px 20px">
      <div style="font-size:64px;margin-bottom:20px">😕</div>
      <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:10px">Konten tidak ditemukan</h2>
      <p style="color:var(--text-muted);margin-bottom:24px">Mungkin sudah dihapus atau URL salah.</p>
      <a href="/" style="padding:10px 28px;background:var(--accent);color:#fff;border-radius:50px;font-weight:600">Kembali ke Beranda</a>
    </div>`;
    return;
  }
  
  document.title = review.title + ' – Revpeak';
  const metaDesc  = document.getElementById('meta-desc');
  const ogTitle   = document.getElementById('og-title');
  const ogDesc    = document.getElementById('og-desc');
  const ogImage   = document.getElementById('og-image');
  const pageTitle = document.getElementById('page-title');
  if (metaDesc)  metaDesc.content  = review.excerpt || '';
  if (ogTitle)   ogTitle.content   = review.title + ' – Revpeak';
  if (ogDesc)    ogDesc.content    = review.excerpt || '';
  if (ogImage)   ogImage.content   = review.image_url || '';
  if (pageTitle) pageTitle.textContent = review.title + ' – Revpeak';
  
  // ✅ DEBUG - Cek affiliate_url di console
  console.log('🔍 Review data:', review);
  console.log('🔍 Affiliate URL:', review?.affiliate_url);
  
  const type = review.post_type || 'review';
  if (type === 'list')  renderListArticle(container, review);
  else if (type === 'video') renderVideoArticle(container, review);
  else renderReviewArticle(container, review);
  
  if (review.category_id) loadRelated(review.category_id, review.slug);
}

/* ===========================
REVIEW BIASA
=========================== */
function renderReviewArticle(container, r) {
  const pros = parseJSON(r.pros, []);
  const cons = parseJSON(r.cons, []);  const breadcrumb = `<nav class="review-breadcrumb">
    <a href="/">Beranda</a> <span>›</span>
    <a href="kategori.html">Kategori</a>
    ${r.categories ? ` › <a href="kategori.html?cat=${r.categories.slug || r.category_id}">${r.categories.name}</a>` : ''}
    <span>›</span> <span>${r.title}</span>
  </nav>`;
  
  const heroMedia = r.image_url
    ? `<img class="review-hero-img" src="${r.image_url}" alt="${r.title}">`
    : `<div class="review-hero-placeholder">${r.emoji || '📱'}</div>`;
  
  const scoreBar = r.rating ? `<div class="score-bar">
    <div class="score-num">${r.rating}<span>/5</span></div>
    <div class="score-details">
      <div class="score-stars">${starsHTML(r.rating)}</div>
      <div class="score-verdict">${ratingVerdict(r.rating)}</div>
      <div class="score-label">Berdasarkan penilaian tim Revpeak</div>
    </div>
  </div>` : '';
  
  const prosConsHTML = (pros.length || cons.length) ? `<div class="pros-cons">
    ${pros.length ? `<div class="pros">
      <div class="pros-cons-title">👍 Kelebihan</div>
      <ul>${pros.map(p => `<li>${p}</li>`).join('')}</ul>
    </div>` : '<div></div>'}
    ${cons.length ? `<div class="cons">
      <div class="pros-cons-title">👎 Kekurangan</div>
      <ul>${cons.map(c => `<li>${c}</li>`).join('')}</ul>
    </div>` : '<div></div>'}
  </div>` : '';
  
  const sidebar = buildSidebar(r);
  
  container.innerHTML = `${breadcrumb}
    <div class="review-layout">
      <article class="review-article">
        <div class="review-header">
          <div class="review-type-badges">
            <span class="badge badge-review">📝 Review</span>
            ${r.categories ? `${r.categories.icon || ''} ${r.categories.name}` : ''}
          </div>
          <h1 class="review-title">${r.title}</h1>
          <div class="review-meta-row">
            <span class="review-meta-item">✍️ ${r.author || 'Admin'}</span>
            <span class="review-meta-item">📅 ${fmtDate(r.created_at)}</span>
            ${r.views ? `👁 ${fmtViews(r.views)} views` : ''}
          </div>
        </div>
        ${heroMedia}
        ${scoreBar}        ${prosConsHTML}
        <div class="review-content">${r.content || '<p>Konten sedang dipersiapkan...</p>'}</div>
      </article>
      <aside class="review-sidebar">
        <div class="sidebar-sticky">${sidebar}</div>
      </aside>
    </div>`;
}

/* ===========================
VIDEO ARTICLE
=========================== */
function renderVideoArticle(container, r) {
  let videoEmbed = '';
  if (r.video_url) {
    const ytMatch = r.video_url.match(/(?:youtube.com\/watch?v=|youtu.be\/)([^&\s]+)/);
    if (ytMatch) {
      videoEmbed = `<div class="review-video-wrap">
        <iframe src="https://www.youtube.com/embed/${ytMatch[1]}" title="${r.title}" allowfullscreen></iframe>
      </div>`;
    } else {
      videoEmbed = `<div class="review-video-wrap">
        <video controls poster="${r.image_url || ''}" style="width:100%;height:100%;border-radius:20px">
          <source src="${r.video_url}">
        </video>
      </div>`;
    }
  } else {
    videoEmbed = r.image_url
      ? `<img class="review-hero-img" src="${r.image_url}" alt="${r.title}">`
      : `<div class="review-hero-placeholder">${r.emoji || '▶️'}</div>`;
  }
  
  const sidebar = buildSidebar(r);
  
  container.innerHTML = `<nav class="review-breadcrumb">
    <a href="/">Beranda</a> <span>›</span>
    <a href="kategori.html">Kategori</a>
    ${r.categories ? ` › <a href="kategori.html?cat=${r.category_id}">${r.categories.name}</a>` : ''}
    <span>›</span> <span>${r.title}</span>
  </nav>
  <div class="review-layout">
    <article class="review-article">
      <div class="review-header">
        <div class="review-type-badges">
          <span class="badge badge-video">▶ Video</span>
          ${r.categories ? `${r.categories.icon || ''} ${r.categories.name}` : ''}
          ${r.duration ? `⏱ ${r.duration}` : ''}
        </div>
        <h1 class="review-title">${r.title}</h1>        <div class="review-meta-row">
          <span class="review-meta-item">✍️ ${r.author || 'Admin'}</span>
          <span class="review-meta-item">📅 ${fmtDate(r.created_at)}</span>
          ${r.views ? `👁 ${fmtViews(r.views)} views` : ''}
        </div>
      </div>
      ${videoEmbed}
      <div class="review-content">${r.content || ''}</div>
    </article>
    <aside class="review-sidebar">
      <div class="sidebar-sticky">${sidebar}</div>
    </aside>
  </div>`;
}

/* ===========================
LIST ARTICLE
=========================== */
function renderListArticle(container, r) {
  const products = parseJSON(r.products, []);
  const productsHTML = products.length
    ? products.map((p, i) => `<div class="list-product-card">
        <div class="list-rank">${i + 1}</div>
        <div class="list-product-img">
          ${p.image ? `<img src="${p.image}" alt="${p.name}">` : `<span>${p.emoji || '🛍️'}</span>`}
        </div>
        <div class="list-product-body">
          <div class="list-product-name">${p.name}</div>
          ${p.description ? `<div class="list-product-desc">${p.description}</div>` : ''}
          <div class="list-product-footer">
            ${p.price ? `<span class="list-product-price">${p.price}</span>` : ''}
            ${p.rating ? `<span class="list-product-rating">★ ${p.rating}</span>` : ''}
            ${p.affiliate_url ? `<a href="${p.affiliate_url}" target="_blank" rel="nofollow noopener" class="btn-cek-harga">🛍️ Cek Harga</a>` : ''}
          </div>
        </div>
      </div>`).join('')
    : `<p style="color:var(--text-muted);text-align:center;padding:32px">Daftar produk sedang dipersiapkan.</p>`;
  
  const tocHTML = products.length ? `<div class="sidebar-card">
    <div class="sidebar-title">📋 Daftar Isi</div>
    <div class="toc-list">
      ${products.map((p, i) => `<div class="toc-item" onclick="scrollToProduct(${i})">
        <span class="toc-num">${i + 1}</span>
        <span>${p.name}</span>
      </div>`).join('')}
    </div>
  </div>` : '';
  
  container.innerHTML = `<nav class="review-breadcrumb">
    <a href="/">Beranda</a> <span>›</span>    <a href="kategori.html">Kategori</a>
    ${r.categories ? ` › <a href="kategori.html?cat=${r.category_id}">${r.categories.name}</a>` : ''}
    <span>›</span> <span>${r.title}</span>
  </nav>
  <div class="review-layout">
    <article class="review-article">
      <div class="review-header">
        <div class="review-type-badges">
          <span class="badge badge-list">📋 List Produk</span>
          ${r.categories ? `${r.categories.icon || ''} ${r.categories.name}` : ''}
          ${products.length ? `${products.length} produk` : ''}
        </div>
        <h1 class="review-title">${r.title}</h1>
        <div class="review-meta-row">
          <span class="review-meta-item">✍️ ${r.author || 'Admin'}</span>
          <span class="review-meta-item">📅 ${fmtDate(r.created_at)}</span>
          ${r.views ? `👁 ${fmtViews(r.views)} views` : ''}
        </div>
      </div>
      ${r.image_url
        ? `<img class="review-hero-img" src="${r.image_url}" alt="${r.title}">`
        : `<div class="review-hero-placeholder">${r.emoji || '📋'}</div>`}
      ${r.excerpt ? `<div class="list-intro">${r.excerpt}</div>` : ''}
      ${r.content ? `<div class="review-content">${r.content}</div>` : ''}
      <div class="list-products-section">
        <h2 class="list-products-title">🛍️ ${products.length || 'Daftar'} Produk Rekomendasi</h2>
        <div class="list-products" id="list-products-wrap">${productsHTML}</div>
      </div>
    </article>
    <aside class="review-sidebar">
      <div class="sidebar-sticky">
        ${tocHTML}
        ${buildShareCard(r)}
      </div>
    </aside>
  </div>`;
}

/* ===========================
SIDEBAR BUILDER
=========================== */
function buildSidebar(r) {
  let html = '';
  
  // Rating
  if (r.rating) {
    html += `<div class="sidebar-card">
      <div class="sidebar-title">Penilaian Kami</div>
      <div class="rating-widget">
        <div class="rating-big-num">${r.rating}<span>/5</span></div>        <div class="rating-big-stars">${starsHTML(r.rating)}</div>
        <div class="rating-verdict">${ratingVerdict(r.rating)}</div>
      </div>
    </div>`;
  }
  
  // ✅ Affiliate - Perbaiki pengecekan
  const hasAffiliate = r.affiliate_url && 
                       typeof r.affiliate_url === 'string' && 
                       r.affiliate_url.trim() !== '' && 
                       r.affiliate_url !== 'null' &&
                       r.affiliate_url.startsWith('http');
  
  if (hasAffiliate) {
    console.log('✅ Affiliate URL found:', r.affiliate_url);
    html += `<div class="sidebar-card">
      <div class="sidebar-title">🛒 Beli Sekarang</div>
      <a href="${r.affiliate_url}" target="_blank" rel="nofollow noopener" 
         class="btn-affiliate" onclick="trackAffiliate('${r.slug}')">
         🛍️ Cek Harga Terbaik
      </a>
      <p class="affiliate-note">* Link afiliasi – mendukung kami tanpa biaya tambahan untuk kamu</p>
    </div>`;
  } else {
    console.warn('⚠️ No affiliate_url for slug:', r.slug, '| Value:', r.affiliate_url);
  }
  
  // Share
  html += buildShareCard(r);
  return html;
}

function buildShareCard(r) {
  return `<div class="sidebar-card">
    <div class="sidebar-title">📤 Bagikan</div>
    <div class="share-buttons">
      <button class="btn-share" onclick="shareTo('wa', '${r.title}')">WhatsApp</button>
      <button class="btn-share" onclick="shareTo('copy')">Salin Link</button>
    </div>
  </div>`;
}

/* ===========================
RELATED
=========================== */
async function loadRelated(categoryId, currentSlug) {
  const section = document.getElementById('related-section');
  const grid    = document.getElementById('related-grid');
  if (!section || !grid) return;
  const data  = await fetchR(`/related?slug=${currentSlug}&category_id=${categoryId}&limit=3`);  const items = data?.data || [];
  if (!items.length) return;
  section.style.display = 'block';
  grid.innerHTML = items.map(item => contentCardHTML(item)).join('');
}

/* ===========================
HELPERS
=========================== */
function trackAffiliate(slug) {
  fetchR(`/track-affiliate?slug=${slug}`).catch(() => {});
}
function shareTo(method, title) {
  const url = window.location.href;
  const t   = title || document.title;
  if (method === 'wa') {
    window.open(`https://wa.me/?text=${encodeURIComponent(t + '\n' + url)}`, '_blank');
  } else {
    navigator.clipboard.writeText(url)
      .then(() => showToast('✅ Link berhasil disalin!'))
      .catch(() => showToast('Gagal menyalin link'));
  }
}
function scrollToProduct(index) {
  const cards = document.querySelectorAll('.list-product-card');
  cards[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function showToast(msg) {
  const zone = document.getElementById('toast-zone');
  if (!zone) return;
  const t = document.createElement('div');
  t.className = 'toast-item success';
  t.textContent = msg;
  zone.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
function contentCardHTML(item) {
  return `<div class="card">
    <div class="card-thumb">${item.image_url ? `<img src="${item.image_url}">` : item.emoji||'📝'}</div>
    <div class="card-body">
      <div class="card-title">${item.title}</div>
      <div class="card-meta">${item.categories?.name || ''}</div>
    </div>
    <a href="review.html?slug=${item.slug}" class="card-link"></a>
  </div>`;
}

/* ===========================
INIT
=========================== */document.addEventListener('DOMContentLoaded', () => {
  initReviewPage();
});