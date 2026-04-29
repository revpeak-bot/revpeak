// ============================================================
// REVPEAK — app.js
// Menangani: index.html, berita.html, artikel.html,
//            kategori.html, kategori-detail.html,
//            penulis.html, penulis-detail.html, search.html
// ============================================================

const API_BASE = "https://revpeak-api.revpeak2.workers.dev"; // ganti dengan URL Worker Anda

// ============================================================
// UTILS
// ============================================================

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function getParam(key) {
  return new URLSearchParams(window.location.search).get(key) || "";
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function apiFetch(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ============================================================
// CARD RENDERER
// ============================================================

function renderCard(article) {
  const cat = article.categories || {};
  const author = article.authors || {};
  const badge = article.post_type === "news" ? "Berita" : "Artikel";
  const badgeClass = article.post_type === "news" ? "badge-news" : "badge-article";

  return `
    <article class="card" role="article">
      <a href="/${escapeHtml(article.slug)}" class="card-thumbnail-link" aria-label="${escapeHtml(article.title)}">
        <div class="card-thumbnail">
          ${article.thumbnail_url
            ? `<img src="${escapeHtml(article.thumbnail_url)}" alt="${escapeHtml(article.title)}" loading="lazy">`
            : `<div class="card-thumbnail-placeholder" aria-hidden="true"></div>`}
          <span class="card-badge ${badgeClass}">${badge}</span>
        </div>
      </a>
      <div class="card-body">
        ${cat.slug ? `<a href="/kategori-detail.html?slug=${escapeHtml(cat.slug)}" class="card-category">${escapeHtml(cat.name)}</a>` : ""}
        <h2 class="card-title">
          <a href="/${escapeHtml(article.slug)}">${escapeHtml(article.title)}</a>
        </h2>
        ${article.excerpt ? `<p class="card-excerpt">${escapeHtml(article.excerpt)}</p>` : ""}
        <div class="card-meta">
          ${author.name ? `<span class="card-author">${escapeHtml(author.name)}</span>` : ""}
          <span class="card-date">${formatDate(article.published_at)}</span>
          <span class="card-views" aria-label="${article.view_count || 0} kali dibaca">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            ${article.view_count || 0}
          </span>
        </div>
      </div>
    </article>`;
}

function renderCardSkeleton(count = 6) {
  return Array(count).fill(0).map(() => `
    <div class="card card-skeleton" aria-hidden="true">
      <div class="card-thumbnail skeleton-box"></div>
      <div class="card-body">
        <div class="skeleton-line short"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line medium"></div>
      </div>
    </div>`).join("");
}

function renderEmpty(msg = "Tidak ada konten ditemukan.") {
  return `<div class="empty-state" role="status"><p>${escapeHtml(msg)}</p></div>`;
}

function renderError(msg = "Gagal memuat data. Silakan coba lagi.") {
  return `<div class="error-state" role="alert"><p>${escapeHtml(msg)}</p></div>`;
}

// ============================================================
// PAGINATION
// ============================================================

function renderPagination(container, { page, limit, total, onPageChange }) {
  if (!container) return;
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) { container.innerHTML = ""; return; }

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 || i === totalPages ||
      (i >= page - 1 && i <= page + 1)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  container.innerHTML = `
    <nav class="pagination" aria-label="Navigasi halaman">
      <button class="pagination-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""} aria-label="Halaman sebelumnya">
        &laquo;
      </button>
      ${pages.map(p => p === "..."
        ? `<span class="pagination-ellipsis">…</span>`
        : `<button class="pagination-btn ${p === page ? "active" : ""}" data-page="${p}" aria-label="Halaman ${p}" aria-current="${p === page ? "page" : "false"}">${p}</button>`
      ).join("")}
      <button class="pagination-btn" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""} aria-label="Halaman berikutnya">
        &raquo;
      </button>
    </nav>`;

  container.querySelectorAll(".pagination-btn:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = parseInt(btn.dataset.page);
      if (p >= 1 && p <= totalPages) onPageChange(p);
    });
  });
}

