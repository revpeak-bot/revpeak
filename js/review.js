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
  // ── PERUBAHAN: baca slug dari pathname (clean URL) ──
  // Sebelumnya: new URLSearchParams(window.location.search).get('slug')
  const slug = window.location.pathname.slice(1);

  if (!slug) { window.location.href = '/'; return; }

  // Track view (fire and forget)
  fetchR(`/track-view?slug=${slug}`).catch(() => {});

  // Fetch data
  const data   = await fetchR(`/reviews/${slug}`);
  const review = data?.data || data;

  // Hide loading
  const loading   = document.getElementById('review-loading');
  const container = document.getElementById('review-container');
  if (loading)   loading.style.display   = 'none';
  if (container) container.style.display = 'block';

  if (!review) {
    container.innerHTML = `
      <div style="text-align:center;padding:80px 20px">
        <div style="font-size:64px;margin-bottom:20px">😕</div>
        <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:10px">Konten tidak ditemukan</h2>
        <p style="color:var(--text-muted);margin-bottom:24px">Mungkin sudah dihapus atau URL salah.</p>
        <a href="/" style="padding:10px 28px;background:var(--accent);color:#fff;border-radius:50px;font-weight:600">Kembali ke Beranda</a>
      </div>`;
    return;
  }

  // Update meta tags
  // ── PERUBAHAN: pageURL menggunakan clean URL ──
  const pageFullTitle = review.title + ' – Revpeak';
  const pageURL       = 'https://revpeak.web.id/' + slug;

  document.title = pageFullTitle;

  const metaDesc   = document.getElementById('meta-desc');
  const ogTitle    = document.getElementById('og-title');
  const ogDesc     = document.getElementById('og-desc');
  const ogImage    = document.getElementById('og-image');
  const canonical  = document.getElementById('canonical-url');

  if (metaDesc)  metaDesc.setAttribute('content', review.excerpt || '');
  if (ogTitle)   ogTitle.setAttribute('content', pageFullTitle);
  if (ogDesc)    ogDesc.setAttribute('content', review.excerpt || '');
  if (ogImage)   ogImage.setAttribute('content', review.image_url || '');
  if (canonical) canonical.setAttribute('href', pageURL);

  // Update JSON-LD schema
  updateArticleSchema(review, pageURL);

  // Render berdasarkan post_type
  const type = review.post_type || 'review';
  if (type === 'list')       renderListArticle(container, review);
  else if (type === 'video') renderVideoArticle(container, review);
  else                       renderReviewArticle(container, review);

  // Load related
  if (review.category_id) loadRelated(review.category_id, review.slug);
}

