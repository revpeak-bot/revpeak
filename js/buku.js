// ============================================================
// REVPEAK — buku.js
// Menangani: buku.html  →  /buku/:slug
// Format yang didukung:
//   PDF              → iframe native browser
//   DOCX/DOC         → Microsoft Office Online Viewer
//   XLSX/XLS         → Microsoft Office Online Viewer
//   PPTX/PPT         → Microsoft Office Online Viewer
//   EPUB/TXT/lainnya → tidak ada viewer, tombol unduh saja
// ============================================================

(function () {
  "use strict";

  function getApiBase() {
    return (typeof API_BASE !== "undefined" ? API_BASE : "");
  }

  // ──────────────────────────────────────────────────────────────
  // CONSTANTS
  // ──────────────────────────────────────────────────────────────
  const COVER_FALLBACK  = "https://placehold.co/270x480/EFECE6/6B6560?text=No+Cover";
  const OFFICE_VIEWER   = "https://view.officeapps.live.com/op/embed.aspx?src=";
  const OFFICE_FORMATS  = ["docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp"];

  // ──────────────────────────────────────────────────────────────
  // UTILS
  // ──────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
    if (bytes >= 1_024)     return Math.round(bytes / 1_024)       + " KB";
    return bytes + " B";
  }

  // Deteksi jenis viewer berdasarkan file_type atau ekstensi URL
  function detectViewer(fileType, fileUrl) {
    const ext = (fileType || fileUrl?.split(".").pop() || "").toLowerCase().trim();
    if (ext === "pdf")                  return "pdf";
    if (OFFICE_FORMATS.includes(ext))   return "office";
    return "none"; // EPUB, TXT, dan lainnya
  }

  // Deteksi perangkat mobile (Android/iOS)
  // Android Chrome tidak mendukung PDF inline di iframe — pakai Google Docs Viewer
  function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  }

  // ──────────────────────────────────────────────────────────────
  // TRACKING
  // ──────────────────────────────────────────────────────────────
  function trackView(slug) {
    fetch(`${getApiBase()}/api/views/book/${encodeURIComponent(slug)}`, { method: "POST" })
      .catch(() => {});
  }

  function trackDownload(slug) {
    fetch(`${getApiBase()}/api/downloads/book/${encodeURIComponent(slug)}`, { method: "POST" })
      .catch(() => {});
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: SIDEBAR
  // ──────────────────────────────────────────────────────────────
  function renderSidebar(book) {
    const sidebar = document.getElementById("buku-sidebar");
    if (!sidebar) return;

    const cover      = book.cover_url ? esc(book.cover_url) : COVER_FALLBACK;
    const fmt        = (book.file_type || "").toUpperCase();
    const hasDl      = !!book.file_url;
    const hasContent = !!(book.content && book.content.trim() && book.content !== "<p><br></p>");

    const metaRows = [
      book.year      && ["Tahun",    book.year],
      book.pages     && ["Halaman",  `${book.pages} hal`],
      book.publisher && ["Penerbit", book.publisher],
      book.language  && ["Bahasa",   book.language],
      fmt            && ["Format",   fmt],
      book.file_size && ["Ukuran",   fmtSize(book.file_size)],
    ].filter(Boolean);

    sidebar.innerHTML = `
      <a href="/perpustakaan.html" class="buku-back-link" aria-label="Kembali ke perpustakaan">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"/>
        </svg>
        Perpustakaan
      </a>

      <div class="buku-cover-wrap">
        <img
          src="${cover}"
          alt="Sampul buku ${esc(book.title)}"
          loading="eager" fetchpriority="high"
          onerror="this.src='${COVER_FALLBACK}'"
        >
      </div>

      <!-- Kolom kanan: hanya info (genre, judul, penulis, meta) -->
      <div class="buku-sidebar-right">
        ${book.genre ? `<span class="buku-genre-badge">${esc(book.genre)}</span>` : ""}
        <h1 class="buku-title">${esc(book.title)}</h1>
        <p class="buku-author">${esc(book.author || "")}</p>

        ${metaRows.length ? `
        <ul class="buku-meta-list" aria-label="Informasi buku">
          ${metaRows.map(([label, val]) => `
          <li>
            <span class="buku-meta-label">${esc(label)}</span>
            <span class="buku-meta-value">${esc(String(val))}</span>
          </li>`).join("")}
        </ul>` : ""}
      </div>

      <!-- Tombol aksi — di luar kolom, span full width pada mobile -->
      <div class="buku-action-btns">
        ${hasContent ? `
        <button id="buku-read-btn" class="buku-dl-btn" type="button"
          aria-label="Baca konten buku ${esc(book.title)}">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"/>
          </svg>
          Baca Konten
        </button>` : ""}

        ${hasDl ? `
        <a id="buku-dl-btn" href="${esc(book.file_url)}"
          class="buku-dl-btn${hasContent ? " buku-dl-btn-secondary" : ""}"
          download target="_blank" rel="noopener noreferrer"
          aria-label="Unduh${fmt ? " " + fmt : ""} — ${esc(book.title)}">
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
          </svg>
          Unduh${fmt ? " " + fmt : ""}
        </a>` : (!hasContent ? `
        <span class="buku-no-file-badge">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"/>
          </svg>
          File Tidak Tersedia
        </span>` : "")}
      </div>

      <!-- Sinopsis — di luar kolom, span full width pada mobile -->
      ${book.description ? `
      <div class="buku-synopsis">
        <p class="buku-synopsis-label">Tentang Buku</p>
        <p class="buku-synopsis-text">${esc(book.description)}</p>
      </div>` : ""}
    `;

    // Tombol "Baca Konten" → scroll ke panel viewer
    document.getElementById("buku-read-btn")?.addEventListener("click", () => {
      const panel = document.getElementById("buku-viewer-panel");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    // Track download
    document.getElementById("buku-dl-btn")?.addEventListener("click", () => {
      trackDownload(book.slug);
    });
  }

  // ──────────────────────────────────────────────────────────────
  // CHAPTER PARSER
  // ──────────────────────────────────────────────────────────────
  function parseChapters(html) {
    const parser   = new DOMParser();
    const doc      = parser.parseFromString(html, "text/html");
    const sections = doc.querySelectorAll("section.buku-bab");
    if (!sections.length) return null; // konten lama tanpa struktur bab

    return Array.from(sections).map((sec, i) => ({
      num    : i + 1,
      id     : `bab-${i + 1}`,
      title  : sec.querySelector(".bab-judul")?.textContent?.trim() || `Bab ${i + 1}`,
      content: sec.querySelector(".bab-isi")?.innerHTML || "",
    }));
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: KONTEN TULISAN (prioritas di atas file)
  // ──────────────────────────────────────────────────────────────
  function renderContent(book) {
    const panel    = document.getElementById("buku-viewer-panel");
    const skeleton = document.getElementById("buku-viewer-skeleton");
    const toolbar  = document.getElementById("buku-toolbar-title");
    if (!panel) return;

    if (toolbar) toolbar.textContent = book.title || "";
    skeleton?.remove();

    const wrap = document.createElement("div");
    wrap.className = "buku-content-wrap";

    const chapters = parseChapters(book.content);

    if (chapters && chapters.length > 0) {
      // ── Format baru: konten berbasis bab ──────────────────────

      // Progress bar
      const progressBar = document.createElement("div");
      progressBar.className = "buku-read-progress" ;
      progressBar.innerHTML = `<div class="buku-read-progress-fill" id="buku-progress-fill"></div>`;

      // Daftar isi
      const toc = document.createElement("div");
      toc.className = "buku-toc";
      toc.id        = "buku-toc";
      toc.innerHTML = `
        <div class="buku-toc-header" id="buku-toc-header" role="button"
             tabindex="0" aria-expanded="false" aria-controls="buku-toc-body">
          <span>
            <span class="buku-toc-title">📑 Daftar Isi</span>
            <span class="buku-toc-count">${chapters.length} bab</span>
          </span>
          <span class="buku-toc-chevron">▼</span>
        </div>
        <div class="buku-toc-body" id="buku-toc-body" role="list">
          <ol class="buku-toc-list">
            ${chapters.map(ch => `
            <li role="listitem">
              <a href="#${ch.id}" class="buku-toc-link" data-toc-id="${ch.id}">
                <span class="buku-toc-num">${ch.num}</span>
                ${esc(ch.title)}
              </a>
            </li>`).join("")}
          </ol>
        </div>`;

      // Konten bab
      const body = document.createElement("div");
      body.className = "buku-content-body";
      body.setAttribute("aria-label", `Isi buku ${esc(book.title)}`);

      chapters.forEach((ch, idx) => {
        const isLast = idx === chapters.length - 1;
        const next   = !isLast ? chapters[idx + 1] : null;

        const section = document.createElement("section");
        section.className = "bab-section";
        section.id        = ch.id;
        section.setAttribute("aria-label", `Bab ${ch.num}: ${ch.title}`);

        section.innerHTML = `
          <div class="bab-header">
            <span class="bab-num-label">Bab ${ch.num}</span>
            <h2 class="bab-judul-display">${esc(ch.title)}</h2>
          </div>
          <div class="bab-isi-display">${ch.content}</div>
          ${next ? `
          <a href="#${next.id}" class="bab-next-link" aria-label="Lanjut ke ${esc(next.title)}">
            <span class="bab-next-label">Bab berikutnya:</span>
            ${esc(next.title)} →
          </a>` : `
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid var(--border);
            text-align:center;color:var(--text-muted);font-size:.85rem">
            🎉 Selesai membaca
          </div>`}`;

        body.appendChild(section);
      });

      wrap.appendChild(progressBar);
      wrap.appendChild(toc);
      wrap.appendChild(body);
      panel.appendChild(wrap);

      // ── ToC toggle ─────────────────────────────────────────
      const tocEl     = document.getElementById("buku-toc");
      const tocHeader = document.getElementById("buku-toc-header");
      tocHeader?.addEventListener("click", () => {
        const open = tocEl.classList.toggle("open");
        tocHeader.setAttribute("aria-expanded", String(open));
      });
      tocHeader?.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tocHeader.click(); }
      });

      // Auto-close ToC setelah klik link pada mobile
      wrap.querySelectorAll(".buku-toc-link").forEach(link => {
        link.addEventListener("click", () => {
          if (window.innerWidth < 768) {
            tocEl?.classList.remove("open");
            tocHeader?.setAttribute("aria-expanded", "false");
          }
        });
      });

      // ── Progress bar + ToC aktif via IntersectionObserver ──
      const sectionEls  = wrap.querySelectorAll(".bab-section");
      const tocLinks    = wrap.querySelectorAll(".buku-toc-link");
      const progressFill = document.getElementById("buku-progress-fill");

      // Progress membaca berdasarkan scroll dalam wrap
      wrap.addEventListener("scroll", () => {
        const { scrollTop, scrollHeight, clientHeight } = wrap;
        const pct = scrollHeight <= clientHeight
          ? 100
          : Math.min(100, (scrollTop / (scrollHeight - clientHeight)) * 100);
        if (progressFill) progressFill.style.width = pct.toFixed(1) + "%";
      });

      // Highlight ToC aktif berdasarkan bab yang paling dekat ke viewport
      const observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const id = entry.target.id;
            tocLinks.forEach(l => {
              l.classList.toggle("active", l.dataset.tocId === id);
            });
          });
        },
        { root: wrap, rootMargin: "-10% 0px -80% 0px", threshold: 0 }
      );
      sectionEls.forEach(s => observer.observe(s));

    } else {
      // ── Format lama: dump langsung sebagai satu blok ─────────
      const legacy = document.createElement("article");
      legacy.className = "buku-content-body-legacy";
      legacy.setAttribute("aria-label", `Isi buku ${esc(book.title)}`);
      legacy.innerHTML = book.content;
      wrap.appendChild(legacy);
      panel.appendChild(wrap);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: VIEWER PANEL (file iframe)
  // ──────────────────────────────────────────────────────────────
  function renderViewer(book) {
    const panel    = document.getElementById("buku-viewer-panel");
    const skeleton = document.getElementById("buku-viewer-skeleton");
    const toolbar  = document.getElementById("buku-toolbar-title");
    if (!panel) return;

    const fmt      = (book.file_type || "").toUpperCase();
    const viewer   = detectViewer(book.file_type, book.file_url);
    const title    = book.title || "";

    // Update toolbar
    if (toolbar) toolbar.textContent = title;

    // Hapus skeleton
    skeleton?.remove();

    if (viewer === "pdf") {
      // Desktop → iframe native browser (lebih cepat, offline-capable)
      // Mobile  → Google Docs Viewer (Android Chrome tidak render PDF di iframe)
      const mobile = isMobileDevice();
      const src    = mobile
        ? `https://docs.google.com/gview?url=${encodeURIComponent(book.file_url)}&embedded=true`
        : book.file_url;

      const iframe = document.createElement("iframe");
      iframe.id    = "buku-viewer-frame";
      iframe.src   = src;
      iframe.title = `Membaca: ${title}`;
      iframe.setAttribute("aria-label", `Viewer PDF: ${title}`);
      iframe.setAttribute("frameborder", "0");

      // Fallback: jika Google Docs Viewer gagal memuat (timeout 15 detik),
      // tampilkan tombol "Buka PDF" sebagai alternatif
      if (mobile) {
        const fallbackTimer = setTimeout(() => {
          const existing = document.getElementById("buku-gdocs-fallback");
          if (!existing) {
            const fallback = document.createElement("p");
            fallback.id        = "buku-gdocs-fallback";
            fallback.innerHTML = `
              Viewer tidak muncul?
              <a href="${esc(book.file_url)}" target="_blank" rel="noopener noreferrer"
                 style="color:var(--accent,#E03E0B);font-weight:700">
                Buka PDF langsung ↗
              </a>`;
            fallback.style.cssText =
              "font-size:.8rem;text-align:center;padding:8px 16px;color:var(--text-muted)";
            panel.appendChild(fallback);
          }
        }, 15000);

        // Batalkan timer jika iframe berhasil load
        iframe.addEventListener("load", () => clearTimeout(fallbackTimer), { once: true });
      }

      panel.appendChild(iframe);

    } else if (viewer === "office") {
      // ── DOCX/XLSX/PPTX: Microsoft Office Online Viewer ──────
      // File URL harus dapat diakses publik (R2 public bucket ✓)
      const src    = OFFICE_VIEWER + encodeURIComponent(book.file_url);
      const iframe = document.createElement("iframe");
      iframe.id              = "buku-viewer-frame";
      iframe.src             = src;
      iframe.title           = `Membaca: ${title}`;
      iframe.setAttribute("aria-label", `Viewer ${fmt}: ${title}`);
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("scrolling", "no");
      panel.appendChild(iframe);

    } else {
      // ── EPUB / format lain: tidak ada viewer ────────────────
      const noViewer = document.createElement("div");
      noViewer.className = "buku-no-viewer";
      noViewer.innerHTML = `
        <p style="font-size:3rem">📖</p>
        <p>
          Format <strong>${esc(fmt || "ini")}</strong> tidak dapat ditampilkan langsung di browser.<br>
          Silakan unduh file untuk membacanya.
        </p>
        ${book.file_url ? `
        <a
          href="${esc(book.file_url)}"
          class="buku-dl-btn"
          style="width:auto;padding:10px 24px"
          download target="_blank" rel="noopener noreferrer"
          id="buku-viewer-dl-btn"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/>
          </svg>
          Unduh${fmt ? " " + fmt : ""}
        </a>` : ""}
      `;
      panel.appendChild(noViewer);

      document.getElementById("buku-viewer-dl-btn")?.addEventListener("click", () => {
        trackDownload(book.slug);
      });
    }
  }

  // ──────────────────────────────────────────────────────────────
  // RENDER: ERROR
  // ──────────────────────────────────────────────────────────────
  function renderError(msg) {
    const sidebar = document.getElementById("buku-sidebar");
    const panel   = document.getElementById("buku-viewer-panel");
    if (sidebar) sidebar.innerHTML = "";
    if (panel)   panel.innerHTML   = `
      <div class="buku-no-viewer" role="alert">
        <p style="font-size:2.5rem">📭</p>
        <p><strong>${esc(msg || "Buku tidak ditemukan.")}</strong></p>
        <a href="/perpustakaan.html" style="color:var(--accent);font-size:.9rem">
          ← Kembali ke Perpustakaan
        </a>
      </div>`;
  }

  // ──────────────────────────────────────────────────────────────
  // META: judul halaman & breadcrumb
  // ──────────────────────────────────────────────────────────────
  function updateMeta(book) {
    document.title = `${book.title} — Revpeak`;

    const crumb = document.getElementById("breadcrumb-title");
    if (crumb) {
      crumb.textContent = book.title.length > 45
        ? book.title.slice(0, 45) + "…"
        : book.title;
    }

    // Isi deskripsi meta jika belum di-inject worker
    const desc = book.description
      ? book.description.slice(0, 155).replace(/\s+/g, " ").trim()
      : `Baca atau unduh "${book.title}" di Revpeak Perpustakaan.`;

    let metaEl = document.querySelector('meta[name="description"]');
    if (!metaEl) {
      metaEl = document.createElement("meta");
      metaEl.name = "description";
      document.head.appendChild(metaEl);
    }
    metaEl.content = desc;
  }

  // ──────────────────────────────────────────────────────────────
  // INIT
  // ──────────────────────────────────────────────────────────────
  async function initBukuPage() {
    // Ekstrak slug dari /buku/:slug
    const slug = window.location.pathname.split("/").filter(Boolean)[1] || "";
    if (!slug) { renderError("Slug buku tidak ditemukan di URL."); return; }

    // Catat view (fire-and-forget)
    trackView(slug);

    // Fetch data buku
    let book;
    try {
      const res = await fetch(`${getApiBase()}/api/books/${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(`${res.status}`);
      book = await res.json();
    } catch (e) {
      renderError(e.message.includes("404")
        ? "Buku tidak ditemukan."
        : "Gagal memuat data buku. Periksa koneksi internet Anda.");
      return;
    }

    if (!book?.slug) { renderError("Data buku tidak valid."); return; }

    updateMeta(book);
    renderSidebar(book);

    // Prioritas: konten tulisan > file viewer
    if (book.content && book.content.trim() !== "" && book.content !== "<p><br></p>") {
      renderContent(book);
    } else {
      renderViewer(book);
    }
  }

  // ──────────────────────────────────────────────────────────────
  // ROUTER
  // ──────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    if (/^\/buku\/[^/]+/.test(window.location.pathname)) {
      initBukuPage();
    }
  });

})();
