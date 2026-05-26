// ============================================================
// REVPEAK — perpustakaan.js
// Menangani: perpustakaan.html
// Dimuat bersama app.js (app.js menangani drawer, header search,
// nav active state, theme). File ini hanya menangani logika
// halaman perpustakaan.
// ============================================================

(function () {
  "use strict";

  // ── Gunakan API_BASE yang sama dengan app.js ─────────────────
  // Dibaca setelah app.js di-load (var API_BASE sudah tersedia)
  function getApiBase() {
    return (typeof API_BASE !== "undefined" ? API_BASE : "");
  }

  // ──────────────────────────────────────────────────────────────
  // CONSTANTS
  // ──────────────────────────────────────────────────────────────
  const BOOKS_PER_PAGE   = 18;
  const SEARCH_DEBOUNCE  = 350;
  const COVER_FALLBACK   = "https://placehold.co/270x480/EFECE6/6B6560?text=No+Cover";
  const BOOK_PATH        = "/buku/";
  const BOOKMARK_KEY     = "rp_bookmarks_books";

  // ──────────────────────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────────────────────
  const state = {
    books    : [],
    total    : 0,
    genres   : [],
    genre    : "",        // slug genre aktif
    query    : "",
    sort     : "latest",
    format   : "",
    page     : 1,
    viewMode : "grid",
    bookmarks: [],
    loading  : false,
  };

  // ──────────────────────────────────────────────────────────────
  // UTILS (lokal, tidak bertabrakan dengan app.js)
  // ──────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtViews(n) {
    const num = Number(n) || 0;
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(".0", "") + " jt";
    if (num >= 1_000)     return (num / 1_000).toFixed(1).replace(".0", "")     + " rb";
    return String(num);
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
    if (bytes >= 1_024)     return Math.round(bytes / 1_024)       + " KB";
    return bytes + " B";
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function animCount(el, target) {
    if (!el) return;
    const step  = Math.max(1, Math.round(target / 40));
    let   cur   = 0;
    const timer = setInterval(() => {
      cur = Math.min(cur + step, target);
      el.textContent = cur >= 1000
        ? fmtViews(cur)
        : cur.toLocaleString("id-ID");
      if (cur >= target) clearInterval(timer);
    }, 25);
  }

  // ──────────────────────────────────────────────────────────────
  // BOOKMARK
  // ──────────────────────────────────────────────────────────────
  function loadBookmarks() {
    try { state.bookmarks = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]"); }
    catch { state.bookmarks = []; }
  }

  function saveBookmarks() {
    try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(state.bookmarks)); }
    catch {}
  }

  function toggleBookmark(id) {
    const idx = state.bookmarks.indexOf(id);
    if (idx === -1) state.bookmarks.push(id);
    else state.bookmarks.splice(idx, 1);
    saveBookmarks();
    renderGrid();
  }

  // ──────────────────────────────────────────────────────────────
  // API
  // ──────────────────────────────────────────────────────────────
  async function apiFetchLib(path) {
    const res = await fetch(getApiBase() + path);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  async function fetchGenres() {
    try {
      const data   = await apiFetchLib("/api/book-genres");
      state.genres = Array.isArray(data) ? data : [];
    } catch {
      state.genres = [];
    }
    renderGenreBar();
  }

  async function fetchBooks() {
    if (state.loading) return;
    state.loading = true;

    const params = new URLSearchParams({
      page  : state.page,
      limit : BOOKS_PER_PAGE,
      sort  : state.sort,
    });
    if (state.genre)  params.set("genre",  state.genre);
    if (state.query)  params.set("q",      state.query);
    if (state.format) params.set("format", state.format);

    try {
      const res    = await apiFetchLib(`/api/books?${params}`);
      state.books  = res.data  || [];
      state.total  = res.total || 0;
    } catch {
      renderError();
      state.loading = false;
      return;
    }

    state.loading = false;
    renderGrid();
    renderPaginationLib();
    updateCount();
  }

  async function fetchStats() {
    try {
      const res = await apiFetchLib("/api/books/stats");
      animCount(document.getElementById("stat-total"),  res.total  || 0);
      animCount(document.getElementById("stat-views"),  res.views  || 0);
      animCount(document.getElementById("stat-genres"), res.genres || 0);
    } catch {
      ["stat-total","stat-views","stat-genres"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "0";
      });
    }
  }

  function trackView(slug) {
    fetch(`${getApiBase()}/api/views/book/${slug}`, { method: "POST" }).catch(() => {});
  }

  function trackDownload(slug) {
    fetch(`${getApiBase()}/api/downloads/book/${slug}`, { method: "POST" }).catch(() => {});
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: GENRE BAR
  // ──────────────────────────────────────────────────────────────
  function renderGenreBar() {
    const bar    = document.getElementById("lib-genre-bar");
    if (!bar) return;
    const genres = [{ id: "", name: "Semua" }, ...state.genres];

    bar.innerHTML = genres.map(g => `
      <button
        class="lib-genre-chip${state.genre === (g.id || "") ? " active" : ""}"
        role="tab"
        aria-selected="${state.genre === (g.id || "") ? "true" : "false"}"
        data-genre="${esc(g.slug || g.id || "")}"
      >${esc(g.name)}</button>
    `).join("");

    bar.querySelectorAll(".lib-genre-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        state.genre = btn.dataset.genre;
        state.page  = 1;
        renderSkeletons();
        fetchBooks();
        renderGenreBar();
      });
    });
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: SKELETONS
  // ──────────────────────────────────────────────────────────────
  function renderSkeletons(n = 8) {
    const grid = document.getElementById("book-grid");
    if (!grid) return;
    grid.className = "book-grid";
    grid.setAttribute("aria-busy", "true");
    grid.innerHTML = Array.from({ length: n }, () => `
      <div class="book-skeleton" aria-hidden="true">
        <div class="skeleton bsk-cover"></div>
        <div class="bsk-body">
          <div class="skeleton bsk-line bsk-t1"></div>
          <div class="skeleton bsk-line bsk-t2"></div>
          <div class="skeleton bsk-line bsk-t3"></div>
        </div>
      </div>
    `).join("");
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: BOOK CARD (grid mode)
  // ──────────────────────────────────────────────────────────────
  function renderBookCard(book, index) {
    const saved   = state.bookmarks.includes(book.id);
    const fmt     = (book.file_type || "").toUpperCase();
    const delay   = (Math.min(index, 7) * 0.04).toFixed(2);
    const cover   = book.cover_url
      ? esc(book.cover_url)
      : COVER_FALLBACK;

    return `
    <article class="book-card" role="article" style="animation-delay:${delay}s">

      <!-- Cover -->
      <a
        href="${BOOK_PATH}${esc(book.slug)}"
        class="book-cover-wrap"
        aria-label="Buka detail ${esc(book.title)}"
        onclick="(function(){var s='${esc(book.slug)}';fetch(window._libApiBase+'/api/views/book/'+s,{method:'POST'}).catch(()=>{})})()"
      >
        <img
          class="book-cover-img"
          src="${cover}"
          alt="Sampul buku ${esc(book.title)}"
          ${index < 4 ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'}
          onerror="this.src='${COVER_FALLBACK}'"
        >

        ${book.genre ? `<span class="book-genre-badge">${esc(book.genre)}</span>` : ""}
        ${fmt        ? `<span class="book-format-badge">${fmt}</span>` : ""}

        <button
          class="book-bookmark-btn${saved ? " saved" : ""}"
          data-book-id="${book.id}"
          aria-label="${saved ? "Hapus bookmark" : "Simpan buku ini"}"
          title="${saved ? "Hapus bookmark" : "Bookmark"}"
        >
          <svg fill="${saved ? "currentColor" : "none"}" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"/>
          </svg>
        </button>

        <div class="book-cover-overlay">
          <a href="${BOOK_PATH}${esc(book.slug)}" class="book-overlay-btn book-overlay-read">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/>
            </svg>
            Baca Detail
          </a>
          ${book.file_url ? `
          <a
            href="${esc(book.file_url)}"
            class="book-overlay-btn book-overlay-download"
            download
            target="_blank"
            rel="noopener noreferrer"
            data-dl-slug="${esc(book.slug)}"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
            </svg>
            Unduh${fmt ? " " + fmt : ""}
          </a>` : ""}
        </div>
      </a>

      <!-- Info -->
      <div class="book-info">
        <h3 class="book-title">
          <a href="${BOOK_PATH}${esc(book.slug)}">${esc(book.title)}</a>
        </h3>
        <p class="book-author">${esc(book.author || "")}</p>

        ${book.description
          ? `<p class="book-desc">${esc(book.description)}</p>`
          : ""}

        <div class="book-meta">
          <span class="book-meta-item" title="${Number(book.view_count || 0).toLocaleString("id-ID")} kali dilihat">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
            </svg>
            ${fmtViews(book.view_count || 0)}
          </span>
          ${book.pages ? `
          <span class="book-meta-dot" aria-hidden="true">·</span>
          <span class="book-meta-item" title="${book.pages} halaman">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/>
            </svg>
            ${book.pages} hal
          </span>` : ""}
          ${book.file_size ? `
          <span class="book-meta-dot" aria-hidden="true">·</span>
          <span class="book-meta-item">${fmtSize(book.file_size)}</span>` : ""}
        </div>

        <!-- Tombol aksi — tampil hanya di list view -->
        <div class="book-list-actions">
          <a href="${BOOK_PATH}${esc(book.slug)}" class="book-list-btn book-list-btn-read">
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/>
            </svg>
            Baca Detail
          </a>
          ${book.file_url ? `
          <a
            href="${esc(book.file_url)}"
            class="book-list-btn book-list-btn-dl"
            download target="_blank" rel="noopener noreferrer"
            data-dl-slug="${esc(book.slug)}"
          >
            <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
            </svg>
            Unduh${fmt ? " " + fmt : ""}
          </a>` : ""}
        </div>
      </div>
    </article>`;
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: GRID
  // ──────────────────────────────────────────────────────────────
  function renderGrid() {
    const grid = document.getElementById("book-grid");
    if (!grid) return;
    grid.setAttribute("aria-busy", "false");

    // Expose API base untuk onclick inline
    window._libApiBase = getApiBase();

    if (!state.books.length) {
      grid.className = "book-grid";
      grid.innerHTML = `
        <div class="empty-state" role="status">
          <p style="font-size:2.5rem;margin-bottom:12px">📭</p>
          <p><strong>Tidak ada buku ditemukan.</strong></p>
          <p>Coba kata kunci lain atau pilih genre berbeda.</p>
        </div>`;
      return;
    }

    grid.className = "book-grid" + (state.viewMode === "list" ? " list-view" : "");
    grid.innerHTML  = state.books.map((b, i) => renderBookCard(b, i)).join("");

    // Event: bookmark buttons
    grid.querySelectorAll(".book-bookmark-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        toggleBookmark(Number(btn.dataset.bookId));
      });
    });

    // Event: download tracking
    grid.querySelectorAll("[data-dl-slug]").forEach(a => {
      a.addEventListener("click", () => {
        trackDownload(a.dataset.dlSlug);
      });
    });
  }

  function renderError() {
    const grid = document.getElementById("book-grid");
    if (!grid) return;
    grid.setAttribute("aria-busy", "false");
    grid.className = "book-grid";
    grid.innerHTML = `
      <div class="error-state" role="alert">
        <p><strong>Gagal memuat data.</strong></p>
        <p>Periksa koneksi internet Anda lalu <a href="" onclick="location.reload();return false;" style="color:var(--accent)">coba lagi</a>.</p>
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: PAGINATION — menggunakan kelas yang sama dengan app.js
  // ──────────────────────────────────────────────────────────────
  function renderPaginationLib() {
    const container = document.getElementById("lib-pagination");
    if (!container) return;
    const totalPages = Math.ceil(state.total / BOOKS_PER_PAGE);
    if (totalPages <= 1) { container.innerHTML = ""; return; }

    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= state.page - 1 && i <= state.page + 1)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== "...") {
        pages.push("...");
      }
    }

    container.innerHTML = `
      <nav class="pagination" aria-label="Navigasi halaman">
        <button class="pagination-btn" data-pg="${state.page - 1}"
          ${state.page <= 1 ? "disabled" : ""} aria-label="Halaman sebelumnya">&laquo;</button>
        ${pages.map(p => p === "..."
          ? `<span class="pagination-ellipsis">…</span>`
          : `<button class="pagination-btn${p === state.page ? " active" : ""}"
               data-pg="${p}" aria-label="Halaman ${p}"
               aria-current="${p === state.page ? "page" : "false"}">${p}</button>`
        ).join("")}
        <button class="pagination-btn" data-pg="${state.page + 1}"
          ${state.page >= totalPages ? "disabled" : ""} aria-label="Halaman berikutnya">&raquo;</button>
      </nav>`;

    container.querySelectorAll(".pagination-btn:not([disabled])").forEach(btn => {
      btn.addEventListener("click", () => {
        const p = parseInt(btn.dataset.pg);
        if (p >= 1 && p <= totalPages) {
          state.page = p;
          renderSkeletons();
          fetchBooks();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    });
  }

  function updateCount() {
    const el = document.getElementById("lib-count");
    if (el) el.textContent = `${state.total.toLocaleString("id-ID")} buku`;
  }

  // ──────────────────────────────────────────────────────────────
  // VIEW MODE
  // ──────────────────────────────────────────────────────────────
  function setViewMode(mode) {
    state.viewMode = mode;
    const btnGrid = document.getElementById("view-grid");
    const btnList = document.getElementById("view-list");
    if (btnGrid) { btnGrid.classList.toggle("active", mode === "grid"); btnGrid.setAttribute("aria-pressed", mode === "grid"); }
    if (btnList) { btnList.classList.toggle("active", mode === "list"); btnList.setAttribute("aria-pressed", mode === "list"); }
    renderGrid();
  }

  // ──────────────────────────────────────────────────────────────
  // INIT HALAMAN PERPUSTAKAAN
  // ──────────────────────────────────────────────────────────────
  function initPerpustakaanPage() {
    loadBookmarks();

    // Muat genre & buku sekaligus
    renderSkeletons();
    fetchGenres();
    fetchBooks();
    fetchStats();

    // Search (debounced)
    const searchEl = document.getElementById("lib-search");
    if (searchEl) {
      searchEl.addEventListener("input", debounce(e => {
        state.query = e.target.value.trim();
        state.page  = 1;
        renderSkeletons();
        fetchBooks();
      }, SEARCH_DEBOUNCE));
    }

    // Sort
    const sortEl = document.getElementById("lib-sort");
    if (sortEl) {
      sortEl.addEventListener("change", () => {
        state.sort = sortEl.value;
        state.page = 1;
        renderSkeletons();
        fetchBooks();
      });
    }

    // Format
    const fmtEl = document.getElementById("lib-format");
    if (fmtEl) {
      fmtEl.addEventListener("change", () => {
        state.format = fmtEl.value;
        state.page   = 1;
        renderSkeletons();
        fetchBooks();
      });
    }

    // View toggle
    document.getElementById("view-grid")?.addEventListener("click", () => setViewMode("grid"));
    document.getElementById("view-list")?.addEventListener("click", () => setViewMode("list"));
  }

  // ──────────────────────────────────────────────────────────────
  // ROUTER — tunggu DOMContentLoaded agar app.js sudah berjalan
  // ──────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const path = window.location.pathname;
    if (path === "/perpustakaan.html" || path === "/perpustakaan") {
      initPerpustakaanPage();
    }
  });

})(); // end IIFE
