// ============================================================
// REVPEAK — admin.js
// Admin panel untuk manajemen artikel & berita
// ============================================================

const API_BASE     = "https://revpeak-api.revpeak2.workers.dev";
const SUPABASE_URL = "https://xfzqfowijriurfnheakg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmenFmb3dpanJpdXJmbmhlYWtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTIzMzMsImV4cCI6MjA5MDM2ODMzM30.W5r5w3duNpVMo6NgPfHLhrb7jl32ksMGTQDBfT1MbVY
"; // anon key (untuk admin login)

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

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!res.ok) { clearSession(); return null; }
  const data = await res.json();
  saveSession(data);
  return data;
}

async function getValidToken() {
  let session = getSession();
  if (!session) return null;

  // Cek apakah token sudah expired (buffer 60 detik)
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && now >= session.expires_at - 60) {
    session = await refreshSession();
  }

  return session?.access_token || null;
}

async function supabaseAuth(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error_description || "Login gagal");
  }
  return res.json();
}

async function supabaseLogout(token) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${token}`,
    },
  });
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

  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers,
  });

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
    title:       $("#f-title")?.value || "",
    slug:        $("#f-slug")?.value  || "",
    excerpt:     $("#f-excerpt")?.value || "",
    content:     $("#f-content")?.value || "",
    post_type:   $("#f-type")?.value  || "article",
    category_id: $("#f-category")?.value || "",
    author_id:   $("#f-author")?.value   || "",
    tags:        $("#f-tags")?.value     || "",
    status:      $("#f-status")?.value   || "draft",
    thumbnail_url: $("#f-thumbnail")?.value || "",
    thumbnail_alt: $("#f-thumbnail-alt")?.value || "",
    savedAt:     new Date().toISOString(),
    editingId:   form.dataset.editingId || "",
  };

  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  const indicator = $("#autosave-indicator");
  if (indicator) {
    indicator.textContent = `Draft tersimpan ${new Date().toLocaleTimeString("id-ID")}`;
    indicator.className = "autosave-indicator saved";
  }
}

function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY));
  } catch { return null; }
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  const indicator = $("#autosave-indicator");
  if (indicator) { indicator.textContent = ""; indicator.className = "autosave-indicator"; }
}

function startAutosave() {
  if (autosaveTimer) clearInterval(autosaveTimer);
  autosaveTimer = setInterval(saveDraft, 30000); // setiap 30 detik
}

function debounceSave() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(saveDraft, 3000); // 3 detik setelah berhenti mengetik
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

  tbody.innerHTML = `<tr><td colspan="6" class="table-loading" aria-live="polite">Memuat data...</td></tr>`;

  try {
    let path = `/articles?select=id,title,slug,post_type,status,published_at,view_count,categories(name)&order=created_at.desc&limit=${listLimit}&offset=${(page - 1) * listLimit}`;

    if (listFilter.type)   path += `&post_type=eq.${listFilter.type}`;
    if (listFilter.status) path += `&status=eq.${listFilter.status}`;
    if (listFilter.search) path += `&title=ilike.*${encodeURIComponent(listFilter.search)}*`;

    const articles = await dbFetch(path);

    if (!articles.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="table-empty">Tidak ada data.</td></tr>`;
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
          <span class="badge ${a.post_type === "news" ? "badge-news" : "badge-article"}">
            ${a.post_type === "news" ? "Berita" : "Artikel"}
          </span>
        </td>
        <td>${escapeHtml(a.categories?.name || "-")}</td>
        <td>
          <span class="status-badge status-${a.status}">
            ${a.status === "published" ? "Terbit" : "Draft"}
          </span>
        </td>
        <td class="td-date">${formatDate(a.published_at)}</td>
        <td class="td-actions">
          <button class="btn-icon btn-edit" data-id="${a.id}" aria-label="Edit ${escapeHtml(a.title)}">
            ✏️
          </button>
          <button class="btn-icon btn-delete" data-id="${a.id}" data-title="${escapeHtml(a.title)}" aria-label="Hapus ${escapeHtml(a.title)}">
            🗑️
          </button>
        </td>
      </tr>`).join("");

    // Bind edit & delete
    tbody.querySelectorAll(".btn-edit").forEach(btn => {
      btn.addEventListener("click", () => openEditForm(btn.dataset.id));
    });
    tbody.querySelectorAll(".btn-delete").forEach(btn => {
      btn.addEventListener("click", () => deleteArticle(btn.dataset.id, btn.dataset.title));
    });

    // Pagination
    renderListPagination(articles.length);

  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-error" role="alert">Gagal memuat: ${escapeHtml(e.message)}</td></tr>`;
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

  if (!prevDisabled) $("#btn-prev-page").addEventListener("click", () => loadArticleList(listPage - 1));
  if (!nextDisabled) $("#btn-next-page").addEventListener("click", () => loadArticleList(listPage + 1));
}

