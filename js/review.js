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
    container.innerHTML = `
      <div style="text-align:center;padding:80px 20px">
        <div style="font-size:64px;margin-bottom:20px">😕</div>
        <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-bottom:10px">Konten tidak ditemukan</h2>
        <p style="color:var(--text-muted);margin-bottom:24px">Mungkin sudah dihapus atau URL salah.</p>
        <a href="/" style="padding:10px 28px;background:var(--accent);color:#fff;border-radius:50px;font-weight:600">Kembali ke Beranda</a>
      </div>`;
    return;
  }

  const pageFullTitle = review.title + ' – Revpeak';
  const pageURL       = 'https://revpeak.web.id/review.html?slug=' + slug;

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

  updateArticleSchema(review, pageURL);

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
   (FUNGSI RENDER LAIN TETAP SAMA)
=========================== */

/* ===========================
   SCHEMA FINAL AUTO DETECT
=========================== */
function updateArticleSchema(r, pageURL) {
  const el = document.getElementById('article-schema');
  if (!el) return;

  const type = r.post_type || 'article';

  let schema = {
    '@context': 'https://schema.org',
    '@id': pageURL + '#main',
    'url': pageURL,
    'name': r.title,
    'headline': r.title,
    'description': r.excerpt || '',
    'inLanguage': 'id',
    'datePublished': r.created_at || '',
    'dateModified': r.updated_at || r.created_at || '',
    'author': {
      '@type': 'Person',
      'name': r.author || 'Admin Revpeak'
    },
    'publisher': {
      '@type': 'Organization',
      'name': 'Revpeak',
      'url': 'https://revpeak.web.id',
      'logo': {
        '@type': 'ImageObject',
        'url': 'https://assets.revpeak.web.id/logo-revpeak.webp'
      }
    }
  };

  // ================= REVIEW =================
  if (type === 'review') {
    schema['@type'] = 'Review';

    schema['itemReviewed'] = {
      '@type': 'Product',
      '@id': pageURL + '#product',
      'name': r.title,
      'image': r.image_url || '',
      'description': r.excerpt || '',
      'brand': {
        '@type': 'Brand',
        'name': extractBrand(r.title)
      },
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': r.rating ? parseFloat(r.rating) : 4.5,
        'reviewCount': 1
      }
    };

    schema['reviewRating'] = {
      '@type': 'Rating',
      'ratingValue': r.rating ? parseFloat(r.rating) : 5,
      'bestRating': 5,
      'worstRating': 1
    };
  }

  // ================= ARTICLE =================
  else if (type === 'article') {
    schema['@type'] = 'Article';
  }

  // ================= VIDEO =================
  else if (type === 'video') {
    schema['@type'] = 'VideoObject';
    if (r.video_url) {
      schema['contentUrl'] = r.video_url;
      schema['embedUrl'] = r.video_url;
    }
  }

  // ================= LIST =================
  else if (type === 'list') {
    schema['@type'] = 'ItemList';
  }

  if (r.image_url) {
    schema['image'] = {
      '@type': 'ImageObject',
      'url': r.image_url
    };
  }

  el.textContent = JSON.stringify(schema, null, 2);
}

/* ===========================
   HELPER BRAND
=========================== */
function extractBrand(title) {
  if (!title) return 'Unknown';
  const brands = ['Samsung','Xiaomi','Infinix','Oppo','Vivo','Realme','Apple'];
  for (let b of brands) {
    if (title.toLowerCase().includes(b.toLowerCase())) return b;
  }
  return 'Unknown';
}

/* ===========================
   INIT
=========================== */
document.addEventListener('DOMContentLoaded', () => {
  initReviewPage();
});