/* ===========================
   REVIEW BIASA
=========================== */
function renderReviewArticle(container, r) {
  const pros = parseJSON(r.pros, []);
  const cons = parseJSON(r.cons, []);

  const breadcrumb = `
    <nav class="review-breadcrumb">
      <a href="/">Beranda</a>
      <span>›</span>
      <a href="kategori.html">Kategori</a>
      ${r.categories ? `<span>›</span><a href="kategori.html?cat=${r.categories.slug || r.category_id}">${r.categories.name}</a>` : ''}
      <span>›</span>
      <span>${r.title}</span>
    </nav>`;

  const heroMedia = r.image_url
    ? `<img class="review-hero-img" src="${r.image_url}" alt="${r.title}">`
    : `<div class="review-hero-placeholder">${r.emoji || '📱'}</div>`;

  const scoreBar = r.rating ? `
    <div class="score-bar">
      <div class="score-num">${r.rating}<span>/5</span></div>
      <div class="score-details">
        <div class="score-stars">${starsHTML(r.rating)}</div>
        <div class="score-verdict">${ratingVerdict(r.rating)}</div>
        <div class="score-label">Berdasarkan penilaian tim Revpeak</div>
      </div>
    </div>` : '';

  const prosConsHTML = (pros.length || cons.length) ? `
    <div class="pros-cons">
      ${pros.length ? `
        <div class="pros">
          <div class="pros-cons-title">👍 Kelebihan</div>
          <ul>${pros.map(p => `<li>${p}</li>`).join('')}</ul>
        </div>` : '<div></div>'}
      ${cons.length ? `
        <div class="cons">
          <div class="pros-cons-title">👎 Kekurangan</div>
          <ul>${cons.map(c => `<li>${c}</li>`).join('')}</ul>
        </div>` : '<div></div>'}
    </div>` : '';

  const sidebar = buildSidebar(r);

  container.innerHTML = `
    ${breadcrumb}
    <div class="review-layout">
      <article class="review-article">
        <div class="review-header">
          <div class="review-type-badges">
            <span class="badge badge-review">📝 Review</span>
            ${r.categories ? `<span class="badge badge-cat">${r.categories.icon || ''} ${r.categories.name}</span>` : ''}
          </div>
          <h1 class="review-title">${r.title}</h1>
          <div class="review-meta-row">
            <span class="review-meta-item">✍️ ${r.author || 'Admin'}</span>
            <span class="review-meta-item">📅 ${fmtDate(r.created_at)}</span>
            ${r.views ? `<span class="review-meta-item">👁 ${fmtViews(r.views)} views</span>` : ''}
          </div>
        </div>
        ${heroMedia}
        ${scoreBar}
        ${prosConsHTML}
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
    const ytMatch = r.video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
    if (ytMatch) {
      videoEmbed = `
        <div class="review-video-wrap">
          <iframe src="https://www.youtube.com/embed/${ytMatch[1]}" title="${r.title}" allowfullscreen></iframe>
        </div>`;
    } else {
      videoEmbed = `
        <div class="review-video-wrap">
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

  container.innerHTML = `
    <nav class="review-breadcrumb">
      <a href="/">Beranda</a>
      <span>›</span>
      <a href="kategori.html">Kategori</a>
      ${r.categories ? `<span>›</span><a href="kategori.html?cat=${r.category_id}">${r.categories.name}</a>` : ''}
      <span>›</span><span>${r.title}</span>
    </nav>
    <div class="review-layout">
      <article class="review-article">
        <div class="review-header">
          <div class="review-type-badges">
            <span class="badge badge-video">▶ Video</span>
            ${r.categories ? `<span class="badge badge-cat">${r.categories.icon || ''} ${r.categories.name}</span>` : ''}
            ${r.duration ? `<span class="badge badge-cat">⏱ ${r.duration}</span>` : ''}
          </div>
          <h1 class="review-title">${r.title}</h1>
          <div class="review-meta-row">
            <span class="review-meta-item">✍️ ${r.author || 'Admin'}</span>
            <span class="review-meta-item">📅 ${fmtDate(r.created_at)}</span>
            ${r.views ? `<span class="review-meta-item">👁 ${fmtViews(r.views)} views</span>` : ''}
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

  const tocHTML = products.length ? `
    <div class="list-toc">
      <div class="list-toc-title">📋 Daftar Isi</div>
      <ol class="list-toc-ol">
        ${products.map((p, i) => `<li><a href="#" onclick="scrollToProduct(${i});return false">${p.name}</a></li>`).join('')}
      </ol>
    </div>` : '';

  const productsHTML = products.map((p, i) => `
    <div class="list-product-card" id="product-${i}">
      ${p.image ? `<img class="list-product-img" src="${p.image}" alt="${p.name}">` : ''}
      <div class="list-product-body">
        <div class="list-product-rank">#${i + 1}</div>
        <h3 class="list-product-name">${p.name}</h3>
        ${p.description ? `<p class="list-product-desc">${p.description}</p>` : ''}
        ${p.affiliate_url ? `<a href="${p.affiliate_url}" class="btn-affiliate" target="_blank" rel="nofollow noopener">🛍️ Cek Harga</a>` : ''}
      </div>
    </div>`).join('');

  const sidebar = buildSidebar(r);

  container.innerHTML = `
    <nav class="review-breadcrumb">
      <a href="/">Beranda</a>
      <span>›</span>
      <a href="kategori.html">Kategori</a>
      ${r.categories ? `<span>›</span><a href="kategori.html?cat=${r.category_id}">${r.categories.name}</a>` : ''}
      <span>›</span><span>${r.title}</span>
    </nav>
    <div class="review-layout">
      <article class="review-article">
        <div class="review-header">
          <div class="review-type-badges">
            <span class="badge badge-list">📋 List</span>
            ${r.categories ? `<span class="badge badge-cat">${r.categories.icon || ''} ${r.categories.name}</span>` : ''}
          </div>
          <h1 class="review-title">${r.title}</h1>
          <div class="review-meta-row">
            <span class="review-meta-item">✍️ ${r.author || 'Admin'}</span>
            <span class="review-meta-item">📅 ${fmtDate(r.created_at)}</span>
            ${r.views ? `<span class="review-meta-item">👁 ${fmtViews(r.views)} views</span>` : ''}
          </div>
        </div>
        ${r.image_url ? `<img class="review-hero-img" src="${r.image_url}" alt="${r.title}">` : ''}
        ${tocHTML}
        <div class="review-content">${r.content || ''}</div>
        <div class="list-products">${productsHTML}</div>
      </article>
      <aside class="review-sidebar">
        <div class="sidebar-sticky">
          ${sidebar}
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

  if (r.rating) {
    html += `
      <div class="sidebar-card">
        <div class="sidebar-title">Penilaian Kami</div>
        <div class="rating-widget">
          <div class="rating-big-num">${r.rating}<span>/5</span></div>
          <div class="rating-big-stars">${starsHTML(r.rating)}</div>
          <div class="rating-verdict">${ratingVerdict(r.rating)}</div>
        </div>
      </div>`;
  }

  if (r.affiliate_url) {
    html += `
      <div class="sidebar-card">
        <div class="sidebar-title">🛒 Beli Sekarang</div>
        <a href="${r.affiliate_url}" target="_blank" rel="nofollow noopener"
           class="btn-affiliate"
           onclick="trackAffiliate('${r.slug}')">
          🛍️ Cek Harga Terbaik
        </a>
        <p class="affiliate-note">* Link afiliasi – mendukung kami tanpa biaya tambahan untuk kamu</p>
      </div>`;
  }

  html += buildShareCard(r);

  return html;
}