// ============================================================
// HALAMAN: FORM ARTIKEL (Tambah / Edit)
// ============================================================

function showView(viewId) {
  $$(".admin-view").forEach(v => v.hidden = true);
  const target = $(`#view-${viewId}`);
  if (target) target.hidden = false;
}

async function openNewForm() {
  await loadDropdownData();
  resetForm();

  // Tawarkan draft tersimpan
  const draft = loadDraft();
  if (draft && !draft.editingId) {
    const useDraft = confirm(`Ada draft tersimpan pada ${formatDate(draft.savedAt)}.\nMau dilanjutkan?`);
    if (useDraft) fillFormFromDraft(draft);
  }

  startAutosave();
  showView("form");
  $("#f-title")?.focus();
}

async function openEditForm(id) {
  await loadDropdownData();
  resetForm();

  try {
    const articles = await dbFetch(`/articles?id=eq.${id}&select=*&limit=1`);
    if (!articles.length) { showToast("Artikel tidak ditemukan.", "error"); return; }

    const article = articles[0];
    const form    = $("#article-form");
    if (form) form.dataset.editingId = id;

    fillFormFromArticle(article);
    populateDropdowns(article);

    showView("form");
    startAutosave();
    $("#f-title")?.focus();
  } catch (e) {
    showToast("Gagal memuat artikel: " + e.message, "error");
  }
}

function resetForm() {
  const form = $("#article-form");
  if (!form) return;

  form.reset();
  delete form.dataset.editingId;
  clearDraft();

  $("#f-slug").value  = "";
  $("#f-status").value = "draft";
  $("#f-type").value  = "article";

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

  if (draft.category_id) {
    const catEl = $("#f-category");
    if (catEl) catEl.value = draft.category_id;
  }
  if (draft.author_id) {
    const authorEl = $("#f-author");
    if (authorEl) authorEl.value = draft.author_id;
  }
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
        method: "PATCH",
        prefer: "return=minimal",
        body: JSON.stringify(data),
      });
      showToast("Artikel berhasil diperbarui.");
    } else {
      await dbFetch("/articles", {
        method: "POST",
        body: JSON.stringify(data),
      });
      showToast("Artikel berhasil diterbitkan.");
    }

    clearDraft();
    if (autosaveTimer) clearInterval(autosaveTimer);
    showView("list");
    loadArticleList(1);

  } catch (err) {
    showToast("Gagal menyimpan: " + err.message, "error");
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Simpan"; }
  }
}

