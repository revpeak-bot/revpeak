// ============================================================
// REVPEAK — buku.js
// Menangani: buku.html  →  /buku/:slug
// Dimuat bersama seo.js. Semua logika halaman detail buku
// berada di dalam IIFE ini sehingga tidak ada konflik variabel
// dengan file lain.
// ============================================================

(function () {
  "use strict";

  // ── Gunakan API_BASE yang sama dengan app.js ─────────────────
  function getApiBase() {
    return (typeof API_BASE !== "undefined" ? API_BASE : "");
  }

  // ──────────────────────────────────────────────────────────────
  // CONSTANTS
  // ──────────────────────────────────────────────────────────────
  const COVER_FALLBACK = "https://placehold.co/270x480/EFECE6/6B6560?text=No+Cover";
  const BOOK_PATH      = "/buku/";
  const BOOKMARK_KEY   = "rp_bookmarks_books";   // kunci sama dengan perpustakaan.js
  const RELATED_LIMIT  = 6;

  // ──────────────────────────────────────────────────────────────
  // UTILS
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

  // ──────────────────────────────────────────────────────────────
  // BOOKMARK  (berbagi key yang sama dengan perpustakaan.js)
  // ──────────────────────────────────────────────────────────────
  let bookmarks = [];

  function loadBookmarks() {
    try { bookmarks = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || "[]"); }
    catch { bookmarks = []; }
  }

  function saveBookmarks() {
    try { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks)); }
    catch {}
  }

  function isBookmarked(id) {
    return bookmarks.includes(id);
  }

  function toggleBookmark(id, btn) {
    const idx = bookmarks.indexOf(id);
    if (idx === -1) bookmarks.push(id);
    else            bookmarks.splice(idx, 1);
    saveBookmarks();

    // Update tampilan tombol tanpa re-render seluruh halaman
    if (!btn) return;
    const saved = isBookmarked(id);
    btn.classList.toggle("saved", saved);
    btn.setAttribute("aria-label", saved ? "Hapus bookmark" : "Simpan buku ini");
    btn.querySelector("svg").setAttribute("fill", saved ? "currentColor" : "none");
  }

  // ──────────────────────────────────────────────────────────────
  // API
  // ──────────────────────────────────────────────────────────────
  async function apiFetch(path) {
    const res = await fetch(getApiBase() + path);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  async function fetchBook(slug) {
    return apiFetch(`/api/books/${encodeURIComponent(slug)}`);
  }

  async function fetchRelated(genreSlug, excludeSlug) {
    const params = new URLSearchParams({ limit: RELATED_LIMIT, sort: "popular" });
    if (genreSlug) params.set("genre", genreSlug);
    try {
      const res   = await apiFetch(`/api/books?${params}`);
      const books = (res.data || []).filter(b => b.slug !== excludeSlug);
      return books.slice(0, RELATED_LIMIT);
    } catch {
      return [];
    }
  }

  function trackView(slug) {
    fetch(`${getApiBase()}/api/views/book/${encodeURIComponent(slug)}`, { method: "POST" })
      .catch(() => {});
  }

  function trackDownload(slug) {
    fetch(`${getApiBase()}/api/downloads/book/${encodeURIComponent(slug)}`, { method: "POST" })
      .catch(() => {});
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: HALAMAN DETAIL
  // ──────────────────────────────────────────────────────────────
  function renderBookDetail(book) {
    const coverCol   = document.getElementById("book-cover-col");
    const contentCol = document.getElementById("book-content-col");
    if (!coverCol || !contentCol) return;

    const cover   = book.cover_url ? esc(book.cover_url) : COVER_FALLBACK;
    const fmt     = (book.file_type || "").toUpperCase();
    const saved   = isBookmarked(book.id);
    const hasDl   = !!book.file_url;

    // ── Kolom kiri: sampul + tombol aksi ────────────────────────
    coverCol.innerHTML = `
      <div class="book-detail-cover">
        <img
          src="${cover}"
          alt="Sampul buku ${esc(book.title)}"
          loading="eager"
          fetchpriority="high"
          onerror="this.src='${COVER_FALLBACK}'"
        >
      </div>

      <div class="book-detail-actions">
        ${hasDl ? `
        <a
          id="btn-download-main"
          href="${esc(book.file_url)}"
          class="btn-download"
          download
          target="_blank"
          rel="noopener noreferrer"
          data-dl-slug="${esc(book.slug)}"
          aria-label="Unduh${fmt ? " " + fmt : ""} — ${esc(book.title)}"
        >
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
          </svg>
          Unduh${fmt ? " " + fmt : ""}
        </a>` : `
        <button class="btn-download" disabled aria-label="File tidak tersedia">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"/>
          </svg>
          File Tidak Tersedia
        </button>`}

        <button
          id="btn-bookmark-detail"
          class="btn-download btn-download-secondary${saved ? " saved" : ""}"
          data-book-id="${book.id}"
          aria-label="${saved ? "Hapus bookmark" : "Simpan buku ini"}"
        >
          <svg width="16" height="16" fill="${saved ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z"/>
          </svg>
          ${saved ? "Tersimpan" : "Simpan"}
        </button>
      </div>

      <div class="book-stats-row">
        <span class="book-stat-badge" aria-label="${Number(book.view_count || 0).toLocaleString("id-ID")} kali dilihat">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
          </svg>
          ${fmtViews(book.view_count || 0)} dilihat
        </span>
        ${book.download_count ? `
        <span class="book-stat-badge" aria-label="${Number(book.download_count).toLocaleString("id-ID")} kali diunduh">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
          </svg>
          ${fmtViews(book.download_count)} diunduh
        </span>` : ""}
      </div>
    `;

    // ── Kolom kanan: judul, meta, deskripsi, share ───────────────
    const metaItems = [
      book.year      && { label: "Tahun",     value: book.year },
      book.pages     && { label: "Halaman",   value: book.pages + " hal" },
      book.publisher && { label: "Penerbit",  value: book.publisher },
      book.language  && { label: "Bahasa",    value: book.language },
      fmt            && { label: "Format",    value: fmt },
      book.file_size && { label: "Ukuran",    value: fmtSize(book.file_size) },
      book.isbn      && { label: "ISBN",      value: book.isbn },
    ].filter(Boolean);

    contentCol.innerHTML = `
      ${book.genre ? `<span class="book-detail-genre">${esc(book.genre)}</span>` : ""}

      <h1 class="book-detail-title" id="book-main-title">${esc(book.title)}</h1>

      <p class="book-detail-author">
        Oleh <strong>${esc(book.author || "Tidak diketahui")}</strong>
      </p>

      ${metaItems.length ? `
      <div class="book-detail-meta-grid" role="list" aria-label="Informasi buku">
        ${metaItems.map(m => `
        <div class="book-meta-item" role="listitem">
          <span class="book-meta-label">${esc(m.label)}</span>
          <span class="book-meta-value">${esc(m.value)}</span>
        </div>`).join("")}
      </div>` : ""}

      ${book.description ? `
      <hr class="book-detail-divider">
      <p class="book-detail-desc-title">Tentang Buku</p>
      <div class="book-detail-description">${esc(book.description)}</div>
      ` : ""}

      <div class="book-detail-share">
        <p class="book-detail-share-title">Bagikan</p>
        <div class="share-buttons">
          <button class="share-btn share-twitter" onclick="window.shareBook('twitter')" aria-label="Bagikan ke Twitter">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
            </svg>
            Twitter
          </button>
          <button class="share-btn share-wa" onclick="window.shareBook('whatsapp')" aria-label="Bagikan ke WhatsApp">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
          </button>
          <button class="share-btn share-copy" id="btn-copy-link" onclick="window.copyLink()" aria-label="Salin tautan">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            Salin Tautan
          </button>
        </div>
      </div>
    `;

    // ── Event: tombol unduh tracking ─────────────────────────────
    document.getElementById("btn-download-main")?.addEventListener("click", () => {
      trackDownload(book.slug);
    });

    // ── Event: tombol bookmark ───────────────────────────────────
    const bookmarkBtn = document.getElementById("btn-bookmark-detail");
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener("click", () => {
        toggleBookmark(book.id, bookmarkBtn);
        // Sinkronkan teks label tombol
        const nowSaved = isBookmarked(book.id);
        bookmarkBtn.childNodes[bookmarkBtn.childNodes.length - 1].textContent =
          " " + (nowSaved ? "Tersimpan" : "Simpan");
      });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: BUKU TERKAIT
  // ──────────────────────────────────────────────────────────────
  function renderRelatedBooks(books) {
    const section = document.getElementById("related-books");
    const grid    = document.getElementById("related-books-grid");
    if (!section || !grid || !books.length) return;

    grid.innerHTML = books.map((book, index) => {
      const cover = book.cover_url ? esc(book.cover_url) : COVER_FALLBACK;
      const fmt   = (book.file_type || "").toUpperCase();
      const delay = (Math.min(index, 5) * 0.05).toFixed(2);

      return `
      <article class="book-card" role="article" style="animation-delay:${delay}s">
        <a
          href="${BOOK_PATH}${esc(book.slug)}"
          class="book-cover-wrap"
          aria-label="Buka detail ${esc(book.title)}"
        >
          <img
            class="book-cover-img"
            src="${cover}"
            alt="Sampul buku ${esc(book.title)}"
            loading="lazy"
            onerror="this.src='${COVER_FALLBACK}'"
          >
          ${book.genre ? `<span class="book-genre-badge">${esc(book.genre)}</span>` : ""}
          ${fmt        ? `<span class="book-format-badge">${fmt}</span>` : ""}
          <div class="book-cover-overlay">
            <a href="${BOOK_PATH}${esc(book.slug)}" class="book-overlay-btn book-overlay-read">
              <svg fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/>
              </svg>
              Baca Detail
            </a>
          </div>
        </a>
        <div class="book-info">
          <h3 class="book-title">
            <a href="${BOOK_PATH}${esc(book.slug)}">${esc(book.title)}</a>
          </h3>
          <p class="book-author">${esc(book.author || "")}</p>
        </div>
      </article>`;
    }).join("");

    section.style.display = "";
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: ERROR STATE
  // ──────────────────────────────────────────────────────────────
  function renderError(msg) {
    const coverCol   = document.getElementById("book-cover-col");
    const contentCol = document.getElementById("book-content-col");
    const message    = msg || "Buku tidak ditemukan atau terjadi kesalahan.";

    if (coverCol)   coverCol.innerHTML  = "";
    if (contentCol) contentCol.innerHTML = `
      <div class="error-state" role="alert" style="padding:40px 0">
        <p style="font-size:3rem;margin-bottom:16px">📭</p>
        <p><strong>${esc(message)}</strong></p>
        <p style="margin-top:8px">
          <a href="/perpustakaan.html" style="color:var(--accent)">← Kembali ke Perpustakaan</a>
        </p>
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // META: judul halaman & breadcrumb
  // ──────────────────────────────────────────────────────────────
  function updatePageMeta(book) {
    // Judul tab browser
    document.title = `${book.title} — Revpeak`;

    // Breadcrumb
    const crumb = document.getElementById("breadcrumb-title");
    if (crumb) {
      crumb.textContent = book.title.length > 50
        ? book.title.slice(0, 50) + "…"
        : book.title;
    }

    // Open Graph / meta description (jika belum di-inject Worker)
    const desc = book.description
      ? book.description.slice(0, 155).replace(/\s+/g, " ").trim()
      : `Baca dan unduh "${book.title}" di Revpeak Perpustakaan.`;

    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.name = "description";
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = desc;
  }

  // ──────────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────────
  async function initBukuPage() {
    loadBookmarks();

    // Ekstrak slug dari path: /buku/:slug
    const parts = window.location.pathname.split("/").filter(Boolean);
    // parts[0] = "buku", parts[1] = slug
    const slug = parts[1] || "";

    if (!slug) {
      renderError("Slug buku tidak ditemukan di URL.");
      return;
    }

    // Lacak view (fire-and-forget, tidak memblokir render)
    trackView(slug);

    // Ambil data buku
    let book;
    try {
      book = await fetchBook(slug);
    } catch (e) {
      const is404 = e.message.includes("404");
      renderError(is404
        ? "Buku tidak ditemukan."
        : "Gagal memuat data buku. Periksa koneksi internet Anda.");
      return;
    }

    if (!book || !book.slug) {
      renderError("Data buku tidak valid.");
      return;
    }

    // Render konten utama
    updatePageMeta(book);
    renderBookDetail(book);

    // Muat buku terkait secara asinkron (tidak memblokir render utama)
    if (book.genre_id || book.genre) {
      const genreSlug = book.genre_id || book.genre;
      fetchRelated(genreSlug, slug).then(related => {
        if (related.length) renderRelatedBooks(related);
      });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // ROUTER — tunggu DOM siap
  // ──────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    const path = window.location.pathname;
    // Cocokkan /buku/ diikuti slug apapun
    if (/^\/buku\/[^/]+/.test(path)) {
      initBukuPage();
    }
  });

})(); // end IIFE