// ============================================================
// PAGE: INDEX (Homepage)
// ============================================================

async function initHomepage() {
  const grid        = $("#articles-grid");
  const heroTitle   = $(".hero-title");
  const heroBadge   = $(".hero-badge");
  const tabs        = $$("[data-tab]");
  const paginationEl = $("#pagination");
  if (!grid) return;

  let currentTab  = "terbaru";
  let currentPage = 1;
  const limit     = 9;

  const tabConfig = {
    rekomendasi: { sort: "popular",  type: null,    label: "Rekomendasi",  badge: "Pilihan Editor" },
    trending:    { sort: "popular",  type: null,    label: "Trending",     badge: "Sedang Viral" },
    terbaru:     { sort: "latest",   type: null,    label: "Terbaru",      badge: "Baru Diterbitkan" },
  };

  async function loadTab(tab, page = 1) {
    currentTab  = tab;
    currentPage = page;
    const cfg   = tabConfig[tab];

    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    // Update hero
    if (heroTitle) heroTitle.textContent = cfg.label;
    if (heroBadge) heroBadge.textContent = cfg.badge;

    // Update active tab
    tabs.forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tab);
      t.setAttribute("aria-selected", t.dataset.tab === tab);
    });

    try {
      let url = `/api/articles?sort=${cfg.sort}&page=${page}&limit=${limit}`;
      if (cfg.type) url += `&type=${cfg.type}`;
      const res = await apiFetch(url);
      const articles = res.data || [];

      if (!articles.length) {
        grid.innerHTML = renderEmpty("Belum ada konten.");
        return;
      }

      grid.innerHTML = articles.map(renderCard).join("");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          loadTab(currentTab, p);
        }
      });
    } catch (e) {
      grid.innerHTML = renderError();
    }
  }

  // Tab click
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      loadTab(tab.dataset.tab, 1);
    });
  });

  // Sidebar trending
  await loadSidebarTrending();

  // Initial load
  loadTab(currentTab, 1);
}

// ============================================================
// PAGE: BERITA
// ============================================================

async function initBeritaPage() {
  const grid        = $("#articles-grid");
  const paginationEl = $("#pagination");
  const pageTitle   = $(".page-title");
  if (!grid) return;

  if (pageTitle) pageTitle.textContent = "Berita Terkini";

  let currentPage = parseInt(getParam("page")) || 1;
  const limit = 12;

  async function loadBerita(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    try {
      const res = await apiFetch(`/api/articles?type=news&sort=latest&page=${page}&limit=${limit}`);
      const articles = res.data || [];

      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Belum ada berita.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          loadBerita(p);
        }
      });
    } catch {
      grid.innerHTML = renderError();
    }
  }

  await loadSidebarTrending("news");
  loadBerita(currentPage);
}

// ============================================================
// PAGE: ARTIKEL
// ============================================================

async function initArtikelPage() {
  const grid        = $("#articles-grid");
  const paginationEl = $("#pagination");
  const pageTitle   = $(".page-title");
  if (!grid) return;

  if (pageTitle) pageTitle.textContent = "Semua Artikel";

  let currentPage = parseInt(getParam("page")) || 1;
  const limit = 12;

  async function loadArtikel(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    try {
      const res = await apiFetch(`/api/articles?type=article&sort=latest&page=${page}&limit=${limit}`);
      const articles = res.data || [];

      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Belum ada artikel.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          loadArtikel(p);
        }
      });
    } catch {
      grid.innerHTML = renderError();
    }
  }

  await loadSidebarTrending("article");
  loadArtikel(currentPage);
}

// ============================================================
// PAGE: KATEGORI (list semua kategori)
// ============================================================

