// ============================================================
// REVPEAK — admin.js
// Admin panel untuk manajemen artikel & berita
// ============================================================

const API_BASE     = "https://revpeak-api.revpeak2.workers.dev";
const SUPABASE_URL = "https://xfzqfowijriurfnheakg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmenFmb3dpanJpdXJmbmhlYWtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTIzMzMsImV4cCI6MjA5MDM2ODMzM30.W5r5w3duNpVMo6NgPfHLhrb7jl32ksMGTQDBfT1MbVY";

// ============================================================
// UTILS
// ============================================================

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Hitung estimasi waktu baca dari konten HTML (strip tag, hitung kata)
function calcReadingTime(content) {
  if (!content) return 1;
  const text  = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / 200)); // ~200 kata/menit
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function showToast(msg, type = "success") {
  const existing = document.getElementById("admin-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "admin-toast";
  toast.className = `admin-toast toast-${type}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.textContent = msg;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function confirmDialog(msg) {
  return window.confirm(msg);
}

// ============================================================
// TAMPILKAN / SEMBUNYIKAN SECTION
// FIX: gunakan style.display agar konsisten dengan admin.html
// ============================================================

function showSection(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "";
}

function hideSection(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = "none";
}

// ============================================================
// SUPABASE AUTH
// ============================================================

const AUTH_KEY = "revpeak_admin_session";

function saveSession(session) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    expires_at:    session.expires_at,
  }));
}

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY));
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(AUTH_KEY);
}

async function refreshSession() {
  const session = getSession();
  if (!session?.refresh_token) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) { clearSession(); return null; }
    const data = await res.json();
    saveSession(data);
    return data;
  } catch {
    clearSession();
    return null;
  }
}


// ── Helper untuk endpoint admin buku di Worker (D1) ──────────
// Berbeda dari dbFetch yang ke Supabase — ini ke Worker endpoint.
async function workerAdminFetch(path, options = {}) {
  const token = await getValidToken();
  if (!token) throw new Error("Sesi tidak valid.");
  const isFormData = options.body instanceof FormData;
  const res = await fetch(API_BASE + path, {
    method: options.method || "GET",
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      "Authorization": `Bearer ${token}`,
      ...(options.headers || {}),
    },
    body: options.body || undefined,
  });
  if (!res.ok) {
    const msg = await res.json()
      .then(d => d.error || d.message || res.statusText)
      .catch(() => res.statusText);
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

async function getValidToken() {
  let session = getSession();
  if (!session) return null;

  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && now >= session.expires_at - 60) {
    session = await refreshSession();
  }

  return session?.access_token || null;
}

async function supabaseAuth(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error_description || err.message || "Login gagal. Periksa email dan password.");
  }
  return res.json();
}

async function supabaseLogout(token) {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` },
    });
  } catch { /* abaikan error logout */ }
}

// ============================================================
// SUPABASE REST (dengan auth token)
// ============================================================

async function dbFetch(path, options = {}) {
  const token = await getValidToken();
  if (!token) throw new Error("Sesi tidak valid. Silakan login ulang.");

  const headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Prefer": options.prefer || "return=representation",
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...options, headers });

  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || `Error ${res.status}`);
  return data;
}

// ============================================================
// AUTOSAVE DRAFT
// ============================================================

const DRAFT_KEY = "revpeak_article_draft";
let autosaveTimer = null;
let debounceTimer = null;

function saveDraft() {
  const form = $("#article-form");
  if (!form) return;

  const draft = {
    title:         $("#f-title")?.value || "",
    slug:          $("#f-slug")?.value  || "",
    excerpt:       $("#f-excerpt")?.value || "",
    content:       $("#f-content")?.value || "",
    post_type:     $("#f-type")?.value  || "article",
    category_id:   $("#f-category")?.value || "",
    author_id:     $("#f-author")?.value   || "",
    tags:          $("#f-tags")?.value     || "",
    status:        $("#f-status")?.value   || "draft",
    thumbnail_url: $("#f-thumbnail")?.value || "",
    thumbnail_alt: $("#f-thumbnail-alt")?.value || "",
    savedAt:       new Date().toISOString(),
    editingId:     form.dataset.editingId || "",
  };

  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  const indicator = $("#autosave-indicator");
  if (indicator) {
    indicator.textContent = `Draft tersimpan ${new Date().toLocaleTimeString("id-ID")}`;
    indicator.className = "autosave-indicator saved";
  }
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); }
  catch { return null; }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  const indicator = $("#autosave-indicator");
  if (indicator) { indicator.textContent = ""; indicator.className = "autosave-indicator"; }
}

function startAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(saveDraft, 30000);
}

function debounceSave() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(saveDraft, 3000);
}

// ============================================================
// KATEGORI & PENULIS (untuk dropdown)
// ============================================================

let cachedCategories = [];
let cachedAuthors    = [];

async function loadDropdownData() {
  try {
    [cachedCategories, cachedAuthors] = await Promise.all([
      dbFetch("/categories?select=id,name,slug&order=name.asc"),
      dbFetch("/authors?select=id,name,slug&order=name.asc"),
    ]);
  } catch (e) {
    showToast("Gagal memuat data kategori/penulis: " + e.message, "error");
  }
}

function populateDropdowns(article = null) {
  const catSel    = $("#f-category");
  const authorSel = $("#f-author");

  if (catSel) {
    catSel.innerHTML = `<option value="">— Pilih Kategori —</option>`
      + cachedCategories.map(c =>
          `<option value="${c.id}" ${article?.category_id == c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`
        ).join("");
  }

  if (authorSel) {
    authorSel.innerHTML = `<option value="">— Pilih Penulis —</option>`
      + cachedAuthors.map(a =>
          `<option value="${a.id}" ${article?.author_id == a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`
        ).join("");
  }
}

// ============================================================
// HALAMAN: DAFTAR ARTIKEL
// ============================================================

let listPage = 1;
const listLimit = 20;
let listFilter = { type: "", status: "", search: "" };

async function loadArticleList(page = 1) {
  listPage = page;
  const tbody = $("#article-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6" class="tbl-loading" aria-live="polite">Memuat data...</td></tr>`;

  try {
    let path = `/articles?select=id,title,slug,post_type,status,published_at,view_count,categories(name)&order=created_at.desc&limit=${listLimit}&offset=${(page - 1) * listLimit}`;

    if (listFilter.type)   path += `&post_type=eq.${listFilter.type}`;
    if (listFilter.status) path += `&status=eq.${listFilter.status}`;
    if (listFilter.search) path += `&title=ilike.*${encodeURIComponent(listFilter.search)}*`;

    const articles = await dbFetch(path);

    if (!articles || !articles.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="tbl-empty">Tidak ada data.</td></tr>`;
      return;
    }

    tbody.innerHTML = articles.map(a => `
      <tr>
        <td class="td-title">
          <a href="/${escapeHtml(a.slug)}" target="_blank" rel="noopener" class="article-link">
            ${escapeHtml(a.title)}
          </a>
        </td>
        <td>
          <span class="badge ${a.post_type === "news" ? "bt-news" : "bt-article"}">
            ${a.post_type === "news" ? "Berita" : "Artikel"}
          </span>
        </td>
        <td>${escapeHtml(a.categories?.name || "-")}</td>
        <td>
          <span class="status-badge status-${a.status}">
            ${a.status === "published" ? "✅ Terbit" : "📋 Draft"}
          </span>
        </td>
        <td class="td-date">${formatDate(a.published_at)}</td>
        <td class="td-actions">
          <button class="btn-icon btn-edit" data-id="${a.id}" aria-label="Edit ${escapeHtml(a.title)}">✏️</button>
          <button class="btn-icon btn-delete" data-id="${a.id}" data-title="${escapeHtml(a.title)}" aria-label="Hapus ${escapeHtml(a.title)}">🗑️</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".btn-edit").forEach(btn => {
      btn.addEventListener("click", () => openEditForm(btn.dataset.id));
    });
    tbody.querySelectorAll(".btn-delete").forEach(btn => {
      btn.addEventListener("click", () => deleteArticle(btn.dataset.id, btn.dataset.title));
    });

    renderListPagination(articles.length);

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="tbl-error" role="alert">Gagal memuat: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderListPagination(count) {
  const el = $("#list-pagination");
  if (!el) return;

  const prevDisabled = listPage <= 1;
  const nextDisabled = count < listLimit;

  el.innerHTML = `
    <button class="btn-secondary" id="btn-prev-page" ${prevDisabled ? "disabled" : ""}>← Sebelumnya</button>
    <span class="pagination-info">Halaman ${listPage}</span>
    <button class="btn-secondary" id="btn-next-page" ${nextDisabled ? "disabled" : ""}>Berikutnya →</button>`;

  if (!prevDisabled) $("#btn-prev-page")?.addEventListener("click", () => loadArticleList(listPage - 1));
  if (!nextDisabled) $("#btn-next-page")?.addEventListener("click", () => loadArticleList(listPage + 1));
}

// ============================================================
// HALAMAN: FORM ARTIKEL (Tambah / Edit)
// FIX: gunakan style.display bukan .hidden
// ============================================================

function showView(viewId) {
  // Sembunyikan semua view — hapus juga atribut hidden agar tidak konflik
  $$(".apage").forEach(v => {
    v.style.display = "none";
    v.removeAttribute("hidden");
  });
  // Tampilkan view yang diminta
  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.removeAttribute("hidden");
    target.style.display = "block";
  }
}

async function openNewForm() {
  try {
    showToast("Memuat form...", "info");
    await loadDropdownData();
    resetForm();

    const draft = loadDraft();
    if (draft && !draft.editingId) {
      const useDraft = confirm(`Ada draft tersimpan pada ${formatDate(draft.savedAt)}.\nMau dilanjutkan?`);
      if (useDraft) fillFormFromDraft(draft);
    }

    startAutosave();
    showView("form");

    const titleEl = document.getElementById("topbar-title");
    if (titleEl) titleEl.textContent = "Tambah Artikel";

    $("#f-title")?.focus();
  } catch (e) {
    showToast("Gagal membuka form: " + e.message, "error");
    console.error("[openNewForm]", e);
  }
}

async function openEditForm(id) {
  try {
    showToast("Memuat artikel...", "info");
    await loadDropdownData();
    resetForm();

    const articles = await dbFetch(`/articles?id=eq.${id}&select=*&limit=1`);
    if (!articles || !articles.length) { showToast("Artikel tidak ditemukan.", "error"); return; }

    const article = articles[0];
    const form    = $("#article-form");
    if (form) form.dataset.editingId = id;

    fillFormFromArticle(article);
    populateDropdowns(article);

    showView("form");
    startAutosave();

    const titleEl = document.getElementById("topbar-title");
    if (titleEl) titleEl.textContent = "Edit Artikel";

    $("#f-title")?.focus();
  } catch (e) {
    showToast("Gagal memuat artikel: " + e.message, "error");
    console.error("[openEditForm]", e);
  }
}

function resetForm() {
  const form = $("#article-form");
  if (!form) return;

  form.reset();
  delete form.dataset.editingId;
  clearDraft();

  const slugEl = $("#f-slug");
  if (slugEl) { slugEl.value = ""; delete slugEl.dataset.manual; }
  const statusEl = $("#f-status");
  if (statusEl) statusEl.value = "draft";
  const typeEl = $("#f-type");
  if (typeEl) typeEl.value = "article";

  const indicator = $("#autosave-indicator");
  if (indicator) indicator.textContent = "";

  populateDropdowns();
}

function fillFormFromArticle(article) {
  const set = (id, val) => { const el = $(id); if (el) el.value = val ?? ""; };
  set("#f-title",         article.title);
  set("#f-slug",          article.slug);
  set("#f-excerpt",       article.excerpt);
  set("#f-content",       article.content);
  set("#f-type",          article.post_type);
  set("#f-status",        article.status);
  set("#f-thumbnail",     article.thumbnail_url);
  set("#f-thumbnail-alt", article.thumbnail_alt);
  set("#f-tags",          (article.tags || []).join(", "));
  set("#f-published-at",  article.published_at ? article.published_at.slice(0, 16) : "");
}

function fillFormFromDraft(draft) {
  const set = (id, val) => { const el = $(id); if (el) el.value = val ?? ""; };
  set("#f-title",         draft.title);
  set("#f-slug",          draft.slug);
  set("#f-excerpt",       draft.excerpt);
  set("#f-content",       draft.content);
  set("#f-type",          draft.post_type);
  set("#f-status",        draft.status);
  set("#f-thumbnail",     draft.thumbnail_url);
  set("#f-thumbnail-alt", draft.thumbnail_alt);
  set("#f-tags",          draft.tags);

  populateDropdowns();
  if (draft.category_id) { const el = $("#f-category"); if (el) el.value = draft.category_id; }
  if (draft.author_id)   { const el = $("#f-author");   if (el) el.value = draft.author_id; }
}

function getFormData() {
  const title       = $("#f-title")?.value.trim() || "";
  const slug        = $("#f-slug")?.value.trim()  || slugify(title);
  const excerpt     = $("#f-excerpt")?.value.trim() || "";
  const content     = $("#f-content")?.value || "";
  const post_type   = $("#f-type")?.value || "article";
  const status      = $("#f-status")?.value || "draft";
  const category_id = $("#f-category")?.value || null;
  const author_id   = $("#f-author")?.value   || null;
  const thumbnail_url = $("#f-thumbnail")?.value.trim() || null;
  const thumbnail_alt = $("#f-thumbnail-alt")?.value.trim() || null;
  const tagsRaw     = $("#f-tags")?.value || "";
  const tags        = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);
  const publishedAt = $("#f-published-at")?.value || null;

  return {
    title, slug, excerpt, content, post_type, status,
    reading_time: calcReadingTime(content),
    category_id: category_id ? parseInt(category_id) : null,
    author_id:   author_id   ? parseInt(author_id)   : null,
    thumbnail_url, thumbnail_alt,
    tags: tags.length ? tags : null,
    published_at: status === "published"
      ? (publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString())
      : null,
  };
}

async function submitArticleForm(e) {
  e.preventDefault();

  const form      = $("#article-form");
  const editingId = form?.dataset.editingId;
  const submitBtn = $("#btn-submit-article");
  const data      = getFormData();

  if (!data.title) { showToast("Judul tidak boleh kosong.", "error"); return; }
  if (!data.slug)  { showToast("Slug tidak boleh kosong.", "error"); return; }

  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Menyimpan..."; }

  try {
    if (editingId) {
      await dbFetch(`/articles?id=eq.${editingId}`, {
        method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify(data),
      });
      showToast("Artikel berhasil diperbarui.");
    } else {
      await dbFetch("/articles", { method: "POST", body: JSON.stringify(data) });
      showToast("Artikel berhasil disimpan.");
    }

    clearDraft();
    if (autosaveTimer) clearInterval(autosaveTimer);
    showView("list");
    loadArticleList(1);

  } catch (err) {
    showToast("Gagal menyimpan: " + err.message, "error");
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "💾 Simpan"; }
  }
}

async function deleteArticle(id, title) {
  if (!confirmDialog(`Hapus artikel "${title}"?\nTindakan ini tidak bisa dibatalkan.`)) return;
  try {
    await dbFetch(`/articles?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
    showToast("Artikel berhasil dihapus.");
    loadArticleList(listPage);
  } catch (e) {
    showToast("Gagal menghapus: " + e.message, "error");
  }
}

