// ============================================================
// REVPEAK — seo.js
// Global SEO: Schema.org, meta default, breadcrumb listing,
// WebSite search schema, & sitemap ping
// Sertakan di semua halaman: <script src="/js/seo.js" defer></script>
// ============================================================

const SITE_NAME    = "Revpeak";
const SITE_URL     = "https://revpeak.web.id"; // ganti jika domain berubah
const SITE_LOGO    = `${SITE_URL}/assets/img/logo.png`;
const SITE_DESC    = "Berita dan artikel terpercaya seputar teknologi, bisnis, dan gaya hidup.";
const SITE_LANG    = "id";

// ============================================================
// UTILS
// ============================================================

function injectJsonLd(id, data) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const script = document.createElement("script");
  script.type        = "application/ld+json";
  script.id          = id;
  script.textContent = JSON.stringify(data, null, 2);
  document.head.appendChild(script);
}

function setMetaDefault(name, content, isProperty = false) {
  const attr = isProperty ? "property" : "name";
  const existing = document.querySelector(`meta[${attr}="${name}"]`);
  // Jangan timpa jika sudah diset oleh article.js
  if (!existing) {
    const el = document.createElement("meta");
    el.setAttribute(attr, name);
    el.setAttribute("content", content);
    document.head.appendChild(el);
  }
}

function getCurrentPageUrl() {
  return `${SITE_URL}${window.location.pathname}${window.location.search}`;
}

// ============================================================
// 1. ORGANIZATION SCHEMA (semua halaman)
// ============================================================

function injectOrganizationSchema() {
  injectJsonLd("schema-organization", {
    "@context":   "https://schema.org",
    "@type":      "Organization",
    "name":       SITE_NAME,
    "url":        SITE_URL,
    "logo": {
      "@type":    "ImageObject",
      "url":      SITE_LOGO,
    },
    "sameAs": [
      // Tambahkan URL media sosial Revpeak di sini
      // "https://twitter.com/revpeak",
      // "https://instagram.com/revpeak",
    ]
  });
}

// ============================================================
// 2. WEBSITE SCHEMA + SITELINKS SEARCHBOX (homepage)
// ============================================================