async function initKategoriPage() {
  const grid = $("#categories-grid");
  if (!grid) return;

  grid.innerHTML = `<div class="skeleton-line" aria-hidden="true"></div>`;

  try {
    const categories = await apiFetch("/api/categories");

    if (!categories.length) {
      grid.innerHTML = renderEmpty("Belum ada kategori.");
      return;
    }

    grid.innerHTML = categories.map(cat => `
      <a href="/kategori-detail.html?slug=${escapeHtml(cat.slug)}" class="category-card">
        <h2 class="category-card-name">${escapeHtml(cat.name)}</h2>
        ${cat.description ? `<p class="category-card-desc">${escapeHtml(cat.description)}</p>` : ""}
      </a>`).join("");
  } catch {
    grid.innerHTML = renderError();
  }
}

// ============================================================
// PAGE: KATEGORI DETAIL
// ============================================================

async function initKategoriDetailPage() {
  const slug        = getParam("slug");
  const grid        = $("#articles-grid");
  const paginationEl = $("#pagination");
  const titleEl     = $(".page-title");
  const descEl      = $(".page-description");
  if (!grid || !slug) return;

  let currentPage = parseInt(getParam("page")) || 1;
  const limit = 12;

  async function loadKategori(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    try {
      const res = await apiFetch(`/api/categories/${encodeURIComponent(slug)}?page=${page}&limit=${limit}`);

      if (titleEl) titleEl.textContent = res.category?.name || slug;
      if (descEl && res.category?.description) descEl.textContent = res.category.description;

      // Update page title & meta
      document.title = `${res.category?.name || slug} — Revpeak`;

      const articles = res.data || [];
      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Belum ada konten dalam kategori ini.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          loadKategori(p);
        }
      });
    } catch {
      grid.innerHTML = renderError();
    }
  }

  loadKategori(currentPage);
}

// ============================================================
// PAGE: PENULIS (list semua penulis)
// ============================================================

async function initPenulisPage() {
  const grid = $("#authors-grid");
  if (!grid) return;

  grid.innerHTML = `<div class="skeleton-line" aria-hidden="true"></div>`;

  try {
    const authors = await apiFetch("/api/authors");

    if (!authors.length) {
      grid.innerHTML = renderEmpty("Belum ada penulis.");
      return;
    }

    grid.innerHTML = authors.map(author => `
      <a href="/penulis-detail.html?slug=${escapeHtml(author.slug)}" class="author-card">
        <div class="author-card-avatar">
          ${author.avatar_url
            ? `<img src="${escapeHtml(author.avatar_url)}" alt="${escapeHtml(author.name)}" loading="lazy">`
            : `<div class="author-avatar-placeholder" aria-hidden="true">${escapeHtml(author.name.charAt(0).toUpperCase())}</div>`}
        </div>
        <div class="author-card-info">
          <h2 class="author-card-name">${escapeHtml(author.name)}</h2>
          ${author.bio ? `<p class="author-card-bio">${escapeHtml(author.bio)}</p>` : ""}
        </div>
      </a>`).join("");
  } catch {
    grid.innerHTML = renderError();
  }
}

// ============================================================
// PAGE: PENULIS DETAIL
// ============================================================

async function initPenulisDetailPage() {
  const slug        = getParam("slug");
  const grid        = $("#articles-grid");
  const paginationEl = $("#pagination");
  const nameEl      = $(".author-name");
  const bioEl       = $(".author-bio");
  const avatarEl    = $(".author-avatar");
  if (!grid || !slug) return;

  let currentPage = 1;
  const limit = 12;

  async function loadPenulis(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    try {
      const res = await apiFetch(`/api/authors/${encodeURIComponent(slug)}?page=${page}&limit=${limit}`);

      if (nameEl) nameEl.textContent = res.author?.name || slug;
      if (bioEl && res.author?.bio) bioEl.textContent = res.author.bio;
      if (avatarEl && res.author?.avatar_url) {
        avatarEl.src = res.author.avatar_url;
        avatarEl.alt = res.author.name;
      }

      document.title = `${res.author?.name || slug} — Revpeak`;

      const articles = res.data || [];
      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Penulis ini belum memiliki artikel.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => {
          window.scrollTo({ top: 0, behavior: "smooth" });
          loadPenulis(p);
        }
      });
    } catch {
      grid.innerHTML = renderError();
    }
  }

  loadPenulis(currentPage);
}