// ============================================================
// HALAMAN: KELOLA KATEGORI
// ============================================================

async function loadCategories() {
  const tbody = $("#category-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3" class="tbl-loading">Memuat...</td></tr>`;

  try {
    const cats = await dbFetch("/categories?select=id,name,slug,description&order=name.asc");

    if (!cats || !cats.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="tbl-empty">Belum ada kategori.</td></tr>`;
      return;
    }

    tbody.innerHTML = cats.map(c => `
      <tr>
        <td>${escapeHtml(c.name)}</td>
        <td><code>${escapeHtml(c.slug)}</code></td>
        <td class="td-actions">
          <button class="btn-icon btn-edit-cat" data-id="${c.id}" data-name="${escapeHtml(c.name)}" data-slug="${escapeHtml(c.slug)}" data-desc="${escapeHtml(c.description || "")}" aria-label="Edit ${escapeHtml(c.name)}">✏️</button>
          <button class="btn-icon btn-delete-cat" data-id="${c.id}" data-name="${escapeHtml(c.name)}" aria-label="Hapus ${escapeHtml(c.name)}">🗑️</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".btn-edit-cat").forEach(btn => {
      btn.addEventListener("click", () => openCategoryForm(btn.dataset));
    });
    tbody.querySelectorAll(".btn-delete-cat").forEach(btn => {
      btn.addEventListener("click", () => deleteCategory(btn.dataset.id, btn.dataset.name));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="tbl-error" role="alert">Gagal memuat: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function openCategoryForm(data = {}) {
  const sec = $("#category-form-section");
  if (sec) sec.style.display = "block";
  if ($("#cat-form-id"))   $("#cat-form-id").value   = data.id   || "";
  if ($("#cat-form-name")) $("#cat-form-name").value = data.name || "";
  if ($("#cat-form-slug")) $("#cat-form-slug").value = data.slug || "";
  if ($("#cat-form-desc")) $("#cat-form-desc").value = data.desc || "";
  $("#cat-form-name")?.focus();
}

function resetCategoryForm() {
  const sec = $("#category-form-section");
  if (sec) sec.style.display = "none";
  if ($("#cat-form-id"))   $("#cat-form-id").value   = "";
  if ($("#cat-form-name")) $("#cat-form-name").value = "";
  if ($("#cat-form-slug")) $("#cat-form-slug").value = "";
  if ($("#cat-form-desc")) $("#cat-form-desc").value = "";
}

async function submitCategoryForm(e) {
  e.preventDefault();
  const id   = $("#cat-form-id").value;
  const name = $("#cat-form-name").value.trim();
  const slug = $("#cat-form-slug").value.trim() || slugify(name);
  const desc = $("#cat-form-desc").value.trim();

  if (!name) { showToast("Nama kategori tidak boleh kosong.", "error"); return; }

  try {
    if (id) {
      await dbFetch(`/categories?id=eq.${id}`, {
        method: "PATCH", prefer: "return=minimal",
        body: JSON.stringify({ name, slug, description: desc || null }),
      });
      showToast("Kategori diperbarui.");
    } else {
      await dbFetch("/categories", {
        method: "POST",
        body: JSON.stringify({ name, slug, description: desc || null }),
      });
      showToast("Kategori ditambahkan.");
    }
    resetCategoryForm();
    loadCategories();
  } catch (e) {
    showToast("Gagal: " + e.message, "error");
  }
}

async function deleteCategory(id, name) {
  if (!confirmDialog(`Hapus kategori "${name}"?`)) return;
  try {
    await dbFetch(`/categories?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
    showToast("Kategori dihapus.");
    loadCategories();
  } catch (e) {
    showToast("Gagal: " + e.message, "error");
  }
}

// ============================================================
// HALAMAN: KELOLA PENULIS
// ============================================================

async function loadAuthors() {
  const tbody = $("#author-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3" class="tbl-loading">Memuat...</td></tr>`;

  try {
    const authors = await dbFetch("/authors?select=id,name,slug,bio,avatar_url&order=name.asc");

    if (!authors || !authors.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="tbl-empty">Belum ada penulis.</td></tr>`;
      return;
    }

    tbody.innerHTML = authors.map(a => `
      <tr>
        <td>
          <div class="author-cell">
            ${a.avatar_url
              ? `<img src="${escapeHtml(a.avatar_url)}" class="author-thumb" alt="${escapeHtml(a.name)}" loading="lazy">`
              : `<div class="author-thumb-placeholder">${escapeHtml(a.name.charAt(0))}</div>`}
            <span>${escapeHtml(a.name)}</span>
          </div>
        </td>
        <td><code>${escapeHtml(a.slug)}</code></td>
        <td class="td-actions">
          <button class="btn-icon btn-edit-author" data-id="${a.id}" data-name="${escapeHtml(a.name)}" data-slug="${escapeHtml(a.slug)}" data-bio="${escapeHtml(a.bio || "")}" data-avatar="${escapeHtml(a.avatar_url || "")}" aria-label="Edit ${escapeHtml(a.name)}">✏️</button>
          <button class="btn-icon btn-delete-author" data-id="${a.id}" data-name="${escapeHtml(a.name)}" aria-label="Hapus ${escapeHtml(a.name)}">🗑️</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".btn-edit-author").forEach(btn => {
      btn.addEventListener("click", () => openAuthorForm(btn.dataset));
    });
    tbody.querySelectorAll(".btn-delete-author").forEach(btn => {
      btn.addEventListener("click", () => deleteAuthor(btn.dataset.id, btn.dataset.name));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" class="tbl-error" role="alert">Gagal: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function openAuthorForm(data = {}) {
  const sec = $("#author-form-section");
  if (sec) sec.style.display = "block";
  if ($("#author-form-id"))     $("#author-form-id").value     = data.id     || "";
  if ($("#author-form-name"))   $("#author-form-name").value   = data.name   || "";
  if ($("#author-form-slug"))   $("#author-form-slug").value   = data.slug   || "";
  if ($("#author-form-bio"))    $("#author-form-bio").value    = data.bio    || "";
  if ($("#author-form-avatar")) $("#author-form-avatar").value = data.avatar || "";
  $("#author-form-name")?.focus();
}

function resetAuthorForm() {
  const sec = $("#author-form-section");
  if (sec) sec.style.display = "none";
  ["#author-form-id","#author-form-name","#author-form-slug",
   "#author-form-bio","#author-form-avatar"].forEach(sel => {
    const el = $(sel); if (el) el.value = "";
  });
}

async function submitAuthorForm(e) {
  e.preventDefault();
  const id     = $("#author-form-id").value;
  const name   = $("#author-form-name").value.trim();
  const slug   = $("#author-form-slug").value.trim() || slugify(name);
  const bio    = $("#author-form-bio").value.trim();
  const avatar = $("#author-form-avatar").value.trim();

  if (!name) { showToast("Nama penulis tidak boleh kosong.", "error"); return; }

  try {
    const payload = { name, slug, bio: bio || null, avatar_url: avatar || null };
    if (id) {
      await dbFetch(`/authors?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(payload) });
      showToast("Penulis diperbarui.");
    } else {
      await dbFetch("/authors", { method: "POST", body: JSON.stringify(payload) });
      showToast("Penulis ditambahkan.");
    }
    resetAuthorForm();
    loadAuthors();
  } catch (e) {
    showToast("Gagal: " + e.message, "error");
  }
}