function injectWebSiteSchema() {
  injectJsonLd("schema-website", {
    "@context":      "https://schema.org",
    "@type":         "WebSite",
    "name":          SITE_NAME,
    "url":           SITE_URL,
    "description":   SITE_DESC,
    "inLanguage":    SITE_LANG,
    "potentialAction": {
      "@type":       "SearchAction",
      "target": {
        "@type":     "EntryPoint",
        "urlTemplate": `${SITE_URL}/search.html?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    }
  });
}

// ============================================================
// 3. WEBPAGE SCHEMA (halaman listing)
// ============================================================

function injectWebPageSchema(title, description, url) {
  injectJsonLd("schema-webpage", {
    "@context":    "https://schema.org",
    "@type":       "WebPage",
    "name":        title || document.title,
    "description": description || SITE_DESC,
    "url":         url || getCurrentPageUrl(),
    "inLanguage":  SITE_LANG,
    "isPartOf": {
      "@type": "WebSite",
      "name":  SITE_NAME,
      "url":   SITE_URL,
    },
    "publisher": {
      "@type": "Organization",
      "name":  SITE_NAME,
      "url":   SITE_URL,
    }
  });
}

// ============================================================
// 4. BREADCRUMB SCHEMA (halaman listing)
// ============================================================

function injectBreadcrumbSchema(items) {
  // items: [{ name, url }]
  injectJsonLd("schema-breadcrumb", {
    "@context": "https://schema.org",
    "@type":    "BreadcrumbList",
    "itemListElement": items.map((item, i) => ({
      "@type":    "ListItem",
      "position": i + 1,
      "name":     item.name,
      "item":     item.url,
    }))
  });
}

// ============================================================
// 5. META TAG DEFAULTS (fallback jika belum diset)
// ============================================================

function injectDefaultMeta() {
  const title = document.title || SITE_NAME;
  const url   = getCurrentPageUrl();

  setMetaDefault("description",    SITE_DESC);
  setMetaDefault("robots",         "index, follow");
  setMetaDefault("og:site_name",   SITE_NAME,  true);
  setMetaDefault("og:locale",      "id_ID",    true);
  setMetaDefault("og:type",        "website",  true);
  setMetaDefault("og:title",       title,      true);
  setMetaDefault("og:description", SITE_DESC,  true);
  setMetaDefault("og:url",         url,        true);
  setMetaDefault("og:image",       SITE_LOGO,  true);
  setMetaDefault("twitter:card",   "summary_large_image");
  setMetaDefault("twitter:site",   "@revpeak"); // ganti username Twitter

  // Canonical default
  if (!document.querySelector("link[rel='canonical']")) {
    const el = document.createElement("link");
    el.rel  = "canonical";
    el.href = url;
    document.head.appendChild(el);
  }
}

// ============================================================
// 6. ROUTER — injeksi schema sesuai halaman
// ============================================================

function getPageName() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function initSEO() {
  injectDefaultMeta();
  injectOrganizationSchema();

  const page   = getPageName();
  const params = new URLSearchParams(window.location.search);

  if (page === "" || page === "index.html") {
    // Homepage
    injectWebSiteSchema();
    injectWebPageSchema(
      `${SITE_NAME} — Berita & Artikel Terkini`,
      SITE_DESC,
      SITE_URL
    );
    injectBreadcrumbSchema([
      { name: "Beranda", url: SITE_URL }
    ]);

  } else if (page === "berita.html") {
    injectWebPageSchema(
      `Berita Terkini — ${SITE_NAME}`,
      "Kumpulan berita terbaru seputar teknologi, bisnis, dan gaya hidup.",
      `${SITE_URL}/berita.html`
    );
    injectBreadcrumbSchema([
      { name: "Beranda",        url: SITE_URL },
      { name: "Berita Terkini", url: `${SITE_URL}/berita.html` }
    ]);

  } else if (page === "artikel.html") {
    injectWebPageSchema(
      `Artikel — ${SITE_NAME}`,
      "Kumpulan artikel informatif dan mendalam dari tim Revpeak.",
      `${SITE_URL}/artikel.html`
    );
    injectBreadcrumbSchema([
      { name: "Beranda", url: SITE_URL },
      { name: "Artikel", url: `${SITE_URL}/artikel.html` }
    ]);

  } else if (page === "kategori.html") {
    injectWebPageSchema(
      `Kategori — ${SITE_NAME}`,
      "Jelajahi semua kategori konten di Revpeak.",
      `${SITE_URL}/kategori.html`
    );
    injectBreadcrumbSchema([
      { name: "Beranda",  url: SITE_URL },
      { name: "Kategori", url: `${SITE_URL}/kategori.html` }
    ]);

  } else if (page === "kategori-detail.html") {
    const slug = params.get("slug") || "";
    const name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    injectBreadcrumbSchema([
      { name: "Beranda",  url: SITE_URL },
      { name: "Kategori", url: `${SITE_URL}/kategori.html` },
      { name: name,       url: `${SITE_URL}/kategori-detail.html?slug=${slug}` }
    ]);

  } else if (page === "penulis.html") {
    injectWebPageSchema(
      `Penulis — ${SITE_NAME}`,
      "Kenali para penulis dan editor di balik konten Revpeak.",
      `${SITE_URL}/penulis.html`
    );
    injectBreadcrumbSchema([
      { name: "Beranda", url: SITE_URL },
      { name: "Penulis", url: `${SITE_URL}/penulis.html` }
    ]);

  } else if (page === "penulis-detail.html") {
    const slug = params.get("slug") || "";
    const name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    injectBreadcrumbSchema([
      { name: "Beranda", url: SITE_URL },
      { name: "Penulis", url: `${SITE_URL}/penulis.html` },
      { name: name,      url: `${SITE_URL}/penulis-detail.html?slug=${slug}` }
    ]);

  } else if (page === "search.html") {
    const q = params.get("q") || "";
    injectWebPageSchema(
      q ? `Hasil pencarian: "${q}" — ${SITE_NAME}` : `Cari — ${SITE_NAME}`,
      `Hasil pencarian untuk "${q}" di ${SITE_NAME}.`,
      getCurrentPageUrl()
    );
    injectBreadcrumbSchema([
      { name: "Beranda", url: SITE_URL },
      { name: "Cari",    url: `${SITE_URL}/search.html` }
    ]);

  } else if (page === "tentang.html") {
    injectWebPageSchema(
      `Tentang Kami — ${SITE_NAME}`,
      `Pelajari lebih lanjut tentang ${SITE_NAME} dan misi kami.`,
      `${SITE_URL}/tentang.html`
    );
    injectBreadcrumbSchema([
      { name: "Beranda",    url: SITE_URL },
      { name: "Tentang Kami", url: `${SITE_URL}/tentang.html` }
    ]);

  } else if (page === "kontak.html") {
    injectWebPageSchema(
      `Kontak — ${SITE_NAME}`,
      `Hubungi tim ${SITE_NAME} untuk pertanyaan, saran, atau kerjasama.`,
      `${SITE_URL}/kontak.html`
    );
    injectBreadcrumbSchema([
      { name: "Beranda", url: SITE_URL },
      { name: "Kontak",  url: `${SITE_URL}/kontak.html` }
    ]);
  }

  // article.html ditangani sepenuhnya oleh article.js — skip di sini
}

// ============================================================
// 7. SITEMAP PING (setelah konten baru dipublish)
// Panggil dari admin.js setelah POST/PATCH artikel berstatus published
// Contoh: pingSearchEngines();
// ============================================================

export async function pingSearchEngines() {
  const sitemapUrl = encodeURIComponent(`${SITE_URL}/sitemap.xml`);
  const engines = [
    `https://www.google.com/ping?sitemap=${sitemapUrl}`,
    `https://www.bing.com/ping?sitemap=${sitemapUrl}`,
  ];
  await Promise.allSettled(engines.map(url => fetch(url, { mode: "no-cors" })));
}

// ============================================================
// INIT
// ============================================================

document.addEventListener("DOMContentLoaded", initSEO);