async function deleteArticle(id, title) {
  if (!confirmDialog(`Hapus artikel "${title}"?\nTindakan ini tidak bisa dibatalkan.`)) return;

  try {
    await dbFetch(`/articles?id=eq.${id}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
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

  tbody.innerHTML = `<tr><td colspan="3" class="table-loading">Memuat...</td></tr>`;

  try {
    const cats = await dbFetch("/categories?select=id,name,slug,description&order=name.asc");

    if (!cats.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="table-empty">Belum ada kategori.</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="3" class="table-error" role="alert">Gagal memuat: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function openCategoryForm(data = {}) {
  $("#cat-form-id").value   = data.id   || "";
  $("#cat-form-name").value = data.name || "";
  $("#cat-form-slug").value = data.slug || "";
  $("#cat-form-desc").value = data.desc || "";
  $("#category-form-section").hidden = false;
  $("#cat-form-name").focus();
}

function resetCategoryForm() {
  $("#cat-form-id").value   = "";
  $("#cat-form-name").value = "";
  $("#cat-form-slug").value = "";
  $("#cat-form-desc").value = "";
  $("#category-form-section").hidden = true;
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

  tbody.innerHTML = `<tr><td colspan="3" class="table-loading">Memuat...</td></tr>`;

  try {
    const authors = await dbFetch("/authors?select=id,name,slug,bio,avatar_url&order=name.asc");

    if (!authors.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="table-empty">Belum ada penulis.</td></tr>`;
      return;
    }

    tbody.innerHTML = authors.map(a => `
      <tr>
        <td>
          <div class="author-cell">
            ${a.avatar_url ? `<img src="${escapeHtml(a.avatar_url)}" class="author-thumb" alt="${escapeHtml(a.name)}" loading="lazy">` : `<div class="author-thumb-placeholder">${escapeHtml(a.name.charAt(0))}</div>`}
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
    tbody.innerHTML = `<tr><td colspan="3" class="table-error" role="alert">Gagal: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function openAuthorForm(data = {}) {
  $("#author-form-id").value     = data.id     || "";
  $("#author-form-name").value   = data.name   || "";
  $("#author-form-slug").value   = data.slug   || "";
  $("#author-form-bio").value    = data.bio    || "";
  $("#author-form-avatar").value = data.avatar || "";
  $("#author-form-section").hidden = false;
  $("#author-form-name").focus();
}

function resetAuthorForm() {
  $$([
    "#author-form-id", "#author-form-name", "#author-form-slug",
    "#author-form-bio", "#author-form-avatar"
  ].join(",")).forEach(el => el.value = "");
  $("#author-form-section").hidden = true;
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
// ============================================================

async function initLogin() {
  const loginSection = $("#login-section");
  const appSection   = $("#app-section");

  // Cek sesi tersimpan
  const token = await getValidToken();
  if (token) {
    loginSection.hidden = true;
    appSection.hidden   = false;
    initApp();
    return;
  }

  loginSection.hidden = false;
  appSection.hidden   = true;

  const form = $("#login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email    = $("#login-email").value.trim();
    const password = $("#login-password").value;
    const btn      = $("#btn-login");
    const errEl    = $("#login-error");

    btn.disabled    = true;
    btn.textContent = "Masuk...";
    if (errEl) errEl.textContent = "";

    try {
      const session = await supabaseAuth(email, password);
      saveSession(session);
      loginSection.hidden = true;
      appSection.hidden   = false;
      initApp();
    } catch (err) {
      if (errEl) errEl.textContent = err.message;
      else showToast(err.message, "error");
    } finally {
      btn.disabled    = false;
      btn.textContent = "Masuk";
    }
  });
}

async function handleLogout() {
  const token = await getValidToken();
  if (token) await supabaseLogout(token).catch(() => {});
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
      showView("list"); // default reset ke list view

      if (target === "articles") {
        loadArticleList(1);
      } else if (target === "categories") {
        showView("categories");
        loadCategories();
      } else if (target === "authors") {
        showView("authors");
        loadAuthors();
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
  const searchBtn    = $("#btn-filter-search");

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

  searchBtn?.addEventListener("click", doSearch);
  searchInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
}

// ============================================================
// FORM: AUTO-SLUG & INPUT BINDINGS
// ============================================================

function initFormBindings() {
  const titleInput = $("#f-title");
  const slugInput  = $("#f-slug");

  // Auto-generate slug dari judul (hanya jika slug masih kosong)
  titleInput?.addEventListener("input", () => {
    if (!slugInput.dataset.manual) {
      slugInput.value = slugify(titleInput.value);
    }
    debounceSave();
  });

  // Tandai slug sebagai manual jika user mengeditnya sendiri
  slugInput?.addEventListener("input", () => {
    slugInput.dataset.manual = "1";
    debounceSave();
  });

  // Debounce autosave untuk semua field lain
  ["#f-excerpt","#f-content","#f-thumbnail","#f-thumbnail-alt","#f-tags"].forEach(sel => {
    $(sel)?.addEventListener("input", debounceSave);
  });
  ["#f-type","#f-status","#f-category","#f-author"].forEach(sel => {
    $(sel)?.addEventListener("change", debounceSave);
  });

  // Auto-slug untuk form kategori
  $("#cat-form-name")?.addEventListener("input", function () {
    if (!$("#cat-form-id").value) {
      $("#cat-form-slug").value = slugify(this.value);
    }
  });

  // Auto-slug untuk form penulis
  $("#author-form-name")?.addEventListener("input", function () {
    if (!$("#author-form-id").value) {
      $("#author-form-slug").value = slugify(this.value);
    }
  });
}

// ============================================================
// INIT APP (setelah login)
// ============================================================

function initApp() {
  initNavTabs();
  initListFilters();
  initFormBindings();

  // Tombol tambah artikel baru
  $("#btn-new-article")?.addEventListener("click", openNewForm);

  // Tombol kembali ke list
  $$("[data-back-to-list]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (autosaveTimer) clearInterval(autosaveTimer);
      showView("list");
      loadArticleList(listPage);
    });
  });

  // Submit form artikel
  $("#article-form")?.addEventListener("submit", submitArticleForm);

  // Submit form kategori
  $("#category-form")?.addEventListener("submit", submitCategoryForm);
  $("#btn-cancel-cat")?.addEventListener("click", resetCategoryForm);
  $("#btn-new-category")?.addEventListener("click", () => openCategoryForm());

  // Submit form penulis
  $("#author-form")?.addEventListener("submit", submitAuthorForm);
  $("#btn-cancel-author")?.addEventListener("click", resetAuthorForm);
  $("#btn-new-author")?.addEventListener("click", () => openAuthorForm());

  // Logout
  $("#btn-logout")?.addEventListener("click", handleLogout);

  // Muat list artikel pertama kali
  loadArticleList(1);
}

// ============================================================
// INIT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  initLogin();
});