// ============================================================
// PAGE: SEARCH
// ============================================================

async function initSearchPage() {
  const grid     = $("#articles-grid");
  const input    = $("#search-input");
  const form     = $("#search-form");
  const queryEl  = $(".search-query-label");
  if (!grid) return;

  const q = getParam("q");

  if (input) input.value = q;
  if (queryEl && q) queryEl.textContent = `Hasil pencarian: "${q}"`;

  if (!q.trim()) {
    grid.innerHTML = renderEmpty("Masukkan kata kunci untuk mencari.");
    return;
  }

  grid.innerHTML = renderCardSkeleton(6);

  try {
    const res = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    const articles = res.data || [];

    if (queryEl) queryEl.textContent = `Ditemukan ${articles.length} hasil untuk "${q}"`;

    grid.innerHTML = articles.length
      ? articles.map(renderCard).join("")
      : renderEmpty(`Tidak ada hasil untuk "${q}".`);
  } catch {
    grid.innerHTML = renderError();
  }

  // Search form submit
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const val = (input?.value || "").trim();
      if (val) window.location.href = `/search.html?q=${encodeURIComponent(val)}`;
    });
  }
}

// ============================================================
// SIDEBAR: TRENDING
// ============================================================

async function loadSidebarTrending(type = null) {
  const sidebar = $("#sidebar-trending");
  if (!sidebar) return;

  try {
    let url = "/api/trending?limit=5";
    if (type) url += `&type=${type}`;
    const articles = await apiFetch(url);

    if (!articles.length) { sidebar.innerHTML = ""; return; }

    sidebar.innerHTML = `
      <h3 class="sidebar-title">Trending</h3>
      <ol class="trending-list">
        ${articles.map((a, i) => `
          <li class="trending-item">
            <span class="trending-number" aria-hidden="true">${i + 1}</span>
            <a href="/${escapeHtml(a.slug)}" class="trending-title">${escapeHtml(a.title)}</a>
          </li>`).join("")}
      </ol>`;
  } catch {
    sidebar.innerHTML = "";
  }
}

// ============================================================
// GLOBAL: SEARCH BAR (header)
// ============================================================

function initHeaderSearch() {
  const form  = $("#header-search-form");
  const input = $("#header-search-input");
  if (!form || !input) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = input.value.trim();
    if (val) window.location.href = `/search.html?q=${encodeURIComponent(val)}`;
  });
}

// ============================================================
// GLOBAL: NAVIGATION ACTIVE STATE
// ============================================================

function initNavActiveState() {
  const path = window.location.pathname;
  $$("nav a[href]").forEach(link => {
    try {
      const linkPath = new URL(link.href, window.location.origin).pathname;
      link.classList.toggle("active", linkPath === path);
      link.setAttribute("aria-current", linkPath === path ? "page" : "false");
    } catch {}
  });
}

// ============================================================
// ROUTER — deteksi halaman dan jalankan init yang sesuai
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  initHeaderSearch();
  initNavActiveState();

  const path = window.location.pathname;
  const page = path.split("/").pop() || "index.html";

  if (page === "" || page === "index.html")              initHomepage();
  else if (page === "berita.html")                       initBeritaPage();
  else if (page === "artikel.html")                      initArtikelPage();
  else if (page === "kategori.html")                     initKategoriPage();
  else if (page === "kategori-detail.html")              initKategoriDetailPage();
  else if (page === "penulis.html")                      initPenulisPage();
  else if (page === "penulis-detail.html")               initPenulisDetailPage();
  else if (page === "search.html")                       initSearchPage();
});
