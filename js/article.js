// ============================================================
// REVPEAK — article.js
// Menangani: article.html (detail artikel & berita)
// ============================================================

const API_BASE = "https://revpeak-api.revpeak2.workers.dev"; // ganti dengan URL Worker Anda

// ============================================================
// UTILS
// ============================================================

function $(sel, ctx = document) { return ctx.querySelector(sel); }

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function formatDateISO(iso) {
  if (!iso) return "";
  return new Date(iso).toISOString();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Hitung estimasi waktu baca dari konten HTML (strip tag, hitung kata)
function calcReadingTime(content) {
  if (!content) return 1;
  const text  = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200)); // ~200 kata/menit (Bahasa Indonesia)
}

async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// Ambil slug dari clean URL (misal: /nama-artikel)
function getSlugFromPath() {
  const path = window.location.pathname;
  // Bersihkan slash di awal/akhir
  return path.replace(/^\/|\/$/g, "") || null;
}

// ============================================================
// META & OG TAGS
// ============================================================

function setMeta(name, content) {
  if (!content) return;
  let el = document.querySelector(`meta[name="${name}"]`)
        || document.querySelector(`meta[property="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    const attr = name.startsWith("og:") || name.startsWith("article:") ? "property" : "name";
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function updateMetaTags(article) {
  const siteUrl  = window.location.origin;
  const pageUrl  = `${siteUrl}/${article.slug}`;
  const desc     = article.excerpt || article.title;
  const image    = article.thumbnail_url || "";
  const author   = article.authors?.name || "Revpeak";

  document.title = `${article.title} — Revpeak`;

  setMeta("description",             desc);
  setMeta("author",                  author);

  // Open Graph
  setMeta("og:title",                article.title);
  setMeta("og:description",          desc);
  setMeta("og:url",                  pageUrl);
  setMeta("og:image",                image);
  setMeta("og:type",                 article.post_type === "news" ? "article" : "article");
  setMeta("og:site_name",            "Revpeak");
  setMeta("og:locale",               "id_ID");

  // Article-specific OG
  if (article.published_at) setMeta("article:published_time", formatDateISO(article.published_at));
  if (article.updated_at)   setMeta("article:modified_time",  formatDateISO(article.updated_at));
  if (author)               setMeta("article:author",         author);
  if (article.categories?.name) setMeta("article:section",   article.categories.name);
  if (article.tags?.length) {
    article.tags.forEach(tag => {
      const el = document.createElement("meta");
      el.setAttribute("property", "article:tag");
      el.setAttribute("content", tag);
      document.head.appendChild(el);
    });
  }

  // Twitter Card
  setMeta("twitter:card",            "summary_large_image");
  setMeta("twitter:title",           article.title);
  setMeta("twitter:description",     desc);
  setMeta("twitter:image",           image);

  // Canonical
  let canonical = document.querySelector("link[rel='canonical']");
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.setAttribute("rel", "canonical");
    document.head.appendChild(canonical);
  }
  canonical.setAttribute("href", pageUrl);
}

// ============================================================
// SCHEMA.ORG JSON-LD
// ============================================================

function injectSchema(article) {
  const siteUrl  = window.location.origin;
  const pageUrl  = `${siteUrl}/${article.slug}`;
  const author   = article.authors || {};

  const schema = {
    "@context": "https://schema.org",
    "@type": article.post_type === "news" ? "NewsArticle" : "Article",
    "headline":        article.title,
    "description":     article.excerpt || article.title,
    "url":             pageUrl,
    "datePublished":   formatDateISO(article.published_at),
    "dateModified":    formatDateISO(article.updated_at || article.published_at),
    "image":           article.thumbnail_url
      ? [{
          "@type":  "ImageObject",
          "url":    article.thumbnail_url,
          "width":  1200,
          "height": 630
        }]
      : undefined,
    "author": {
      "@type": "Person",
      "name":  author.name || "Revpeak",
      "url":   author.slug ? `${siteUrl}/penulis/${author.slug}` : siteUrl,
    },
    "publisher": {
      "@type": "Organization",
      "name":  "Revpeak",
      "url":   siteUrl,
      "logo": {
        "@type": "ImageObject",
        "url":   `${siteUrl}/logo-revpeak.webp`,
      }
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id":   pageUrl,
    },
  };

  if (article.categories?.name) {
    schema.articleSection = article.categories.name;
  }

  if (article.tags?.length) {
    schema.keywords = article.tags.join(", ");
  }

  // Hapus undefined
  const clean = JSON.parse(JSON.stringify(schema));

  const existing = document.getElementById("schema-jsonld");
  if (existing) existing.remove();

  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.id   = "schema-jsonld";
  script.textContent = JSON.stringify(clean, null, 2);
  document.head.appendChild(script);
}

// ============================================================
// BREADCRUMB
// ============================================================

function renderBreadcrumb(article) {
  const el = $("#breadcrumb");
  if (!el) return;

  const cat = article.categories;
  const items = [
    { label: "Beranda", href: "/" },
    cat ? { label: cat.name, href: `/kategori/${cat.slug}` } : null,
    { label: article.title, href: null },
  ].filter(Boolean);

  el.innerHTML = `
    <nav aria-label="Breadcrumb">
      <ol class="breadcrumb-list" itemscope itemtype="https://schema.org/BreadcrumbList">
        ${items.map((item, i) => `
          <li class="breadcrumb-item" itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
            ${item.href
              ? `<a href="${escapeHtml(item.href)}" itemprop="item"><span itemprop="name">${escapeHtml(item.label)}</span></a>`
              : `<span class="breadcrumb-current" itemprop="name" aria-current="page">${escapeHtml(item.label)}</span>`}
            <meta itemprop="position" content="${i + 1}">
          </li>`).join('<li class="breadcrumb-sep" aria-hidden="true">/</li>')}
      </ol>
    </nav>`;
}

// ============================================================
// RENDER ARTIKEL — bangun HTML langsung ke wrapper
// ============================================================

function renderArticle(article) {
  const author      = article.authors    || {};
  const cat         = article.categories || {};
  const wrapper     = $("#article-wrapper");
  if (!wrapper) return;

  const readingMins = calcReadingTime(article.content);
  const readingLabel = `${readingMins} menit baca`;

  const badge    = article.post_type === "news" ? "Berita" : "Artikel";
  const badgeCls = article.post_type === "news" ? "badge-news" : "badge-article";

  const catLink = cat.slug
    ? `<a href="/kategori/${escapeHtml(cat.slug)}" class="article-category-link">${escapeHtml(cat.name)}</a>`
    : "";

  const thumbnail = article.thumbnail_url
    ? `<div class="article-thumbnail-wrap">
         <img class="article-thumbnail"
              src="${escapeHtml(article.thumbnail_url)}"
              alt="${escapeHtml(article.thumbnail_alt || article.title)}"
              loading="eager">
       </div>` : "";

  const avatarHtml = author.avatar_url
    ? `<div class="author-avatar-wrap">
         <img class="article-author-avatar"
              src="${escapeHtml(author.avatar_url)}"
              alt="${escapeHtml(author.name || "")}" loading="lazy">
       </div>` : "";

  const excerptHtml = article.excerpt
    ? `<p class="article-excerpt">${escapeHtml(article.excerpt)}</p>` : "";

  const tagsHtml = article.tags?.length
    ? `<div class="article-tags">
         ${article.tags.map(t =>
           `<a href="/search.html?q=${encodeURIComponent(t)}" class="article-tag">${escapeHtml(t)}</a>`
         ).join("")}
       </div>` : "";

  wrapper.innerHTML = `
    <div id="breadcrumb" class="article-breadcrumb"></div>
    <header class="article-header">
      <div class="article-meta-top">
        ${catLink}
        <span class="article-badge ${badgeCls}">${badge}</span>
      </div>
      <h1 class="article-title">${escapeHtml(article.title)}</h1>
      ${excerptHtml}
      <div class="article-meta-bar">
        <div class="article-author-info">
          ${avatarHtml}
          <div class="article-author-text">
            <a href="/penulis/${encodeURIComponent(author.slug || "")}"
               class="article-author-name-link">
              <span class="article-author-name">${escapeHtml(author.name || "Revpeak")}</span>
            </a>
            <div class="article-meta-secondary">
              <time class="article-date">${formatDate(article.published_at)}</time>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="article-views">${article.view_count || 0} kali dibaca</span>
              <span class="meta-sep" aria-hidden="true">·</span>
              <span class="article-reading-time" aria-label="Estimasi waktu baca: ${readingLabel}">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true" style="vertical-align:-1px;opacity:.7"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                ${readingLabel}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
    ${thumbnail}
    <div id="article-content" class="article-content"></div>
    ${tagsHtml}`;

  // Sanitasi konten — menangani artikel lama yang tersimpan
  // dengan tag tidak valid (<2>, ##, **bold**, dll.)
  function sanitizeContent(html) {
    return html
      .replace(/<(\/?)\s*([1-6])\s*>/g, "<$1h$2>")
      .replace(/^(#{1,6})\s+(.+)$/gm, (_, h, t) => `<h${h.length}>${t.trim()}</h${h.length}>`)
      .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  }

  // Isi konten secara terpisah agar HTML dari AI tidak di-escape
  const contentEl = document.getElementById("article-content");
  if (contentEl) {
    contentEl.innerHTML = sanitizeContent(article.content || "<p>Konten tidak tersedia.</p>");
    contentEl.querySelectorAll("img").forEach(img => {
      img.setAttribute("loading", "lazy");
      if (!img.alt) img.alt = article.title;
    });
  }
}
// ============================================================
// ARTIKEL TERKAIT
// ============================================================

async function loadRelatedArticles(article) {
  const container = $("#related-articles");
  if (!container) return;

  try {
    const catSlug = article.categories?.slug;
    const type    = article.post_type;

    let url = `/api/articles?sort=latest&limit=4`;
    if (catSlug) url += `&category=${encodeURIComponent(catSlug)}`;
    else if (type) url += `&type=${type}`;

    const res = await apiFetch(url);
    const articles = (res.data || []).filter(a => a.slug !== article.slug).slice(0, 3);

    if (!articles.length) { container.closest(".related-section")?.remove(); return; }

    const grid = container.querySelector(".related-grid") || container;
    grid.innerHTML = articles.map(a => {
      const cat = a.categories || {};
      return `
        <article class="related-card">
          <a href="/${escapeHtml(a.slug)}" class="related-thumbnail-link" aria-label="${escapeHtml(a.title)}">
            <div class="related-thumbnail">
              ${a.thumbnail_url
                ? `<img src="${escapeHtml(a.thumbnail_url)}" alt="${escapeHtml(a.title)}" loading="lazy">`
                : `<div class="related-thumbnail-placeholder" aria-hidden="true"></div>`}
            </div>
          </a>
          <div class="related-body">
            ${cat.name ? `<span class="related-category">${escapeHtml(cat.name)}</span>` : ""}
            <h3 class="related-title">
              <a href="/${escapeHtml(a.slug)}">${escapeHtml(a.title)}</a>
            </h3>
            <span class="related-date">${formatDate(a.published_at)}</span>
          </div>
        </article>`;
    }).join("");
  } catch {
    container.closest(".related-section")?.remove();
  }
}

// ============================================================
// INCREMENT VIEW COUNT
// ============================================================

async function incrementView(slug) {
  try {
    const url = `${API_BASE}/api/views/${encodeURIComponent(slug)}`;
    const sent = navigator.sendBeacon ? navigator.sendBeacon(url) : false;

    if (!sent) {
      // Fallback jika sendBeacon tidak tersedia atau gagal
      await fetch(url, { method: "POST" });
    }

    // Perbarui tampilan view count di DOM setelah increment berhasil
    const viewEl = document.querySelector(".article-views");
    if (viewEl) {
      const current = parseInt(viewEl.textContent, 10) || 0;
      viewEl.textContent = `${current + 1} kali dibaca`;
    }
  } catch {
    // Gagal increment tidak perlu ditangani secara visual
  }
}

// ============================================================
// LOADING & ERROR STATE
// ============================================================

function showLoading() {
  const wrapper = $("#article-wrapper");
  if (!wrapper) return;
  wrapper.innerHTML = `
    <div class="article-skeleton" aria-label="Memuat artikel..." role="status">
      <div class="skeleton-box article-thumb-skeleton"></div>
      <div class="skeleton-line short"></div>
      <div class="skeleton-line title"></div>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    </div>`;
}

function showNotFound() {
  const wrapper = $("#article-wrapper");
  if (wrapper) {
    wrapper.innerHTML = `
      <div class="not-found-state" role="alert">
        <h1>Artikel tidak ditemukan</h1>
        <p>Halaman yang Anda cari mungkin telah dihapus atau alamatnya salah.</p>
        <a href="/" class="btn-primary">Kembali ke Beranda</a>
      </div>`;
  }
  document.title = "Artikel Tidak Ditemukan — Revpeak";
}

function showLoadError() {
  const wrapper = $("#article-wrapper");
  if (wrapper) {
    wrapper.innerHTML = `
      <div class="error-state" role="alert">
        <h1>Gagal memuat artikel</h1>
        <p>Terjadi kesalahan saat mengambil data. Silakan coba lagi.</p>
        <button onclick="window.location.reload()" class="btn-primary">Coba Lagi</button>
      </div>`;
  }
}

// ============================================================
// INIT
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  const slug = getSlugFromPath();

  if (!slug) {
    showNotFound();
    return;
  }

  showLoading();

  try {
    const article = await apiFetch(`/api/articles/${encodeURIComponent(slug)}`);

    if (!article || article.error) {
      showNotFound();
      return;
    }

    // Render konten
    renderArticle(article);
    renderBreadcrumb(article);

    // Update meta & schema
    updateMetaTags(article);
    injectSchema(article);

    // Artikel terkait
    await loadRelatedArticles(article);

    // Increment view (dengan delay kecil agar tidak dihitung bot)
    setTimeout(() => incrementView(slug), 3000);

  } catch (err) {
    if (err.message.includes("404")) showNotFound();
    else showLoadError();
  }
});
