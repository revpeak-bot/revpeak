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
  $("#book-search")?.addEventListener("input", () => {
    clearTimeout(window._bookSearchTimer);
    window._bookSearchTimer = setTimeout(() => {
      bookFilter.search = document.getElementById("book-search")?.value.trim() || "";
      loadBookList(1);
    }, 600);
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
    cachedBookGenres = await dbFetch("/book_genres?select=id,name,slug&order=name.asc") || [];
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
    let path = `/books?select=id,title,slug,author,genre,file_type,status,view_count,cover_url`
      + `&order=created_at.desc&limit=${bookLimit}&offset=${(page - 1) * bookLimit}`;

    if (bookFilter.status) path += `&status=eq.${bookFilter.status}`;
    if (bookFilter.format) path += `&file_type=eq.${bookFilter.format}`;
    if (bookFilter.search) {
      path += `&or=(title.ilike.*${encodeURIComponent(bookFilter.search)}*,author.ilike.*${encodeURIComponent(bookFilter.search)}*)`;
    }

    const books = await dbFetch(path);

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
  showView("book-form");
  const titleEl = document.getElementById("topbar-title");
  if (titleEl) titleEl.textContent = "Tambah Buku";
  document.getElementById("bf-title")?.focus();
}

async function openEditBookForm(id) {
  showToast("Memuat data buku...", "info");
  await loadBookGenreCache();
  resetBookForm();
  try {
    const books = await dbFetch(`/books?id=eq.${id}&select=*&limit=1`);
    if (!books || !books.length) { showToast("Buku tidak ditemukan.", "error"); return; }
    fillBookForm(books[0]);
    populateBookGenreSelect(books[0].genre_id);
  } catch (e) { showToast("Gagal memuat buku: " + e.message, "error"); return; }
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
    updated_at  : new Date().toISOString(),
    ...(genreId ? { genre_id: Number(genreId), genre: genreName } : {}),
  };

  const btn = document.getElementById("btn-submit-book");
  if (btn) { btn.disabled = true; btn.textContent = "Menyimpan..."; }

  try {
    if (id) {
      await dbFetch(`/books?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify(payload) });
      showToast("Buku berhasil diperbarui.");
    } else {
      payload.created_at    = new Date().toISOString();
      payload.view_count    = 0;
      payload.download_count = 0;
      await dbFetch("/books", { method: "POST", body: JSON.stringify(payload) });
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
    const bookData = await dbFetch(`/books?id=eq.${id}&select=cover_url,file_url&limit=1`);
    const fileUrls = [bookData?.[0]?.cover_url, bookData?.[0]?.file_url]
      .filter(url => url && typeof url === "string" && url.trim() !== "");

    // 2. Hapus record dari Supabase
    await dbFetch(`/books?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });

    // 3. Hapus file dari R2 (fire-and-forget — tidak memblokir UI)
    if (fileUrls.length) {
      const token = await getValidToken();
      fetch(`${API_BASE}/api/r2/delete`, {
        method:  "DELETE",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ urls: fileUrls }),
      }).catch(() => {}); // tidak fatal jika gagal
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
    const genres = await dbFetch("/book_genres?select=id,name,slug,description&order=name.asc");
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
    if (id) {
      await dbFetch(`/book_genres?id=eq.${id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ name, slug, description: desc || null }) });
      showToast("Genre diperbarui.");
    } else {
      await dbFetch("/book_genres", { method: "POST", body: JSON.stringify({ name, slug, description: desc || null }) });
      showToast("Genre ditambahkan.");
    }
    resetBookGenreForm();
    loadBookGenreList();
  } catch (e) { showToast("Gagal: " + e.message, "error"); }
}

async function deleteBookGenre(id, name) {
  if (!confirmDialog(`Hapus genre "${name}"?`)) return;
  try {
    await dbFetch(`/book_genres?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" });
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
