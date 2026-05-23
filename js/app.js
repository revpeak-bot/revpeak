// ============================================================
// REVPEAK — app.js
// Menangani: index.html, berita.html, artikel.html,
//            kategori.html, /kategori/:slug,
//            penulis.html, /penulis/:slug, search.html
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

// Baca slug dari path clean URL (mis. /kategori/teknologi → "teknologi")
// atau fallback ke query param ?slug= untuk backward compatibility
function getSlugFromPath(segmentIndex = 2) {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[segmentIndex - 1] || getParam("slug");
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
  const cat    = article.categories || {};
  const author = article.authors    || {};
  const badge      = article.post_type === "news" ? "Berita" : "Artikel";
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
        ${cat.slug
          ? `<a href="/kategori/${escapeHtml(cat.slug)}" class="card-category">${escapeHtml(cat.name)}</a>`
          : ""}
        <h2 class="card-title">
          <a href="/${escapeHtml(article.slug)}">${escapeHtml(article.title)}</a>
        </h2>
        ${article.excerpt ? `<p class="card-excerpt">${escapeHtml(article.excerpt)}</p>` : ""}
        <div class="card-meta">
          ${author.name ? `<span class="card-author">${escapeHtml(author.name)}</span>` : ""}
          <span class="card-date">${formatDate(article.published_at)}</span>
          ${article.reading_time
            ? `<span class="card-reading-time" aria-label="${article.reading_time} menit baca">⏱ ${article.reading_time}m</span>`
            : ""}
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
  const grid         = $("#articles-grid");
  const heroTitle    = $(".hero-title");
  const heroBadge    = $(".hero-badge");
  const tabs         = $$("[data-tab]");
  const paginationEl = $("#pagination");
  if (!grid) return;

  const TAB_KEY   = "rp_active_tab";
  let currentTab  = sessionStorage.getItem(TAB_KEY) || "rekomendasi";
  let currentPage = 1;
  let totalCount  = 0;
  let isLoading   = false;
  const limit     = 9;

  const tabConfig = {
    rekomendasi: { sort: "popular", type: null, label: "Rekomendasi", badge: "Pilihan Editor" },
    trending:    { sort: "popular", type: null, label: "Trending",    badge: "Sedang Viral" },
    terbaru:     { sort: "latest",  type: null, label: "Terbaru",     badge: "Baru Diterbitkan" },
  };

  // ── Rekomendasi: ambil artikel populer, acak per sesi ────
  async function getRekomendasiArticles(page) {
    const cacheKey = "rp_rek_pool";
    let pool = null;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) pool = JSON.parse(raw);
    } catch {}
    if (!pool) {
      // Ambil 99 artikel populer agar tersedia banyak halaman
      const res = await apiFetch(`/api/articles?sort=popular&page=1&limit=99`);
      pool = res.data || [];
      // Fisher-Yates shuffle — urutan berbeda tiap kunjungan
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      try { sessionStorage.setItem(cacheKey, JSON.stringify(pool)); } catch {}
    }
    const start = (page - 1) * limit;
    return { data: pool.slice(start, start + limit), total: pool.length };
  }

  // ── Trending: pool besar + boost konten lama dibaca ──────
  async function getTrendingArticles(page) {
    const cacheKey = "rp_trend_pool";
    let pool = null;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) pool = JSON.parse(raw);
    } catch {}
    if (!pool) {
      // Ambil 99 artikel populer lalu urutkan ulang dengan sinyal waktu baca
      const res = await apiFetch(`/api/articles?sort=popular&page=1&limit=99`);
      pool = res.data || [];
      try {
        const timeData = JSON.parse(localStorage.getItem("rp_time_spent") || "{}");
        if (Object.keys(timeData).length > 0) {
          const maxTime = Math.max(...Object.values(timeData), 1);
          pool.sort((a, b) => {
            const sa = (a.view_count || 0) + ((timeData[a.slug] || 0) / maxTime) * 50;
            const sb = (b.view_count || 0) + ((timeData[b.slug] || 0) / maxTime) * 50;
            return sb - sa;
          });
        }
      } catch {}
      try { sessionStorage.setItem(cacheKey, JSON.stringify(pool)); } catch {}
    }
    const start = (page - 1) * limit;
    return { data: pool.slice(start, start + limit), total: pool.length };
  }

  // ── Tombol navigasi < > ───────────────────────────────────
  function renderNavButtons() {
    if (!paginationEl) return;
    const totalPages = Math.ceil(totalCount / limit);
    if (totalPages <= 1) { paginationEl.innerHTML = ""; return; }
    paginationEl.innerHTML = `
      <div class="content-nav-wrap">
        <button class="content-nav-btn" id="hp-prev-btn"
          ${currentPage <= 1 ? "disabled" : ""}
          aria-label="Halaman sebelumnya">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
          Sebelumnya
        </button>
        <span class="content-nav-info" aria-label="Halaman ${currentPage} dari ${totalPages}">${currentPage} / ${totalPages}</span>
        <button class="content-nav-btn" id="hp-next-btn"
          ${currentPage >= totalPages ? "disabled" : ""}
          aria-label="Halaman berikutnya">
          Berikutnya
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      </div>`;
    document.getElementById("hp-prev-btn")?.addEventListener("click", () => {
      if (currentPage > 1 && !isLoading) {
        currentPage--;
        loadContent();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
    document.getElementById("hp-next-btn")?.addEventListener("click", () => {
      if (currentPage < Math.ceil(totalCount / limit) && !isLoading) {
        currentPage++;
        loadContent();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  // ── Muat konten sesuai tab & halaman aktif ────────────────
  async function loadContent() {
    if (isLoading) return;
    isLoading = true;
    const cfg = tabConfig[currentTab];
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";
    if (heroTitle) heroTitle.textContent = cfg.label;
    if (heroBadge) heroBadge.textContent  = cfg.badge;
    try {
      let res;
      if (currentTab === "rekomendasi") {
        res = await getRekomendasiArticles(currentPage);
      } else if (currentTab === "trending") {
        res = await getTrendingArticles(currentPage);
      } else {
        let url = `/api/articles?sort=${cfg.sort}&page=${currentPage}&limit=${limit}`;
        if (cfg.type) url += `&type=${cfg.type}`;
        res = await apiFetch(url);
      }
      const articles = res.data || [];
      // Fallback: jika total dari server tidak akurat (= jumlah per halaman),
      // dan halaman penuh terisi, asumsikan masih ada halaman berikutnya
      const serverTotal = res.total || 0;
      totalCount = (serverTotal <= limit && articles.length === limit)
        ? currentPage * limit + limit  // paksa muncul tombol "Berikutnya"
        : serverTotal;
      if (!articles.length) { grid.innerHTML = renderEmpty("Belum ada konten."); grid.setAttribute("aria-busy", "false"); isLoading = false; return; }
      grid.innerHTML = articles.map(renderCard).join("");
      grid.setAttribute("aria-busy", "false");
      renderNavButtons();
    } catch {
      grid.innerHTML = renderError();
      grid.setAttribute("aria-busy", "false");
    }
    isLoading = false;
  }

  // ── Ganti tab ─────────────────────────────────────────────
  async function loadTab(tab) {
    if (isLoading) return;
    currentTab  = tab;
    currentPage = 1;
    tabs.forEach(t => {
      t.classList.toggle("active", t.dataset.tab === tab);
      t.setAttribute("aria-selected", t.dataset.tab === tab);
    });
    await loadContent();
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
      // Simpan tab aktif agar tetap saat refresh
      try { sessionStorage.setItem(TAB_KEY, tab.dataset.tab); } catch {}
      // Acak ulang rekomendasi tiap kali tab diklik
      if (tab.dataset.tab === "rekomendasi") {
        try { sessionStorage.removeItem("rp_rek_pool"); } catch {}
      }
      // Refresh pool trending agar sinyal waktu baca terbaru dipakai
      if (tab.dataset.tab === "trending") {
        try { sessionStorage.removeItem("rp_trend_pool"); } catch {}
      }
      loadTab(tab.dataset.tab);
    });
  });

  await loadSidebarTrending();
  loadTab(currentTab);
}

// ============================================================
// PAGE: BERITA
// ============================================================

async function initBeritaPage() {
  const grid         = $("#articles-grid");
  const paginationEl = $("#pagination");
  const pageTitle    = $(".page-title");
  if (!grid) return;

  if (pageTitle) pageTitle.textContent = "Berita Terkini";

  let currentPage = parseInt(getParam("page")) || 1;
  const limit = 12;

  async function loadBerita(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    try {
      const res      = await apiFetch(`/api/articles?type=news&sort=latest&page=${page}&limit=${limit}`);
      const articles = res.data || [];

      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Belum ada berita.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => { window.scrollTo({ top: 0, behavior: "smooth" }); loadBerita(p); }
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
  const grid         = $("#articles-grid");
  const paginationEl = $("#pagination");
  const pageTitle    = $(".page-title");
  if (!grid) return;

  if (pageTitle) pageTitle.textContent = "Semua Artikel";

  let currentPage = parseInt(getParam("page")) || 1;
  const limit = 12;

  async function loadArtikel(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    try {
      const res      = await apiFetch(`/api/articles?type=article&sort=latest&page=${page}&limit=${limit}`);
      const articles = res.data || [];

      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Belum ada artikel.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => { window.scrollTo({ top: 0, behavior: "smooth" }); loadArtikel(p); }
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

    // Tautan sudah pakai clean URL /kategori/:slug
    grid.innerHTML = categories.map(cat => `
      <a href="/kategori/${escapeHtml(cat.slug)}" class="category-card">
        <h2 class="category-card-name">${escapeHtml(cat.name)}</h2>
        ${cat.description ? `<p class="category-card-desc">${escapeHtml(cat.description)}</p>` : ""}
      </a>`).join("");
  } catch {
    grid.innerHTML = renderError();
  }
}

// ============================================================
// PAGE: KATEGORI DETAIL  (/kategori/:slug)
// ============================================================

async function initKategoriDetailPage() {
  // Baca slug dari path baru (/kategori/teknologi) atau query param lama (?slug=teknologi)
  const slug         = getSlugFromPath(2);
  const grid         = $("#articles-grid");
  const paginationEl = $("#pagination");
  const titleEl      = $(".page-title");
  const descEl       = $(".page-description");
  const breadcrumb   = $("#breadcrumb-current");
  if (!grid || !slug) return;

  let currentPage = parseInt(getParam("page")) || 1;
  const limit = 12;

  // Ambil type dari query param (untuk filter chip)
  function getActiveType() {
    return new URLSearchParams(window.location.search).get("type") || "";
  }

  async function loadKategori(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    const type = getActiveType();
    let apiUrl = `/api/categories/${encodeURIComponent(slug)}?page=${page}&limit=${limit}`;
    if (type) apiUrl += `&type=${type}`;

    try {
      const res = await apiFetch(apiUrl);

      if (titleEl) titleEl.textContent = res.category?.name || slug;
      if (descEl && res.category?.description) descEl.textContent = res.category.description;
      if (breadcrumb) breadcrumb.textContent = res.category?.name || slug;

      document.title = `${res.category?.name || slug} — Kategori — Revpeak`;

      const articles = res.data || [];
      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Belum ada konten dalam kategori ini.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => { window.scrollTo({ top: 0, behavior: "smooth" }); loadKategori(p); }
      });
    } catch {
      grid.innerHTML = renderError();
    }
  }

  // Re-load saat filter chip berubah
  window.addEventListener("filterchange", () => loadKategori(1));

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

    // Tautan sudah pakai clean URL /penulis/:slug
    grid.innerHTML = authors.map(author => `
      <a href="/penulis/${escapeHtml(author.slug)}" class="author-card">
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
// PAGE: PENULIS DETAIL  (/penulis/:slug)
// ============================================================

async function initPenulisDetailPage() {
  // Baca slug dari path baru (/penulis/john) atau query param lama (?slug=john)
  const slug         = getSlugFromPath(2);
  const grid         = $("#articles-grid");
  const paginationEl = $("#pagination");
  const nameEl       = $(".author-name");
  const bioEl        = $(".author-bio");
  const avatarEl     = $(".author-avatar");
  const breadcrumb   = $("#breadcrumb-name");
  if (!grid || !slug) return;

  let currentPage = 1;
  const limit = 12;

  async function loadPenulis(page = 1) {
    currentPage = page;
    grid.innerHTML = renderCardSkeleton(limit);
    if (paginationEl) paginationEl.innerHTML = "";

    try {
      const res = await apiFetch(`/api/authors/${encodeURIComponent(slug)}?page=${page}&limit=${limit}`);

      if (nameEl)      nameEl.textContent   = res.author?.name || slug;
      if (bioEl && res.author?.bio) bioEl.textContent = res.author.bio;
      if (breadcrumb)  breadcrumb.textContent = res.author?.name || slug;
      if (avatarEl && res.author?.avatar_url) {
        avatarEl.src = res.author.avatar_url;
        avatarEl.alt = res.author.name;
        avatarEl.style.display = "";
        const fallback = document.getElementById("author-avatar-fallback");
        if (fallback) fallback.style.display = "none";
      }

      document.title = `${res.author?.name || slug} — Penulis — Revpeak`;

      const articles = res.data || [];
      grid.innerHTML = articles.length
        ? articles.map(renderCard).join("")
        : renderEmpty("Penulis ini belum memiliki artikel.");

      renderPagination(paginationEl, {
        page, limit, total: res.total,
        onPageChange: (p) => { window.scrollTo({ top: 0, behavior: "smooth" }); loadPenulis(p); }
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
  const grid    = $("#articles-grid");
  const input   = $("#search-input");
  const form    = $("#search-form");
  const queryEl = $(".search-query-label");
  if (!grid) return;

  const q = getParam("q");
  if (input)           input.value   = q;
  if (queryEl && q)    queryEl.textContent = `Hasil pencarian: "${q}"`;

  if (!q.trim()) {
    grid.innerHTML = renderEmpty("Masukkan kata kunci untuk mencari.");
    return;
  }

  grid.innerHTML = renderCardSkeleton(6);

  try {
    const res      = await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
    const articles = res.data || [];

    if (queryEl) queryEl.textContent = `Ditemukan ${articles.length} hasil untuk "${q}"`;

    grid.innerHTML = articles.length
      ? articles.map(renderCard).join("")
      : renderEmpty(`Tidak ada hasil untuk "${q}".`);
  } catch {
    grid.innerHTML = renderError();
  }

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
// GLOBAL: DRAWER / HAMBURGER MENU
// ============================================================

function initDrawer() {
  const hamburger = $("#hamburger");
  const drawer    = $("#drawer");
  const overlay   = $("#drawer-overlay");
  const closeBtn  = $("#drawer-close");
  if (!hamburger || !drawer) return;

  function openDrawer() {
    drawer.classList.add("open");
    if (overlay) overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    hamburger.setAttribute("aria-expanded", "true");
    hamburger.classList.add("open");
  }

  function closeDrawer() {
    drawer.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
    document.body.style.overflow = "";
    hamburger.setAttribute("aria-expanded", "false");
    hamburger.classList.remove("open");
  }

  hamburger.addEventListener("click", () => {
    drawer.classList.contains("open") ? closeDrawer() : openDrawer();
  });

  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);
  if (overlay)  overlay.addEventListener("click", closeDrawer);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
  });

  $$(".drawer-link", drawer).forEach(link => {
    link.addEventListener("click", closeDrawer);
  });
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
// GLOBAL: TIME-ON-PAGE TRACKING (untuk sinyal Trending)
// ============================================================

function initTimeTracking() {
  const path = window.location.pathname;
  // Hanya lacak halaman artikel/review (bukan homepage, .html, kategori, penulis)
  if (
    path === "/" ||
    path === "/index.html" ||
    path.endsWith(".html") ||
    path.startsWith("/kategori/") ||
    path.startsWith("/penulis/") ||
    path === ""
  ) return;

  const slug = path.replace(/^\//, "").split("/")[0];
  if (!slug) return;

  const startTime = Date.now();
  let recorded    = false;

  function recordTime() {
    if (recorded) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000); // detik
    if (elapsed < 10) return; // abaikan kunjungan < 10 detik
    recorded = true;
    try {
      const key  = "rp_time_spent";
      const data = JSON.parse(localStorage.getItem(key) || "{}");
      data[slug] = (data[slug] || 0) + elapsed;
      // Simpan maks 200 entri teratas berdasarkan total waktu
      const entries = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 200);
      localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
    } catch {}
  }

  window.addEventListener("beforeunload", recordTime);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) recordTime();
  });
}

// ============================================================
// ROUTER — deteksi halaman dan jalankan init yang sesuai
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  initTimeTracking();
  initDrawer();
  initHeaderSearch();
  initNavActiveState();

  const path = window.location.pathname;

  // Halaman statis — deteksi berdasarkan nama file atau path persis
  if (path === "/" || path === "/index.html")    return initHomepage();
  if (path === "/berita.html")                   return initBeritaPage();
  if (path === "/artikel.html")                  return initArtikelPage();
  if (path === "/kategori.html")                 return initKategoriPage();
  if (path === "/penulis.html")                  return initPenulisPage();
  if (path === "/search.html")                   return initSearchPage();

  // Clean URL — deteksi berdasarkan prefix path
  if (path.startsWith("/kategori/"))             return initKategoriDetailPage();
  if (path.startsWith("/penulis/"))              return initPenulisDetailPage();

  // Backward compatibility — URL lama dengan query param
  // (Worker sudah redirect 301, tapi ini fallback kalau JS jalan duluan)
  if (path === "/kategori-detail.html")          return initKategoriDetailPage();
  if (path === "/penulis-detail.html")           return initPenulisDetailPage();
});