function buildShareCard(r) {
  return `
    <div class="sidebar-card">
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

  const data  = await fetchR(`/related?slug=${currentSlug}&category_id=${categoryId}&limit=3`);
  const items = data?.data || [];

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

/* ===========================
   INIT
=========================== */
document.addEventListener('DOMContentLoaded', () => {
  initReviewPage();
});

/* ===========================
   UPDATE JSON-LD SCHEMA
=========================== */
function updateArticleSchema(r, pageURL) {
  const el = document.getElementById('article-schema');
  if (!el) return;

  const type = (r.post_type || 'review').toLowerCase();

  const publisher = {
    '@type': 'Organization',
    'name':  'Revpeak',
    'url':   'https://revpeak.web.id',
    'logo': {
      '@type': 'ImageObject',
      'url':   'https://assets.revpeak.web.id/logo-revpeak.webp'
    }
  };

  const author = {
    '@type': 'Person',
    'name':  r.author || 'Admin Revpeak'
  };

  const image = r.image_url ? {
    '@type': 'ImageObject',
    'url':   r.image_url
  } : undefined;

  let schema = {};

  if (type === 'review') {
    schema = {
      '@context':    'https://schema.org',
      '@type':       'Review',
      'name':        r.title,
      'description': r.excerpt || '',
      'url':         pageURL,
      'inLanguage':  'id',
      'datePublished': r.created_at || '',
      'dateModified':  r.updated_at || r.created_at || '',
      'author':    author,
      'publisher': publisher,
      'itemReviewed': {
        '@type':       'Product',
        'name':        r.title,
        'description': r.excerpt || '',
        // ── FIX: aggregateRating hanya ditambahkan jika r.rating ada ──
        ...(r.rating ? {
          'aggregateRating': {
            '@type':       'AggregateRating',
            'ratingValue': parseFloat(r.rating),
            'bestRating':  5,
            'worstRating': 1,
            'reviewCount': 1
          }
        } : {})
      },
      // ── FIX: reviewRating hanya ditambahkan jika r.rating ada ──
      ...(r.rating ? {
        'reviewRating': {
          '@type':       'Rating',
          'ratingValue': parseFloat(r.rating),
          'bestRating':  5,
          'worstRating': 1
        }
      } : {})
    };
    if (image) schema['image'] = image;
  }

  else if (type === 'video') {
    schema = {
      '@context':     'https://schema.org',
      '@type':        'VideoObject',
      'name':         r.title,
      'description':  r.excerpt || '',
      'thumbnailUrl': r.image_url || '',
      'uploadDate':   r.created_at || '',
      'url':          pageURL,
      'inLanguage':   'id',
      'author':       author,
      'publisher':    publisher
    };
    if (r.video_url) schema['contentUrl'] = r.video_url;
    if (r.duration)  schema['duration']   = r.duration;
    if (image)       schema['image']      = image;
  }

  else if (type === 'list') {
    const products = (typeof r.products === 'string')
      ? (() => { try { return JSON.parse(r.products); } catch { return []; } })()
      : (r.products || []);
    schema = {
      '@context':     'https://schema.org',
      '@type':        'ItemList',
      'name':         r.title,
      'description':  r.excerpt || '',
      'url':          pageURL,
      'inLanguage':   'id',
      'numberOfItems': products.length,
      'itemListElement': products.map((p, i) => ({
        '@type':       'ListItem',
        'position':    i + 1,
        'name':        p.name,
        'description': p.description || ''
      }))
    };
    if (image) schema['image'] = image;
  }

  else if (type === 'news') {
    schema = {
      '@context':      'https://schema.org',
      '@type':         'NewsArticle',
      'headline':      r.title,
      'description':   r.excerpt || '',
      'url':           pageURL,
      'inLanguage':    'id',
      'datePublished': r.created_at || '',
      'dateModified':  r.updated_at || r.created_at || '',
      'author':        author,
      'publisher':     publisher
    };
    if (image) schema['image'] = image;
  }

  else {
    schema = {
      '@context':      'https://schema.org',
      '@type':         'Article',
      'headline':      r.title,
      'description':   r.excerpt || '',
      'url':           pageURL,
      'inLanguage':    'id',
      'datePublished': r.created_at || '',
      'dateModified':  r.updated_at || r.created_at || '',
      'author':        author,
      'publisher':     publisher
    };
    if (image) schema['image'] = image;
  }

  el.textContent = JSON.stringify(schema, null, 2);
}