async function deleteAuthor(id, name) {
  if (!confirmDialog(`Hapus penulis "${name}"?`)) return;
  try {
    await dbFetch(`/authors?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
    showToast("Penulis dihapus.");
    loadAuthors();
  } catch (e) {
    showToast("Gagal: " + e.message, "error");
  }
}

// ============================================================
// LOGIN / LOGOUT
// FIX: gunakan style.display, bukan .hidden
//      tambah try-catch menyeluruh
// ============================================================

async function initLogin() {
  const loginSection = document.getElementById("login-section");
  const appSection   = document.getElementById("app-section");
  const errEl        = document.getElementById("login-error");

  // Pastikan state awal benar
  if (loginSection) loginSection.style.display = "";
  if (appSection)   appSection.style.display   = "none";

  // Cek sesi tersimpan
  let token = null;
  try { token = await getValidToken(); } catch { token = null; }

  if (token) {
    if (loginSection) loginSection.style.display = "none";
    if (appSection)   appSection.style.display   = "";
    initApp();
    return;
  }

  // Pasang event listener login form
  const form = document.getElementById("login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const email    = document.getElementById("login-email")?.value.trim() || "";
    const password = document.getElementById("login-password")?.value || "";
    const btn      = document.getElementById("btn-login");

    if (!email || !password) {
      if (errEl) errEl.textContent = "Email dan password tidak boleh kosong.";
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = "Masuk..."; }
    if (errEl) errEl.textContent = "";

    try {
      const session = await supabaseAuth(email, password);
      saveSession(session);

      if (loginSection) loginSection.style.display = "none";
      if (appSection)   appSection.style.display   = "";

      initApp();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Masuk →"; }
    }
  });
}

async function handleLogout() {
  const token = await getValidToken().catch(() => null);
  if (token) await supabaseLogout(token);
  clearSession();
  window.location.reload();
}

// ============================================================
// NAV TABS
// ============================================================

function initNavTabs() {
  $$("[data-nav]").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("[data-nav]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const target = btn.dataset.nav;
      const titleEl = document.getElementById("topbar-title");

      if (target === "articles") {
        if (titleEl) titleEl.textContent = "Artikel";
        showView("list");
        loadArticleList(1);
      } else if (target === "categories") {
        if (titleEl) titleEl.textContent = "Kategori";
        showView("categories");
        loadCategories();
      } else if (target === "authors") {
        if (titleEl) titleEl.textContent = "Penulis";
        showView("authors");
        loadAuthors();
      } else if (target === "books") {
        if (titleEl) titleEl.textContent = "Buku";
        showView("books");
        loadBookList(1);
      } else if (target === "book-genres") {
        if (titleEl) titleEl.textContent = "Genre Buku";
        showView("book-genres");
        loadBookGenreList();
      }
    });
  });
}

// ============================================================
// FILTER & SEARCH (halaman list)
// ============================================================

function initListFilters() {
  const typeFilter   = $("#filter-type");
  const statusFilter = $("#filter-status");
  const searchInput  = $("#filter-search");

  typeFilter?.addEventListener("change", () => {
    listFilter.type = typeFilter.value;
    loadArticleList(1);
  });

  statusFilter?.addEventListener("change", () => {
    listFilter.status = statusFilter.value;
    loadArticleList(1);
  });

  const doSearch = () => {
    listFilter.search = searchInput?.value.trim() || "";
    loadArticleList(1);
  };

  searchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
  searchInput?.addEventListener("input", () => {
    // Auto-search setelah berhenti mengetik 600ms
    clearTimeout(window._searchTimer);
    window._searchTimer = setTimeout(doSearch, 600);
  });
}

// ============================================================
// FORM: AUTO-SLUG & INPUT BINDINGS
// ============================================================

function initFormBindings() {
  const titleInput = $("#f-title");
  const slugInput  = $("#f-slug");

  titleInput?.addEventListener("input", () => {
    if (slugInput && !slugInput.dataset.manual) {
      slugInput.value = slugify(titleInput.value);
    }
    debounceSave();
  });

  slugInput?.addEventListener("input", () => {
    if (slugInput) slugInput.dataset.manual = "1";
    debounceSave();
  });

  ["#f-excerpt","#f-content","#f-thumbnail","#f-thumbnail-alt","#f-tags"].forEach(sel => {
    $(sel)?.addEventListener("input", debounceSave);
  });
  ["#f-type","#f-status","#f-category","#f-author"].forEach(sel => {
    $(sel)?.addEventListener("change", debounceSave);
  });

  // Auto-slug kategori
  $("#cat-form-name")?.addEventListener("input", function () {
    const idEl = $("#cat-form-id");
    if (!idEl?.value) {
      const slugEl = $("#cat-form-slug");
      if (slugEl) slugEl.value = slugify(this.value);
    }
  });

  // Auto-slug penulis
  $("#author-form-name")?.addEventListener("input", function () {
    const idEl = $("#author-form-id");
    if (!idEl?.value) {
      const slugEl = $("#author-form-slug");
      if (slugEl) slugEl.value = slugify(this.value);
    }
  });
}

// ============================================================
// INIT APP (setelah login berhasil)
// ============================================================

function initApp() {
  // Sembunyikan semua view, hapus atribut hidden, tampilkan view-list
  $$(".apage").forEach(v => {
    v.style.display = "none";
    v.removeAttribute("hidden");
  });
  const listView = document.getElementById("view-list");
  if (listView) listView.style.display = "block";

  // Sembunyikan form inline
  const catSec    = document.getElementById("category-form-section");
  const authorSec = document.getElementById("author-form-section");
  if (catSec)    catSec.style.display    = "none";
  if (authorSec) authorSec.style.display = "none";

  initNavTabs();
  initListFilters();
  initFormBindings();

  // Tombol tambah artikel
  $("#btn-new-article")?.addEventListener("click", openNewForm);

  // Tombol kembali ke list
  $$("[data-back-to-list]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (autosaveTimer) clearInterval(autosaveTimer);
      const titleEl = document.getElementById("topbar-title");
      if (titleEl) titleEl.textContent = "Artikel";
      showView("list");
      loadArticleList(listPage);
    });
  });

  // Submit form artikel
  $("#article-form")?.addEventListener("submit", submitArticleForm);

  // Kategori
  $("#category-form")?.addEventListener("submit", submitCategoryForm);
  $("#btn-cancel-cat")?.addEventListener("click", resetCategoryForm);
  $("#btn-new-category")?.addEventListener("click", () => openCategoryForm());

  // Penulis
  $("#author-form")?.addEventListener("submit", submitAuthorForm);
  $("#btn-cancel-author")?.addEventListener("click", resetAuthorForm);
  $("#btn-new-author")?.addEventListener("click", () => openAuthorForm());

  // Logout
  $("#btn-logout")?.addEventListener("click", handleLogout);

  // ── BUKU ──────────────────────────────────────────────────
  // Daftar buku
  $("#btn-new-book")?.addEventListener("click", openNewBookForm);

  // Kembali ke daftar buku (dari form)
  $("#btn-back-to-books")?.addEventListener("click", () => {
    showView("books");
    loadBookList(bookListPage);
    const titleEl = document.getElementById("topbar-title");
    if (titleEl) titleEl.textContent = "Buku";
  });

  // Batal di form buku
  $("#btn-cancel-book")?.addEventListener("click", () => {
    showView("books");
    const titleEl = document.getElementById("topbar-title");
    if (titleEl) titleEl.textContent = "Buku";
  });

  // Filter buku
  $("#book-filter-status")?.addEventListener("change", function () {
    bookFilter.status = this.value;
    loadBookList(1);
  });
  $("#book-filter-format")?.addEventListener("change", function () {
    bookFilter.format = this.value;
    loadBookList(1);
  });

  const _doBookSearch = () => {
    bookFilter.search = document.getElementById("book-search")?.value.trim() || "";
    loadBookList(1);
  };
  $("#book-search")?.addEventListener("input", () => {
    clearTimeout(window._bookSearchTimer);
    window._bookSearchTimer = setTimeout(_doBookSearch, 600);
  });
  $("#book-search")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { clearTimeout(window._bookSearchTimer); _doBookSearch(); }
  });

  // Submit form buku
  $("#book-form")?.addEventListener("submit", submitBookForm);

  // Upload R2
  initCoverUpload();
  initBookFileUpload();
  $("#cover-preview-clear")?.addEventListener("click", hideCoverPreview);
  $("#file-info-clear")?.addEventListener("click", hideFileInfo);

  // Auto-slug & bindings form buku
  initBookFormBindings();

  // Genre buku
  $("#book-genre-form")?.addEventListener("submit", submitBookGenreForm);
  $("#btn-cancel-book-genre")?.addEventListener("click", resetBookGenreForm);
  $("#btn-new-book-genre")?.addEventListener("click", () => openBookGenreForm());

  // Load list awal
  loadArticleList(1);
}

// ============================================================
// INIT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  initLogin();
});

// ============================================================
// BUKU — Manajemen Perpustakaan
// ============================================================

const R2_UPLOAD_PATH = "/api/r2/upload";
const R2_MAX_IMG     = 5   * 1024 * 1024;  // 5 MB
const R2_MAX_FILE    = 100 * 1024 * 1024;  // 100 MB

let cachedBookGenres = [];

async function loadBookGenreCache() {
  try {
    cachedBookGenres = await workerAdminFetch("/api/book-genres") || [];
  } catch { cachedBookGenres = []; }
}

function populateBookGenreSelect(selectedId = "") {
  const sel = document.getElementById("bf-genre");
  if (!sel) return;
  sel.innerHTML = `<option value="">— Pilih Genre —</option>`
    + cachedBookGenres.map(g =>
        `<option value="${g.id}" ${String(selectedId) === String(g.id) ? "selected" : ""}>${escapeHtml(g.name)}</option>`
      ).join("");
}

// ── Daftar Buku ──────────────────────────────────────────────
let bookListPage = 1;
const bookLimit  = 20;
let bookFilter   = { status: "", format: "", search: "" };

async function loadBookList(page = 1) {
  bookListPage = page;
  const tbody = document.getElementById("book-table-body");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="tbl-loading">Memuat data...</td></tr>`;

  try {
    const qp = new URLSearchParams({
      page,
      limit: bookLimit,
      ...(bookFilter.status ? { status: bookFilter.status } : {}),
      ...(bookFilter.format ? { format: bookFilter.format } : {}),
      ...(bookFilter.search ? { q:      bookFilter.search } : {}),
    });

    const res   = await workerAdminFetch(`/api/admin/books?${qp}`);
    const books = res?.data;

    if (!books || !books.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="tbl-empty">Belum ada buku.</td></tr>`;
      renderBookListPagination(0);
      return;
    }

    tbody.innerHTML = books.map(b => `
      <tr>
        <td class="td-title">
          <div class="book-table-cell">
            ${b.cover_url
              ? `<img src="${escapeHtml(b.cover_url)}" class="book-thumb" alt="${escapeHtml(b.title)}" loading="lazy">`
              : `<div class="book-thumb-placeholder">📚</div>`}
            <div>
              <a href="/buku/${escapeHtml(b.slug)}" target="_blank" rel="noopener" class="article-link">${escapeHtml(b.title)}</a>
              <div class="book-author-small">${escapeHtml(b.author || "")}</div>
            </div>
          </div>
        </td>
        <td>${b.genre ? `<span class="badge-type bt-genre">${escapeHtml(b.genre)}</span>` : "-"}</td>
        <td>${b.file_type ? `<span class="badge-type bt-format">${b.file_type.toUpperCase()}</span>` : "-"}</td>
        <td>
          <span class="status-badge status-${b.status === "archived" ? "archived" : b.status}">
            ${b.status === "published" ? "✅ Terbit" : b.status === "archived" ? "📦 Arsip" : "📋 Draft"}
          </span>
        </td>
        <td>${(b.view_count || 0).toLocaleString("id-ID")}</td>
        <td class="td-actions">
          <button class="btn-icon btn-edit-book" data-id="${b.id}" aria-label="Edit ${escapeHtml(b.title)}">✏️</button>
          <button class="btn-icon btn-delete-book" data-id="${b.id}" data-title="${escapeHtml(b.title)}" aria-label="Hapus ${escapeHtml(b.title)}">🗑️</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".btn-edit-book").forEach(btn => {
      btn.addEventListener("click", () => openEditBookForm(btn.dataset.id));
    });
    tbody.querySelectorAll(".btn-delete-book").forEach(btn => {
      btn.addEventListener("click", () => deleteBook(btn.dataset.id, btn.dataset.title));
    });

    renderBookListPagination(books.length);

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="tbl-error" role="alert">Gagal: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderBookListPagination(count) {
  const el = document.getElementById("book-list-pagination");
  if (!el) return;
  const prevDis = bookListPage <= 1;
  const nextDis = count < bookLimit;
  el.innerHTML = `
    <button class="btn-secondary" id="btn-book-prev" ${prevDis ? "disabled" : ""}>← Sebelumnya</button>
    <span class="pagination-info">Halaman ${bookListPage}</span>
    <button class="btn-secondary" id="btn-book-next" ${nextDis ? "disabled" : ""}>Berikutnya →</button>`;
  if (!prevDis) document.getElementById("btn-book-prev")?.addEventListener("click", () => loadBookList(bookListPage - 1));
  if (!nextDis) document.getElementById("btn-book-next")?.addEventListener("click", () => loadBookList(bookListPage + 1));
}

// ── Form Buku ─────────────────────────────────────────────────
async function openNewBookForm() {
  showToast("Memuat form...", "info");
  await loadBookGenreCache();
  resetBookForm();
  populateBookGenreSelect();
  initBookContentEditor();
  showView("book-form");
  const titleEl = document.getElementById("topbar-title");
  if (titleEl) titleEl.textContent = "Tambah Buku";
  document.getElementById("bf-title")?.focus();
}

async function openEditBookForm(id) {
  showToast("Memuat data buku...", "info");
  await loadBookGenreCache();
  resetBookForm();

  let bookContent = null;
  try {
    const book = await workerAdminFetch(`/api/admin/books/${id}`);
    if (!book) { showToast("Buku tidak ditemukan.", "error"); return; }
    bookContent = book.content || null;   // simpan konten sebelum fillBookForm
    fillBookForm(book);
    populateBookGenreSelect(book.genre_id);
  } catch (e) { showToast("Gagal memuat buku: " + e.message, "error"); return; }

  // Init editor dulu (sinkron) → tidak ada race condition
  initBookContentEditor();

  // Load konten bab setelah Quill siap (delay kecil cukup)
  setTimeout(() => setBookContent(bookContent), 30);

  showView("book-form");
  const titleEl = document.getElementById("topbar-title");
  if (titleEl) titleEl.textContent = "Edit Buku";
}

function fillBookForm(book) {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  setVal("bf-id",          book.id);
  setVal("bf-title",       book.title);
  setVal("bf-slug",        book.slug);
  setVal("bf-author",      book.author);
  setVal("bf-description", book.description);
  setVal("bf-isbn",        book.isbn);
  setVal("bf-publisher",   book.publisher);
  setVal("bf-year",        book.year);
  setVal("bf-pages",       book.pages);
  setVal("bf-language",    book.language || "id");
  setVal("bf-status",      book.status   || "draft");
  setVal("bf-tags",        (book.tags || []).join(", "));
  setVal("bf-cover-url",   book.cover_url);
  setVal("bf-cover-alt",   book.cover_alt);
  setVal("bf-file-url",    book.file_url);
  setVal("bf-file-type",   book.file_type);
  setVal("bf-file-size",   book.file_size);

  const slugEl = document.getElementById("bf-slug");
  if (slugEl) slugEl.dataset.manual = "1";

  if (book.cover_url) showCoverPreview(book.cover_url);
  if (book.file_url)  showFileInfo(book.file_url.split("/").pop(), book.file_size);
  // Catatan: konten buku (bab) di-load terpisah lewat setBookContent()
  // setelah initBookContentEditor() selesai — lihat openEditBookForm()
}

function resetBookForm() {
  const form = document.getElementById("book-form");
  if (form) form.reset();
  const idEl = document.getElementById("bf-id");
  if (idEl) idEl.value = "";
  const slugEl = document.getElementById("bf-slug");
  if (slugEl) { slugEl.value = ""; delete slugEl.dataset.manual; }
  hideCoverPreview();
  hideFileInfo();
  resetBookContent();
}

async function submitBookForm(e) {
  e.preventDefault();
  const id     = document.getElementById("bf-id")?.value?.trim();
  const title  = document.getElementById("bf-title")?.value?.trim();
  const author = document.getElementById("bf-author")?.value?.trim();
  const slug   = document.getElementById("bf-slug")?.value?.trim() || slugify(title);
  const genreId   = document.getElementById("bf-genre")?.value || null;
  const genreName = genreId
    ? (cachedBookGenres.find(g => String(g.id) === String(genreId))?.name || null)
    : null;

  if (!title)  { showToast("Judul buku wajib diisi.", "error"); return; }
  if (!author) { showToast("Nama penulis wajib diisi.", "error"); return; }

  const tagsRaw  = document.getElementById("bf-tags")?.value?.trim();
  const tags     = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];

  const payload = {
    title,
    slug,
    author,
    description : document.getElementById("bf-description")?.value?.trim() || null,
    isbn        : document.getElementById("bf-isbn")?.value?.trim()        || null,
    publisher   : document.getElementById("bf-publisher")?.value?.trim()   || null,
    year        : parseInt(document.getElementById("bf-year")?.value)      || null,
    pages       : parseInt(document.getElementById("bf-pages")?.value)     || null,
    language    : document.getElementById("bf-language")?.value            || "id",
    status      : document.getElementById("bf-status")?.value              || "draft",
    tags,
    cover_url   : document.getElementById("bf-cover-url")?.value?.trim()  || null,
    cover_alt   : document.getElementById("bf-cover-alt")?.value?.trim()  || null,
    file_url    : document.getElementById("bf-file-url")?.value?.trim()   || null,
    file_type   : document.getElementById("bf-file-type")?.value          || null,
    file_size   : parseInt(document.getElementById("bf-file-size")?.value) || null,
    content     : getBookContent(),
    updated_at  : new Date().toISOString(),
    ...(genreId ? { genre_id: Number(genreId), genre: genreName } : {}),
  };

  const btn = document.getElementById("btn-submit-book");
  if (btn) { btn.disabled = true; btn.textContent = "Menyimpan..."; }

  try {
    if (id) {
      // UPDATE — sertakan id dalam payload agar worker tahu ini update
      await workerAdminFetch("/api/admin/books", {
        method: "POST",
        body:   JSON.stringify({ ...payload, id: Number(id) }),
      });
      showToast("Buku berhasil diperbarui.");
    } else {
      await workerAdminFetch("/api/admin/books", {
        method: "POST",
        body:   JSON.stringify(payload),
      });
      showToast("Buku berhasil ditambahkan.");
    }
    showView("books");
    loadBookList(1);
    const titleEl = document.getElementById("topbar-title");
    if (titleEl) titleEl.textContent = "Buku";
  } catch (err) {
    showToast("Gagal menyimpan: " + err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "💾 Simpan Buku"; }
  }
}

async function deleteBook(id, title) {
  if (!confirmDialog(`Hapus buku "${title}"?\nTindakan ini tidak bisa dibatalkan.`)) return;
  try {
    // 1. Ambil URL file sebelum record dihapus
    const bookData = await workerAdminFetch(`/api/admin/books/${id}`);
    const fileUrls = [bookData?.cover_url, bookData?.file_url]
      .filter(url => url && typeof url === "string" && url.trim() !== "");

    // 2. Hapus record dari D1 via Worker
    await workerAdminFetch(`/api/admin/books/${id}`, { method: "DELETE" });

    // 3. Hapus file dari R2 (fire-and-forget)
    if (fileUrls.length) {
      const token = await getValidToken();
      fetch(`${API_BASE}/api/r2/delete`, {
        method:  "DELETE",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body:    JSON.stringify({ urls: fileUrls }),
      }).catch(() => {});
    }

    showToast("Buku berhasil dihapus.");
    loadBookList(bookListPage);
  } catch (e) {
    showToast("Gagal menghapus: " + e.message, "error");
  }
}

// ── Genre Buku ────────────────────────────────────────────────
async function loadBookGenreList() {
  const tbody = document.getElementById("book-genre-table-body");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" class="tbl-loading">Memuat...</td></tr>`;
  try {
    const genres = await workerAdminFetch("/api/book-genres");
    if (!genres || !genres.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="tbl-empty">Belum ada genre.</td></tr>`;
      return;
    }
    tbody.innerHTML = genres.map(g => `
      <tr>
        <td><strong>${escapeHtml(g.name)}</strong></td>
        <td><code>${escapeHtml(g.slug)}</code></td>
        <td>${escapeHtml(g.description || "-")}</td>
        <td class="td-actions">
          <button class="btn-icon btn-edit-bg"
            data-id="${g.id}" data-name="${escapeHtml(g.name)}"
            data-slug="${escapeHtml(g.slug)}" data-desc="${escapeHtml(g.description || "")}"
            aria-label="Edit ${escapeHtml(g.name)}">✏️</button>
          <button class="btn-icon btn-delete-bg"
            data-id="${g.id}" data-name="${escapeHtml(g.name)}"
            aria-label="Hapus ${escapeHtml(g.name)}">🗑️</button>
        </td>
      </tr>`).join("");

    tbody.querySelectorAll(".btn-edit-bg").forEach(btn => {
      btn.addEventListener("click", () => openBookGenreForm(btn.dataset));
    });
    tbody.querySelectorAll(".btn-delete-bg").forEach(btn => {
      btn.addEventListener("click", () => deleteBookGenre(btn.dataset.id, btn.dataset.name));
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="4" class="tbl-error" role="alert">Gagal: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function openBookGenreForm(data = {}) {
  const sec = document.getElementById("book-genre-form-section");
  if (sec) sec.style.display = "block";
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
  setVal("bg-form-id",   data.id   || "");
  setVal("bg-form-name", data.name || "");
  setVal("bg-form-slug", data.slug || "");
  setVal("bg-form-desc", data.desc || "");
  document.getElementById("bg-form-name")?.focus();
}

function resetBookGenreForm() {
  const sec = document.getElementById("book-genre-form-section");
  if (sec) sec.style.display = "none";
  ["bg-form-id","bg-form-name","bg-form-slug","bg-form-desc"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

async function submitBookGenreForm(e) {
  e.preventDefault();
  const id   = document.getElementById("bg-form-id")?.value;
  const name = document.getElementById("bg-form-name")?.value?.trim();
  const slug = document.getElementById("bg-form-slug")?.value?.trim() || slugify(name);
  const desc = document.getElementById("bg-form-desc")?.value?.trim();
  if (!name) { showToast("Nama genre wajib diisi.", "error"); return; }
  try {
    const genrePayload = { name, slug, description: desc || null };
    if (id) genrePayload.id = Number(id);
    await workerAdminFetch("/api/admin/book-genres", {
      method: "POST",
      body:   JSON.stringify(genrePayload),
    });
    showToast(id ? "Genre diperbarui." : "Genre ditambahkan.");
    resetBookGenreForm();
    loadBookGenreList();
  } catch (e) { showToast("Gagal: " + e.message, "error"); }
}

async function deleteBookGenre(id, name) {
  if (!confirmDialog(`Hapus genre "${name}"?`)) return;
  try {
    await workerAdminFetch(`/api/admin/book-genres/${id}`, { method: "DELETE" });
    showToast("Genre dihapus.");
    loadBookGenreList();
  } catch (e) { showToast("Gagal: " + e.message, "error"); }
}

// ── Upload ke R2 ──────────────────────────────────────────────
async function uploadToR2(file, folder) {
  const token = await getValidToken();
  if (!token) throw new Error("Sesi tidak valid.");
  const formData = new FormData();
  formData.append("file",   file);
  formData.append("folder", folder);
  const res = await fetch(API_BASE + R2_UPLOAD_PATH, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "apikey": SUPABASE_KEY },
    body: formData,
  });
  if (!res.ok) throw new Error(`Upload gagal (${res.status}): ${await res.text().catch(() => "")}`);
  return res.json();
}

function initCoverUpload() {
  const input = document.getElementById("cover-file-input");
  const area  = document.getElementById("cover-upload-area");
  if (!area || !input) return;
  area.addEventListener("click", () => input.click());
  area.addEventListener("dragover",  e => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", e => {
    e.preventDefault(); area.classList.remove("drag-over");
    const f = e.dataTransfer?.files?.[0]; if (f) handleCoverFile(f);
  });
  input.addEventListener("change", () => {
    const f = input.files?.[0]; if (f) handleCoverFile(f); input.value = "";
  });
}

// ============================================================
// SISTEM BAB (CHAPTERS) — Konten Buku
// ============================================================

// State bab — setiap bab kini menyimpan mode editornya sendiri
// ("visual" atau "html") agar tidak tertukar saat pindah antar-bab
// atau saat draft dibuka kembali.
let _chapters        = [];   // [{ id, title, content, mode }]
let _activeChapterId = null;
let _chapterCounter  = 0;

function _newChapterId() { return ++_chapterCounter; }

// ── Deteksi markup yang TIDAK didukung Quill secara native ───
// Quill 1.3.7 tidak memiliki blot untuk tag-tag ini (table, iframe,
// dll). Jika dipaksa masuk ke Quill via innerHTML + update(), bagian
// ini berisiko hilang/rusak karena Quill tidak bisa merepresentasikannya
// ke dalam model Delta-nya. Untuk bab dengan markup seperti ini, kita
// SELALU tampilkan via textarea HTML mentah — TIDAK PERNAH lewat Quill.
function _hasQuillUnsafeMarkup(html) {
  if (!html) return false;
  return /<(table|thead|tbody|tfoot|tr|td|th|colgroup|col|caption|iframe|svg|video|audio|form|object|embed)[\s/>]/i.test(html);
}

// ── Helper: load HTML ke Quill dengan aman ───────────────────
// Menggunakan disable/enable agar MutationObserver Quill tidak
// berlomba dengan innerHTML assignment, lalu force-sync delta.
function _loadContentIntoQuill(html) {
  const q = window._bookQuill;
  if (!q) return;
  const content = (html && html.trim() && html.trim() !== "<p><br></p>")
    ? html
    : "<p><br></p>";
  // Matikan editor sementara untuk mencegah interferensi Quill
  q.enable(false);
  q.root.innerHTML = content;
  q.enable(true);
  // Force-sync delta internal Quill dengan DOM yang baru
  // Gunakan try-catch karena q.update mungkin tidak tersedia di semua versi
  try { q.update(Quill.sources.SILENT); } catch(_) {}
}

// ── Helper terpusat: terapkan mode editor bab (visual/html) ──
// Satu fungsi ini menangani SEMUA aspek switch tampilan: toggle
// display Quill vs textarea, isi konten ke editor yang tepat, dan
// update tombol aktif. Dipakai oleh selectChapter, addChapter,
// deleteChapter, setBookContent, dan tombol toggle Visual/HTML —
// supaya tidak ada lagi logika yang terduplikasi & berbeda-beda.
function _applyChapterEditorMode(mode, content) {
  const isHtml    = mode === "html";
  const htmlTa    = document.getElementById("chapter-html-editor");
  const quillWrap = document.getElementById("bf-content-editor");
  const toolbar   = document.getElementById("bf-content-toolbar");
  const htmlBar   = document.getElementById("html-toolbar");
  const btnVisual = document.getElementById("btn-mode-visual");
  const btnHtml   = document.getElementById("btn-mode-html");

  _editorMode = isHtml ? "html" : "visual";

  if (isHtml) {
    if (htmlTa)    { htmlTa.value = content || ""; htmlTa.style.display = "block"; }
    if (quillWrap) quillWrap.style.display = "none";
    if (toolbar)   toolbar.style.display   = "none";
    if (htmlBar)   htmlBar.classList.add("visible");
  } else {
    _loadContentIntoQuill(content || "");
    if (htmlTa)    htmlTa.style.display    = "none";
    if (quillWrap) quillWrap.style.display = "";
    if (toolbar)   toolbar.style.display   = "";
    if (htmlBar)   htmlBar.classList.remove("visible");
  }

  if (btnVisual) { btnVisual.classList.toggle("active", !isHtml); btnVisual.setAttribute("aria-pressed", String(!isHtml)); }
  if (btnHtml)   { btnHtml.classList.toggle("active", isHtml);    btnHtml.setAttribute("aria-pressed", String(isHtml)); }
}

// ── Helper: switch mode file/write tanpa bergantung event listener ───
function _setContentMode(mode) {
  const isWrite = mode === "write";
  const tabFile    = document.getElementById("tab-file-mode");
  const tabWrite   = document.getElementById("tab-write-mode");
  const panelWrite = document.getElementById("panel-write-mode");
  const modeLabel  = document.getElementById("content-mode-label");

  if (tabFile) {
    tabFile.classList.toggle("active", !isWrite);
    tabFile.setAttribute("aria-selected", String(!isWrite));
  }
  if (tabWrite) {
    tabWrite.classList.toggle("active", isWrite);
    tabWrite.setAttribute("aria-selected", String(isWrite));
  }
  if (panelWrite) panelWrite.style.display = isWrite ? "" : "none";
  if (modeLabel)  modeLabel.textContent    = isWrite ? "Tulis Konten" : "Upload File";
}

// ── Render daftar bab ────────────────────────────────────────
function renderChapterList() {
  const list    = document.getElementById("chapter-list");
  const empty   = document.getElementById("chapter-empty-hint");
  const edWrap  = document.getElementById("chapter-editor-wrap");
  const countEl = document.getElementById("chapter-count-label");

  if (!list) return;

  const n = _chapters.length;
  if (countEl) countEl.textContent = n === 0 ? "Belum ada bab" : `${n} bab`;

  // Hapus item lama (tapi pertahankan elemen empty-hint)
  list.querySelectorAll(".chapter-item").forEach(el => el.remove());

  if (n === 0) {
    if (empty)  empty.style.display  = "";
    if (edWrap) edWrap.style.display = "none";
    _activeChapterId = null;
    return;
  }

  if (empty) empty.style.display = "none";

  // Buat item per bab
  _chapters.forEach((ch, idx) => {
    const isActive = ch.id === _activeChapterId;
    const item     = document.createElement("div");
    item.className = "chapter-item" + (isActive ? " active" : "");
    item.dataset.chapId = ch.id;

    const canUp   = idx > 0;
    const canDown = idx < n - 1;
    const htmlBadge = ch.mode === "html"
      ? `<span class="chapter-mode-badge" title="Bab ini ditulis dalam mode HTML mentah">HTML</span>`
      : "";

    item.innerHTML = `
      <div class="chapter-item-header" role="button" tabindex="0"
           aria-label="Pilih bab ${idx + 1}: ${escapeHtml(ch.title || 'Tanpa Judul')}"
           aria-pressed="${isActive}">
        <span class="chapter-item-num">${idx + 1}</span>
        <span class="chapter-item-title">${escapeHtml(ch.title || "Tanpa Judul")}</span>
        ${htmlBadge}
        <span class="chapter-item-actions">
          <button type="button" class="chapter-btn up"
            title="Pindah ke atas" ${!canUp ? "disabled" : ""} aria-label="Pindah bab ke atas">↑</button>
          <button type="button" class="chapter-btn down"
            title="Pindah ke bawah" ${!canDown ? "disabled" : ""} aria-label="Pindah bab ke bawah">↓</button>
          <button type="button" class="chapter-btn del"
            title="Hapus bab ini" aria-label="Hapus bab ${idx + 1}">✕</button>
        </span>
      </div>`;

    // Pilih bab saat klik header
    const header = item.querySelector(".chapter-item-header");
    header.addEventListener("click", (e) => {
      // Jangan trigger jika klik tombol aksi
      if (e.target.closest(".chapter-item-actions")) return;
      selectChapter(ch.id);
    });
    header.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectChapter(ch.id); }
    });

    // Tombol aksi
    item.querySelector(".chapter-btn.up")?.addEventListener("click", e => {
      e.stopPropagation(); moveChapter(ch.id, -1);
    });
    item.querySelector(".chapter-btn.down")?.addEventListener("click", e => {
      e.stopPropagation(); moveChapter(ch.id, 1);
    });
    item.querySelector(".chapter-btn.del")?.addEventListener("click", e => {
      e.stopPropagation(); deleteChapter(ch.id);
    });

    list.appendChild(item);
  });

  // Tampilkan atau sembunyikan editor
  if (edWrap) edWrap.style.display = _activeChapterId ? "" : "none";
}

// ── Pilih bab aktif ──────────────────────────────────────────
function selectChapter(id) {
  // Simpan konten + mode editor ke bab yang sedang aktif sebelum pindah
  saveActiveChapterContent();

  _activeChapterId = id;
  const ch = _chapters.find(c => c.id === id);
  if (!ch) return;

  // Tentukan mode tampilan bab ini: pakai mode tersimpan, TAPI jika
  // kontennya mengandung markup yang tidak aman untuk Quill (tabel, dll),
  // PAKSA ke mode HTML supaya tidak rusak saat ditampilkan.
  const safeMode = _hasQuillUnsafeMarkup(ch.content) ? "html" : (ch.mode || "visual");
  _applyChapterEditorMode(safeMode, ch.content || "");

  // Update input judul bab
  const titleInput = document.getElementById("chapter-title-input");
  if (titleInput) titleInput.value = ch.title || "";

  renderChapterList();
}

// ── Simpan konten editor ke bab aktif ────────────────────────
function saveActiveChapterContent() {
  if (!_activeChapterId) return;
  const ch = _chapters.find(c => c.id === _activeChapterId);
  if (!ch) return;

  ch.content = getActiveEditorContent();
  ch.mode    = _editorMode;   // simpan mode editor yang sedang dipakai bab ini

  // Simpan judul dari input
  const titleInput = document.getElementById("chapter-title-input");
  if (titleInput) ch.title = titleInput.value.trim() || ch.title;
}

// ── Tambah bab baru ──────────────────────────────────────────
function addChapter() {
  saveActiveChapterContent();

  const newCh = { id: _newChapterId(), title: `Bab ${_chapters.length + 1}`, content: "", mode: "visual" };
  _chapters.push(newCh);

  _activeChapterId = newCh.id;
  renderChapterList();

  // Load bab kosong ke editor (mode visual default)
  _applyChapterEditorMode("visual", "");

  const titleInput = document.getElementById("chapter-title-input");
  if (titleInput) {
    titleInput.value = newCh.title;
    setTimeout(() => titleInput.focus(), 50);
  }

  const edWrap = document.getElementById("chapter-editor-wrap");
  if (edWrap) edWrap.style.display = "";

  showToast(`Bab ${_chapters.length} ditambahkan.`);
}

// ── Hapus bab ────────────────────────────────────────────────
function deleteChapter(id) {
  const ch  = _chapters.find(c => c.id === id);
  const idx = _chapters.findIndex(c => c.id === id);
  const label = ch?.title ? `"${ch.title}"` : `Bab ${idx + 1}`;

  if (!confirmDialog(`Hapus ${label}? Konten bab ini akan dihapus permanen.`)) return;

  // Jika yang dihapus adalah bab aktif, pindah ke bab lain
  if (_activeChapterId === id) {
    const next = _chapters[idx + 1] || _chapters[idx - 1];
    _activeChapterId = next ? next.id : null;
  }

  _chapters.splice(idx, 1);

  // Load bab aktif berikutnya (jika ada), pakai mode tersimpan bab tsb
  if (_activeChapterId) {
    const nextCh = _chapters.find(c => c.id === _activeChapterId);
    if (nextCh) {
      const safeMode = _hasQuillUnsafeMarkup(nextCh.content) ? "html" : (nextCh.mode || "visual");
      _applyChapterEditorMode(safeMode, nextCh.content || "");
      const titleInput = document.getElementById("chapter-title-input");
      if (titleInput) titleInput.value = nextCh.title || "";
    } else {
      _applyChapterEditorMode("visual", "");
    }
  } else {
    _applyChapterEditorMode("visual", "");
  }

  renderChapterList();
  showToast(`${label} dihapus.`);
}

// ── Pindah urutan bab ────────────────────────────────────────
function moveChapter(id, dir) {
  saveActiveChapterContent();
  const idx = _chapters.findIndex(c => c.id === id);
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= _chapters.length) return;

  const temp          = _chapters[idx];
  _chapters[idx]      = _chapters[newIdx];
  _chapters[newIdx]   = temp;

  renderChapterList();
}

// ── Update judul bab aktif saat input berubah ────────────────
function onChapterTitleInput() {
  if (!_activeChapterId) return;
  const ch    = _chapters.find(c => c.id === _activeChapterId);
  const input = document.getElementById("chapter-title-input");
  if (ch && input) {
    ch.title = input.value;
    // Update teks di daftar bab secara langsung
    const item = document.querySelector(`.chapter-item[data-chap-id="${_activeChapterId}"]`);
    if (item) {
      const titleEl = item.querySelector(".chapter-item-title");
      if (titleEl) titleEl.textContent = input.value || "Tanpa Judul";
    }
  }
}

// ── Mode editor: 'visual' | 'html' ───────────────────────────
let _editorMode = "visual";

// Ambil konten bab aktif dari editor yang sedang aktif
function getActiveEditorContent() {
  if (_editorMode === "html") {
    const ta = document.getElementById("chapter-html-editor");
    if (!ta) return "";
    const val = ta.value.trim();
    return (val && val !== "<p><br></p>") ? val : "";
  }
  const q = window._bookQuill;
  if (!q) return "";
  const html = q.root.innerHTML;
  // Normalkan: Quill default "<p><br></p>" dianggap kosong
  return (html && html !== "<p><br></p>" && html.trim() !== "") ? html : "";
}

// ── Quill editor init ────────────────────────────────────────
function initBookContentEditor() {
  if (window._bookQuill) return; // sudah init

  if (typeof Quill === "undefined") {
    console.warn("Quill belum dimuat.");
    return;
  }

  // ── Register custom Divider (HR) blot ─────────────────────
  if (!Quill.imports['formats/divider']) {
    const BlockEmbed = Quill.import('blots/block/embed');
    class DividerBlot extends BlockEmbed {}
    DividerBlot.blotName = 'divider';
    DividerBlot.tagName  = 'hr';
    Quill.register(DividerBlot);
  }

  // ── Register font whitelist ────────────────────────────────
  const Font = Quill.import('formats/font');
  Font.whitelist = ['serif', 'monospace'];
  Quill.register(Font, true);

  // ── Custom clipboard matchers agar tabel dipertahankan saat paste ──
  // Quill 1.3.7 membuang <table> karena tidak punya blot untuk itu.
  // Solusi: intercept di level Clipboard module sebelum Quill memprosesnya,
  // lalu inject HTML tabel langsung ke editor.

  // Simpan referensi convertFromNode asli agar bisa di-restore
  const _ClipboardProto = Quill.import("modules/clipboard").prototype;
  const _origOnPaste    = _ClipboardProto.onPaste;

  window._bookQuill = new Quill("#bf-content-editor", {
    theme:   "snow",
    modules: {
      toolbar: {
        container: "#bf-content-toolbar",
        handlers: {
          hr: function () {
            const quill = this.quill;
            const range = quill.getSelection(true);
            if (!range) return;
            quill.insertEmbed(range.index, 'divider', true, Quill.sources.USER);
            quill.setSelection(range.index + 1, Quill.sources.SILENT);
          },
          table: function () { openTableInsertModal(); },
        },
      },
      clipboard: {
        matchVisual: false,
      },
    },
    placeholder: "Tulis konten bab di sini...",
  });

  // Override onPaste di instance Quill ini saja (tidak global)
  // Cegat paste yang mengandung tabel, inject langsung ke innerHTML
  window._bookQuill.clipboard.onPaste = function(e) {
    const clipData = e.clipboardData || window.clipboardData;
    if (!clipData) return _origOnPaste.call(this, e);

    let html = "";
    try { html = clipData.getData("text/html") || ""; } catch(_) {}

    if (!html || !/<table/i.test(html)) {
      return _origOnPaste.call(this, e);
    }

    // Ada tabel → bypass Quill sepenuhnya
    e.preventDefault();
    e.stopPropagation();

    // Ekstrak fragment jika ada
    const frag = html.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
    const raw  = frag ? frag[1] : html;

    // Parse & sanitasi
    const parser = new DOMParser();
    const doc    = parser.parseFromString(raw, "text/html");
    doc.querySelectorAll("script,style,meta,link").forEach(el => el.remove());
    doc.querySelectorAll("table,thead,tbody,tfoot,tr,th,td").forEach(el => {
      const keep = ["colspan","rowspan"];
      [...el.attributes].forEach(a => { if (!keep.includes(a.name)) el.removeAttribute(a.name); });
    });
    const cleaned = doc.body ? doc.body.innerHTML : raw;

    // Inject ke editor
    const editor  = this.quill.root;
    const isEmpty = !editor.innerHTML || editor.innerHTML === "<p><br></p>";
    editor.innerHTML = (isEmpty ? "" : editor.innerHTML) + cleaned;
    this.quill.update(Quill.sources.USER);

    // Pindahkan kursor ke akhir
    try {
      const sel = window.getSelection();
      const rng = document.createRange();
      rng.selectNodeContents(editor);
      rng.collapse(false);
      sel.removeAllRanges();
      sel.addRange(rng);
    } catch(_) {}
  };

  // ── Modal "Tempel dari Gemini" ────────────────────────────────────
  // Pendekatan via modal textarea: 100% bekerja di mobile Android
  // karena tidak bergantung pada clipboard API (yang sering diblokir browser mobile)

  const _modalPaste   = document.getElementById("modal-paste-gemini");
  const _pasteArea    = document.getElementById("gemini-paste-area");
  const _btnOpenPaste = document.getElementById("btn-paste-gemini");
  const _btnClosePaste= document.getElementById("btn-close-paste-gemini");
  const _btnCancelP   = document.getElementById("btn-cancel-paste-gemini");
  const _btnConfirmP  = document.getElementById("btn-confirm-paste-gemini");

  function _openPasteModal() {
    if (!_modalPaste) return;
    _pasteArea.value = "";
    _modalPaste.style.display = "flex";
    setTimeout(() => _pasteArea.focus(), 100);
  }

  function _closePasteModal() {
    if (!_modalPaste) return;
    _modalPaste.style.display = "none";
    _pasteArea.value = "";
  }

  function _confirmPaste() {
    const raw = _pasteArea.value.trim();
    if (!raw) { _closePasteModal(); return; }

    const quill  = window._bookQuill;
    const editor = quill.root;

    // Deteksi apakah input adalah HTML atau plain text
    const looksLikeHtml = /^\s*<[a-z][\s\S]*>/i.test(raw);

    if (looksLikeHtml) {
      // Input HTML: inject langsung
      const isEmpty = editor.innerHTML.trim() === "<p><br></p>" || editor.innerHTML.trim() === "";
      const before  = isEmpty ? "" : editor.innerHTML;
      editor.innerHTML = before + raw;
      quill.update(Quill.sources.USER);
    } else {
      // Input plain text: gunakan dangerouslyPasteHTML di posisi akhir
      const len = quill.getLength();
      quill.setSelection(len - 1, 0, Quill.sources.SILENT);
      quill.clipboard.dangerouslyPasteHTML(len - 1, "<p>" + raw.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>") + "</p>", Quill.sources.USER);
    }

    _closePasteModal();
  }

  if (_btnOpenPaste)  _btnOpenPaste.addEventListener("click", _openPasteModal);
  if (_btnClosePaste) _btnClosePaste.addEventListener("click", _closePasteModal);
  if (_btnCancelP)    _btnCancelP.addEventListener("click", _closePasteModal);
  if (_btnConfirmP)   _btnConfirmP.addEventListener("click", _confirmPaste);

  // Tutup modal jika klik backdrop
  if (_modalPaste) {
    _modalPaste.addEventListener("click", function(e) {
      if (e.target === _modalPaste) _closePasteModal();
    });
  }

  // ── Input judul bab ───────────────────────────────────────
  document.getElementById("chapter-title-input")
    ?.addEventListener("input", onChapterTitleInput);

  // ── Tombol tambah bab ─────────────────────────────────────
  document.getElementById("btn-add-chapter")
    ?.addEventListener("click", addChapter);

  // ── Toggle tab mode ──────────────────────────────────────
  // Menggunakan _setContentMode() yang didefinisikan di level modul
  // sehingga bisa dipanggil dari mana saja (resetBookContent, setBookContent, dll.)
  document.getElementById("tab-file-mode") ?.addEventListener("click", () => _setContentMode("file"));
  document.getElementById("tab-write-mode")?.addEventListener("click", () => _setContentMode("write"));

  // ── Modal tabel ───────────────────────────────────────────
  initTableInsertModal();

  // ── Pratinjau semua bab ───────────────────────────────────
  document.getElementById("btn-preview-content")?.addEventListener("click", () => {
    saveActiveChapterContent();

    if (!_chapters.length) { showToast("Belum ada bab untuk dipratinjau.", "error"); return; }

    const allEmpty = _chapters.every(ch => !ch.content || ch.content === "<p><br></p>");
    if (allEmpty) { showToast("Semua bab masih kosong.", "error"); return; }

    const bookTitle = document.getElementById("bf-title")?.value?.trim() || "Pratinjau Buku";
    const body      = document.getElementById("preview-content-body");
    const modal     = document.getElementById("content-preview-modal");

    if (body) {
      body.innerHTML = `<h1 style="margin-bottom:24px">${escapeHtml(bookTitle)}</h1>`
        + _chapters.map((ch, i) => `
          <section style="margin-bottom:32px">
            <h2 style="font-size:1.15rem;font-weight:800;margin-bottom:12px;
              padding-bottom:6px;border-bottom:2px solid var(--accent,#E03E0B)">
              ${escapeHtml(ch.title || `Bab ${i + 1}`)}
            </h2>
            ${ch.content || "<p><em>(Bab masih kosong)</em></p>"}
          </section>`).join("");
    }

    if (modal) modal.classList.add("open");
    document.body.style.overflow = "hidden";
  });

  document.getElementById("btn-close-preview")?.addEventListener("click", closeContentPreview);
  document.getElementById("content-preview-modal")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeContentPreview();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeContentPreview();
  });

  // ── Hapus semua bab ───────────────────────────────────────
  document.getElementById("btn-clear-content")?.addEventListener("click", () => {
    if (!_chapters.length) { showToast("Tidak ada bab untuk dihapus.", "error"); return; }
    if (!confirmDialog(`Hapus semua ${_chapters.length} bab? Tindakan ini tidak bisa dibatalkan.`)) return;
    _chapters = [];
    _activeChapterId = null;
    _applyChapterEditorMode("visual", "");
    renderChapterList();
    showToast("Semua bab dihapus.");
  });

  // ── Mode HTML ─────────────────────────────────────────────
  initHtmlModeToggle();
}

// ============================================================
// MODE HTML — Editor Kode Sumber
// ============================================================

function formatHtml(html) {
  // Formatter sederhana: pisah setiap tag block ke baris baru & indentasi
  if (!html) return "";
  const BLOCK = /^(p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|section|article|hr|br|figure|figcaption|pre|code)$/i;
  let depth  = 0;
  const TAB  = "  ";
  // Tokenisasi tag
  const tokens = html
    .replace(/>\s+</g, "><")        // hapus whitespace antar tag
    .replace(/(<[^>]+>)/g, "\n$1\n") // tiap tag di baris sendiri
    .split("\n")
    .map(t => t.trim())
    .filter(Boolean);

  const lines = [];
  for (const tok of tokens) {
    const closeTag  = tok.match(/^<\/([a-z0-9]+)/i);
    const openTag   = tok.match(/^<([a-z0-9]+)/i);
    const selfClose = tok.match(/\/>$/);

    if (closeTag && BLOCK.test(closeTag[1])) {
      depth = Math.max(0, depth - 1);
      lines.push(TAB.repeat(depth) + tok);
    } else if (openTag && BLOCK.test(openTag[1]) && !selfClose) {
      lines.push(TAB.repeat(depth) + tok);
      depth++;
    } else {
      lines.push(TAB.repeat(depth) + tok);
    }
  }
  return lines.join("\n");
}

function wrapSelection(textarea, open, close) {
  const s   = textarea.selectionStart;
  const e   = textarea.selectionEnd;
  const sel = textarea.value.substring(s, e);
  const rep = open + (sel || "teks") + close;
  textarea.value = textarea.value.substring(0, s) + rep + textarea.value.substring(e);
  textarea.focus();
  textarea.selectionStart = s + open.length;
  textarea.selectionEnd   = s + open.length + (sel || "teks").length;
}

function initHtmlModeToggle() {
  const btnVisual  = document.getElementById("btn-mode-visual");
  const btnHtml    = document.getElementById("btn-mode-html");
  const quillWrap  = document.getElementById("bf-content-editor");
  const toolbar    = document.getElementById("bf-content-toolbar");
  const htmlTa     = document.getElementById("chapter-html-editor");
  const htmlBar    = document.getElementById("html-toolbar");

  if (!btnVisual || !btnHtml || !quillWrap || !htmlTa) return;

  // ── Switch ke mode Visual ─────────────────────────────────
  function activateVisual() {
    // PENGAMAN: jika sudah di mode visual, jangan lakukan apa-apa.
    // Tanpa ini, klik ganda/tidak sengaja bisa memuat ulang konten
    // dari Quill yang sebenarnya sudah sinkron, menyebabkan kursor
    // reset atau (dalam kasus lain) menimpa perubahan yang belum
    // tersimpan dengan versi basi.
    if (_editorMode === "visual") return;

    const currentHtml = htmlTa.value.trim();

    // PERINGATAN: jika HTML yang ditulis mengandung markup yang TIDAK
    // didukung Quill (tabel, iframe, dll), pindah ke Visual BERISIKO
    // merusak/menghilangkan bagian tersebut karena Quill tidak bisa
    // merepresentasikannya. Konfirmasi dulu ke pengguna.
    if (_hasQuillUnsafeMarkup(currentHtml)) {
      const lanjut = confirmDialog(
        "Konten HTML ini mengandung tabel atau elemen kompleks yang TIDAK didukung oleh editor Visual.\n\n" +
        "Memindahkan ke mode Visual BERISIKO membuat bagian tersebut hilang/rusak.\n\n" +
        "Tetap lanjutkan ke mode Visual?"
      );
      if (!lanjut) return; // batal — tetap di mode HTML, konten tidak disentuh
    }

    // Update state bab dulu
    if (_activeChapterId) {
      const ch = _chapters.find(c => c.id === _activeChapterId);
      if (ch) { ch.content = currentHtml || ""; ch.mode = "visual"; }
    }

    _applyChapterEditorMode("visual", currentHtml || "");
  }

  // ── Switch ke mode HTML ───────────────────────────────────
  function activateHtml() {
    // PENGAMAN UTAMA: jika sudah di mode HTML, jangan lakukan apa-apa.
    // Ini memperbaiki bug "teks langsung terhapus saat tidak sengaja
    // menekan HTML" — sebelumnya, klik berulang pada tombol ini akan
    // membaca ulang q.root.innerHTML (yang BASI/kosong karena Quill
    // tidak pernah disinkronkan selama mode HTML aktif) dan menimpa
    // textarea, menghapus semua teks yang baru saja diketik.
    if (_editorMode === "html") return;

    // Ambil HTML dari Quill (hanya terjadi sekali, saat transisi visual→html)
    const q    = window._bookQuill;
    const html = (q && q.root.innerHTML !== "<p><br></p>") ? q.root.innerHTML : "";

    // Update state bab — simpan konten Quill ke bab aktif dulu
    if (_activeChapterId) {
      const ch = _chapters.find(c => c.id === _activeChapterId);
      if (ch) { ch.content = html || ""; ch.mode = "html"; }
    }

    _applyChapterEditorMode("html", html);
    htmlTa.focus();
  }

  btnVisual.addEventListener("click", activateVisual);
  btnHtml  .addEventListener("click", activateHtml);

  // ── Toolbar HTML: format & helper tag ────────────────────
  document.getElementById("btn-html-format")?.addEventListener("click", () => {
    if (!htmlTa) return;
    htmlTa.value = formatHtml(htmlTa.value);
    showToast("HTML diformat.");
  });

  document.getElementById("btn-html-copy")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(htmlTa.value)
      .then(() => showToast("HTML disalin ke clipboard."))
      .catch(() => showToast("Gagal menyalin.", "error"));
  });

  // Pasang wrap-tag buttons
  const wrapMap = {
    "btn-html-wrap-p":      ["<p>", "</p>"],
    "btn-html-wrap-h2":     ["<h2>", "</h2>"],
    "btn-html-wrap-h3":     ["<h3>", "</h3>"],
    "btn-html-wrap-strong": ["<strong>", "</strong>"],
    "btn-html-wrap-em":     ["<em>", "</em>"],
    "btn-html-wrap-bq":     ["<blockquote>", "</blockquote>"],
    "btn-html-wrap-a":      ['<a href="">', "</a>"],
    "btn-html-wrap-ul":     ["<ul>\n  <li>", "</li>\n</ul>"],
    "btn-html-wrap-img":    ['<img src="" alt="" loading="lazy">', ""],
  };
  Object.entries(wrapMap).forEach(([btnId, [open, close]]) => {
    document.getElementById(btnId)?.addEventListener("click", () => {
      wrapSelection(htmlTa, open, close);
    });
  });

  // Ctrl+S di textarea HTML → simpan ke bab tanpa pindah mode
  htmlTa.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveActiveChapterContent();
      showToast("Konten bab disimpan.");
    }
    // Tab key → sisipkan 2 spasi
    if (e.key === "Tab") {
      e.preventDefault();
      const s = htmlTa.selectionStart;
      htmlTa.value = htmlTa.value.substring(0, s) + "  " + htmlTa.value.substring(s);
      htmlTa.selectionStart = htmlTa.selectionEnd = s + 2;
    }
  });
}

function closeContentPreview() {
  const modal = document.getElementById("content-preview-modal");
  if (modal) modal.classList.remove("open");
  document.body.style.overflow = "";
}

// ── Getter: gabungkan semua bab menjadi HTML ─────────────────
function getBookContent() {
  saveActiveChapterContent();

  if (!_chapters.length) return null;
  const allEmpty = _chapters.every(ch => !ch.content || ch.content === "<p><br></p>");
  if (allEmpty) return null;

  return _chapters.map((ch, i) =>
    // data-mode disimpan agar saat draft dibuka kembali, bab yang
    // ditulis sebagai HTML mentah TETAP dibuka di mode HTML — bukan
    // dipaksa lewat Quill (yang berisiko merusak markup seperti tabel).
    `<section class="buku-bab" data-bab="${i + 1}" data-mode="${ch.mode === 'html' ? 'html' : 'visual'}">` +
    `<h2 class="bab-judul">${escapeHtml(ch.title || `Bab ${i + 1}`)}</h2>` +
    `<div class="bab-isi">${ch.content || ""}</div>` +
    `</section>`
  ).join("\n");
}

// ── Setter: urai HTML menjadi daftar bab ─────────────────────
function setBookContent(html) {
  _chapters = [];
  _activeChapterId = null;
  _chapterCounter  = 0;

  if (!html || html.trim() === "") {
    renderChapterList();
    _setContentMode("file");
    return;
  }

  // Coba parse struktur bab
  const parser   = new DOMParser();
  const doc      = parser.parseFromString(html, "text/html");
  const sections = doc.querySelectorAll("section.buku-bab");

  if (sections.length) {
    sections.forEach(sec => {
      const title     = sec.querySelector(".bab-judul")?.textContent?.trim() || "";
      const isiEl     = sec.querySelector(".bab-isi");
      const content   = isiEl ? isiEl.innerHTML : "";
      const savedMode = sec.getAttribute("data-mode");
      // Tentukan mode: hormati mode tersimpan, TAPI kalau kontennya
      // mengandung markup yang TIDAK aman buat Quill (tabel, dll),
      // PAKSA ke mode HTML — ini jaring pengaman utama supaya konten
      // semacam itu tidak pernah disentuh Quill sama sekali.
      const mode = _hasQuillUnsafeMarkup(content) ? "html" : (savedMode === "html" ? "html" : "visual");
      _chapters.push({ id: _newChapterId(), title, content, mode });
    });
  } else {
    // Konten lama tanpa struktur bab → jadikan satu bab
    const mode = _hasQuillUnsafeMarkup(html) ? "html" : "visual";
    _chapters.push({ id: _newChapterId(), title: "Konten", content: html, mode });
  }

  if (_chapters.length) {
    _activeChapterId = _chapters[0].id;
    const first = _chapters[0];

    // Gunakan satu setTimeout saja — cukup untuk menunggu Quill siap
    setTimeout(() => {
      // Tampilkan bab pertama sesuai mode aslinya. Jika mode-nya "html",
      // ini TIDAK PERNAH menyentuh Quill — textarea diisi langsung,
      // sehingga konten 100% aman dari proses internal Quill.
      _applyChapterEditorMode(first.mode || "visual", first.content || "");

      // Update judul bab
      const titleInput = document.getElementById("chapter-title-input");
      if (titleInput) titleInput.value = first.title || "";

      // Render daftar bab & switch ke mode tulis
      renderChapterList();
      _setContentMode("write");

      // Pastikan editor wrap terlihat
      const edWrap = document.getElementById("chapter-editor-wrap");
      if (edWrap) edWrap.style.display = "";
    }, 80);
  } else {
    renderChapterList();
    _setContentMode("file");
  }
}

// ── Reset semua bab ──────────────────────────────────────────
function resetBookContent() {
  _chapters        = [];
  _activeChapterId = null;
  _chapterCounter  = 0;

  // Reset tampilan editor ke kondisi awal (visual, kosong) lewat
  // helper terpusat — otomatis aman walau Quill belum ter-init.
  try {
    _applyChapterEditorMode("visual", "");
  } catch(_) {
    // Quill belum sepenuhnya siap pada pemanggilan pertama — abaikan
  }

  renderChapterList();
  // Switch ke mode file secara langsung (tidak bergantung pada event listener)
  _setContentMode("file");
}

// ============================================================
// MODAL SISIPKAN TABEL
// ============================================================

let _tblRows = 3;
let _tblCols = 3;
const TBL_MIN = 1;
const TBL_MAX = 10;

function openTableInsertModal() {
  _tblRows = 3;
  _tblCols = 3;
  updateTableModal();
  const modal = document.getElementById("tbl-insert-modal");
  if (modal) { modal.classList.add("open"); document.body.style.overflow = "hidden"; }
}

function closeTableInsertModal() {
  const modal = document.getElementById("tbl-insert-modal");
  if (modal) { modal.classList.remove("open"); document.body.style.overflow = ""; }
}

function updateTableModal() {
  const rowEl  = document.getElementById("tbl-row-val");
  const colEl  = document.getElementById("tbl-col-val");
  const preview = document.getElementById("tbl-grid-preview");
  if (rowEl) rowEl.textContent = _tblRows;
  if (colEl) colEl.textContent = _tblCols;

  // Pratinjau mini grid
  if (preview) {
    preview.style.gridTemplateColumns = `repeat(${_tblCols}, 1fr)`;
    preview.innerHTML = "";
    const total = _tblRows * _tblCols;
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      cell.className = "tbl-preview-cell";
      preview.appendChild(cell);
    }
  }
}

function insertTableIntoQuill(rows, cols) {
  const quill = window._bookQuill;
  if (!quill) return;

  const range = quill.getSelection(true);
  const idx   = range ? range.index : quill.getLength();

  // Bangun HTML tabel
  let html = '<table><tbody>';
  // Baris header
  html += '<tr>';
  for (let c = 0; c < cols; c++) {
    html += `<th>Kolom ${c + 1}</th>`;
  }
  html += '</tr>';
  // Baris data
  for (let r = 1; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += '<td>&nbsp;</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table><p><br></p>';

  quill.clipboard.dangerouslyPasteHTML(idx, html, Quill.sources.USER);
  quill.setSelection(idx + 1, 0, Quill.sources.SILENT);
  showToast(`Tabel ${rows}×${cols} berhasil disisipkan.`);
}

function initTableInsertModal() {
  document.getElementById("tbl-row-inc")?.addEventListener("click", () => {
    if (_tblRows < TBL_MAX) { _tblRows++; updateTableModal(); }
  });
  document.getElementById("tbl-row-dec")?.addEventListener("click", () => {
    if (_tblRows > TBL_MIN) { _tblRows--; updateTableModal(); }
  });
  document.getElementById("tbl-col-inc")?.addEventListener("click", () => {
    if (_tblCols < TBL_MAX) { _tblCols++; updateTableModal(); }
  });
  document.getElementById("tbl-col-dec")?.addEventListener("click", () => {
    if (_tblCols > TBL_MIN) { _tblCols--; updateTableModal(); }
  });
  document.getElementById("btn-confirm-tbl")?.addEventListener("click", () => {
    closeTableInsertModal();
    insertTableIntoQuill(_tblRows, _tblCols);
  });
  document.getElementById("btn-cancel-tbl")?.addEventListener("click", closeTableInsertModal);
  document.getElementById("btn-close-tbl-modal")?.addEventListener("click", closeTableInsertModal);
  document.getElementById("tbl-insert-modal")?.addEventListener("click", e => {
    if (e.target === e.currentTarget) closeTableInsertModal();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeTableInsertModal();
  });
}

async function handleCoverFile(file) {
  if (!file.type.startsWith("image/")) { showToast("File harus berupa gambar (JPG, PNG, WebP).", "error"); return; }
  if (file.size > R2_MAX_IMG) { showToast("Ukuran gambar maksimal 5 MB.", "error"); return; }
  setUploadProgress("cover", 10, true);
  try {
    const result = await uploadToR2(file, "covers");
    const urlEl  = document.getElementById("bf-cover-url");
    if (urlEl) urlEl.value = result.url;
    showCoverPreview(result.url);
    setUploadProgress("cover", 100, false);
    showToast("Sampul berhasil diupload.");
  } catch (e) {
    setUploadProgress("cover", 0, false);
    showToast("Upload sampul gagal: " + e.message, "error");
  }
}

function initBookFileUpload() {
  const input = document.getElementById("book-file-input");
  const area  = document.getElementById("file-upload-area");
  if (!area || !input) return;
  area.addEventListener("click", () => input.click());
  area.addEventListener("dragover",  e => { e.preventDefault(); area.classList.add("drag-over"); });
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", e => {
    e.preventDefault(); area.classList.remove("drag-over");
    const f = e.dataTransfer?.files?.[0]; if (f) handleBookFile(f);
  });
  input.addEventListener("change", () => {
    const f = input.files?.[0]; if (f) handleBookFile(f); input.value = "";
  });
}

async function handleBookFile(file) {
  if (file.size > R2_MAX_FILE) { showToast("Ukuran file maksimal 100 MB.", "error"); return; }
  setUploadProgress("file", 10, true);
  try {
    const result = await uploadToR2(file, "books");
    const urlEl  = document.getElementById("bf-file-url");
    const sizeEl = document.getElementById("bf-file-size");
    const typeEl = document.getElementById("bf-file-type");
    if (urlEl)  urlEl.value  = result.url;
    if (sizeEl) sizeEl.value = result.size || file.size;
    const ext = file.name.split(".").pop().toLowerCase();
    if (typeEl && ["pdf","epub","mobi","docx","doc","txt"].includes(ext)) typeEl.value = ext;
    showFileInfo(file.name, result.size || file.size);
    setUploadProgress("file", 100, false);
    showToast("File berhasil diupload.");
  } catch (e) {
    setUploadProgress("file", 0, false);
    showToast("Upload file gagal: " + e.message, "error");
  }
}

function setUploadProgress(type, pct, show) {
  const wrap = document.getElementById(`${type}-upload-progress`);
  const fill = document.getElementById(`${type}-upload-fill`);
  const pctEl = document.getElementById(`${type}-upload-pct`);
  if (wrap) wrap.style.display = show ? "flex" : "none";
  if (fill) fill.style.width = pct + "%";
  if (pctEl) pctEl.textContent = pct + "%";
}

function showCoverPreview(url) {
  const wrap = document.getElementById("cover-preview-wrap");
  const img  = document.getElementById("cover-preview-img");
  if (wrap) wrap.style.display = "flex";
  if (img)  img.src = url;
}

function hideCoverPreview() {
  const wrap = document.getElementById("cover-preview-wrap");
  const img  = document.getElementById("cover-preview-img");
  if (wrap) wrap.style.display = "none";
  if (img)  img.src = "";
  const urlEl = document.getElementById("bf-cover-url");
  if (urlEl) urlEl.value = "";
}

function showFileInfo(name, size) {
  const info   = document.getElementById("book-file-info");
  const nameEl = document.getElementById("file-info-name");
  const sizeEl = document.getElementById("file-info-size");
  if (info)   info.style.display  = "flex";
  if (nameEl) nameEl.textContent  = name;
  if (sizeEl) sizeEl.textContent  = size ? formatFileSize(size) : "";
}

function hideFileInfo() {
  const info = document.getElementById("book-file-info");
  if (info) info.style.display = "none";
  const urlEl  = document.getElementById("bf-file-url");
  const sizeEl = document.getElementById("bf-file-size");
  if (urlEl)  urlEl.value  = "";
  if (sizeEl) sizeEl.value = "";
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(1) + " MB";
  if (bytes >= 1_024)     return Math.round(bytes / 1_024) + " KB";
  return bytes + " B";
}

function initBookFormBindings() {
  const titleInput = document.getElementById("bf-title");
  const slugInput  = document.getElementById("bf-slug");

  titleInput?.addEventListener("input", () => {
    if (slugInput && !slugInput.dataset.manual) {
      slugInput.value = slugify(titleInput.value);
    }
  });
  slugInput?.addEventListener("input", () => {
    if (slugInput) slugInput.dataset.manual = "1";
  });

  // Auto-slug genre
  document.getElementById("bg-form-name")?.addEventListener("input", function () {
    if (!document.getElementById("bg-form-id")?.value) {
      const sl = document.getElementById("bg-form-slug");
      if (sl) sl.value = slugify(this.value);
    }
  });

  // Cover URL manual → update preview
  document.getElementById("bf-cover-url")?.addEventListener("input", function () {
    if (this.value) showCoverPreview(this.value);
    else hideCoverPreview();
  });
}
