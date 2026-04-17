/* ===========================================
   REVPEAK ADMIN — admin.js
   Auth: Supabase Authentication
   WAJIB ISI: SUPABASE_URL dan SUPABASE_ANON_KEY
=========================================== */

const SUPABASE_URL      = 'https://efaniqeslqtdfeblgffl.supabase.co'; // Ganti ini
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmYW5pcWVzbHF0ZGZlYmxnZmZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjgxNTcsImV4cCI6MjA4ODkwNDE1N30.sVs4XEO1jnv6E8PSELug0s0So4lteV-O9QcPUGLasao'; // Ganti ini

const SUPA_HEADERS = {
  'apikey':        SUPABASE_ANON_KEY,
  'Content-Type':  'application/json',
};

let AUTH_TOKEN   = null;
let currentUser  = null;
let allCategories = [];

const PAGE_SIZE  = 15;
let kontenPage   = 0;
let kontenTotal  = 0;

/* ============================================================
   SUPABASE HELPERS
============================================================ */
function authHeaders() {
  return { ...SUPA_HEADERS, 'Authorization': `Bearer ${AUTH_TOKEN}` };
}

async function supaGet(table, query = '') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, { headers: authHeaders() });
  return r.json();
}

async function supaInsert(table, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(data),
  });
  return { ok: r.ok, data: await r.json() };
}

async function supaUpdate(table, id, data) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(data),
  });
  return { ok: r.ok, data: await r.json() };
}

async function supaDelete(table, id) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return r.ok;
}

/* ============================================================
   AUTH
============================================================ */
async function login() {
  const email    = val('login-email');
  const password = val('login-password');
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('btn-login');

  if (!email || !password) { showLoginError('Email dan password wajib diisi.'); return; }

  btn.textContent = 'Memuat...';
  btn.disabled    = true;

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { ...SUPA_HEADERS },
      body:    JSON.stringify({ email, password }),
    });
    const data = await r.json();

    if (!r.ok || !data.access_token) {
      showLoginError(data.error_description || data.msg || 'Email atau password salah.');
      btn.textContent = 'Masuk →';
      btn.disabled    = false;
      return;
    }

    AUTH_TOKEN  = data.access_token;
    currentUser = data.user;
    localStorage.setItem('rp-admin-token', AUTH_TOKEN);
    localStorage.setItem('rp-admin-refresh', data.refresh_token);
    localStorage.setItem('rp-admin-email', email);
    enterApp(email);

  } catch (e) {
    showLoginError('Gagal terhubung. Cek koneksi internet.');
    btn.textContent = 'Masuk →';
    btn.disabled    = false;
  }
}

async function checkSession() {
  const token = localStorage.getItem('rp-admin-token');
  if (!token) return false;

  // Verify token
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { ...SUPA_HEADERS, 'Authorization': `Bearer ${token}` },
  });

  if (r.ok) {
    AUTH_TOKEN  = token;
    currentUser = await r.json();
    return true;
  }

  // Token expired — coba refresh otomatis
  const refreshToken = localStorage.getItem('rp-admin-refresh');
  if (!refreshToken) {
    localStorage.removeItem('rp-admin-token');
    return false;
  }

  try {
    const rr = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method:  'POST',
      headers: { ...SUPA_HEADERS },
      body:    JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await rr.json();

    if (!rr.ok || !data.access_token) {
      localStorage.removeItem('rp-admin-token');
      localStorage.removeItem('rp-admin-refresh');
      return false;
    }

    AUTH_TOKEN  = data.access_token;
    currentUser = data.user;
    localStorage.setItem('rp-admin-token',   AUTH_TOKEN);
    localStorage.setItem('rp-admin-refresh',  data.refresh_token);
    return true;
  } catch {
    localStorage.removeItem('rp-admin-token');
    localStorage.removeItem('rp-admin-refresh');
    return false;
  }
}

function enterApp(email) {
  document.getElementById('login-screen').style.display  = 'none';
  document.getElementById('admin-wrap').style.display    = 'flex';
  // Set user info
  const name = email.split('@')[0];
  const nameEl = document.getElementById('user-name');
  const avEl   = document.getElementById('user-av');
  if (nameEl) nameEl.textContent = name;
  if (avEl)   avEl.textContent   = name.charAt(0).toUpperCase();
  initApp();
}

function logout() {
  localStorage.removeItem('rp-admin-token');
  localStorage.removeItem('rp-admin-refresh');
  localStorage.removeItem('rp-admin-email');
  AUTH_TOKEN  = null;
  currentUser = null;
  document.getElementById('admin-wrap').style.display    = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = '⚠️ ' + msg;
  el.classList.add('show');
}

/* ============================================================
   APP INIT
============================================================ */
async function initApp() {
  await loadCategories();
  loadDashboard();
  loadKonten();
  loadKategoriPage();
  loadTokoh();
  initSidebar();
  initTheme();
  initSearch();
}

/* ============================================================
   SIDEBAR & NAVIGATION
============================================================ */
function initSidebar() {
  // Nav items
  document.querySelectorAll('.snav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      showPage(btn.dataset.page);
      closeSidebar();
    });
  });

  document.getElementById('btn-hamburger')?.addEventListener('click', openSidebar);
  document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay')?.addEventListener('click', closeSidebar);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
}

function showPage(name) {
  document.querySelectorAll('.apage').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.snav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${name}`)?.classList.add('active');
  document.querySelector(`.snav-item[data-page="${name}"]`)?.classList.add('active');
  const titles = { dashboard:'Dashboard', konten:'Konten', kategori:'Kategori', tokoh:'Tokoh' };
  const ttl = document.getElementById('topbar-title');
  if (ttl) ttl.textContent = titles[name] || name;
}

function openSidebar() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('sidebar-overlay')?.classList.add('show');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('show');
}

/* ============================================================
   THEME
============================================================ */
function initTheme() {
  const saved = localStorage.getItem('rp-admin-theme') || 'light';
  applyTheme(saved);
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
}

function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('rp-admin-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}

/* ============================================================
   TOAST
============================================================ */
function toast(msg, type = 'success') {
  const zone = document.getElementById('toast-zone');
  if (!zone) return;
  const t = document.createElement('div');
  t.className = `toast-item ${type}`;
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  t.innerHTML = `<span>${icons[type]||''}</span><span>${msg}</span>`;
  zone.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ============================================================
   UTILS
============================================================ */
function val(id) { return (document.getElementById(id)?.value || '').trim(); }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function setChecked(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function isChecked(id) { return document.getElementById(id)?.checked || false; }
function show(id) { const el = document.getElementById(id); if (el) el.style.display = 'block'; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function autoSlug(str, targetId) {
  const slug = str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
  setVal(targetId, slug);
}

function timeAgo(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60)      return 'baru saja';
  if (s < 3600)    return Math.floor(s/60) + ' mnt lalu';
  if (s < 86400)   return Math.floor(s/3600) + ' jam lalu';
  if (s < 2592000) return Math.floor(s/86400) + ' hari lalu';
  return new Date(d).toLocaleDateString('id-ID', {day:'numeric',month:'short'});
}

function fmtViews(v) {
  if (!v) return '0';
  if (v >= 1000) return (v/1000).toFixed(1)+'rb';
  return String(v);
}

/* ============================================================
   MODAL
============================================================ */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; setTimeout(() => el.classList.add('open'), 10); }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); setTimeout(() => el.style.display = 'none', 200); }
}

function confirmDelete(msg, onOk) {
  document.getElementById('confirm-msg').textContent = msg;
  const btn = document.getElementById('btn-confirm-ok');
  btn.onclick = () => { onOk(); closeModal('modal-confirm'); };
  openModal('modal-confirm');
}

/* ============================================================
   CATEGORIES (shared)
============================================================ */
async function loadCategories() {
  const data = await supaGet('categories', '?select=id,name,slug,icon&order=name.asc');
  allCategories = Array.isArray(data) ? data : [];

  // Fill konten form select
  const sel = document.getElementById('f-cat');
  if (sel) {
    sel.innerHTML = '<option value="">Pilih kategori...</option>' +
      allCategories.map(c => `<option value="${c.id}">${c.icon||'📌'} ${c.name}</option>`).join('');
  }

  // Fill konten filter select
  const filterSel = document.getElementById('konten-filter-cat');
  if (filterSel) {
    filterSel.innerHTML = '<option value="">Semua Kategori</option>' +
      allCategories.map(c => `<option value="${c.id}">${c.icon||'📌'} ${c.name}</option>`).join('');
  }

  return allCategories;
}

/* ============================================================
   DASHBOARD
============================================================ */
async function loadDashboard() {
  const [allReviews, cats] = await Promise.all([
    supaGet('reviews', '?select=id,is_published,views&order=created_at.desc'),
    supaGet('categories', '?select=id'),
  ]);

  const reviews = Array.isArray(allReviews) ? allReviews : [];
  const total   = reviews.length;
  const pub     = reviews.filter(r => r.is_published).length;
  const draft   = total - pub;
  const views   = reviews.reduce((s, r) => s + (r.views||0), 0);
  const catCount = Array.isArray(cats) ? cats.length : 0;

  setVal('st-total', total); document.getElementById('st-total').textContent = total;
  document.getElementById('st-pub').textContent   = pub;
  document.getElementById('st-draft').textContent = draft;
  document.getElementById('st-views').textContent = fmtViews(views);
  document.getElementById('st-cats').textContent  = catCount;
  document.getElementById('badge-konten').textContent = total;

  // Recent
  const recent = await supaGet('reviews', '?select=id,title,image_url,emoji,post_type,created_at,is_published&order=created_at.desc&limit=7');
  renderDashList('dash-recent', Array.isArray(recent) ? recent : [], r => `
    <div class="dash-item" onclick="openKontenForm(${JSON.stringify(r).replace(/"/g,'&quot;')})">
      <div class="dash-item-thumb">${r.image_url ? `<img src="${r.image_url}">` : r.emoji||'📝'}</div>
      <div class="dash-item-body">
        <div class="dash-item-title">${r.title}</div>
        <div class="dash-item-meta">${timeAgo(r.created_at)} · ${r.is_published?'<span style="color:var(--success)">Published</span>':'Draft'}</div>
      </div>
    </div>`);

  // Popular
  const popular = await supaGet('reviews', '?select=id,title,image_url,emoji,views&is_published=eq.true&order=views.desc&limit=7');
  renderDashList('dash-popular', Array.isArray(popular) ? popular : [], r => `
    <div class="dash-item">
      <div class="dash-item-thumb">${r.image_url ? `<img src="${r.image_url}">` : r.emoji||'📝'}</div>
      <div class="dash-item-body">
        <div class="dash-item-title">${r.title}</div>
        <div class="dash-item-meta">👁 ${fmtViews(r.views)} views</div>
      </div>
    </div>`);
}

function renderDashList(id, items, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = items.length ? items.map(fn).join('') : '<div class="dash-empty">Belum ada data</div>';
}

/* ============================================================
   KONTEN
============================================================ */
async function loadKonten(page = 0) {
  kontenPage = page;
  const tbody = document.getElementById('konten-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="tbl-loading">⏳ Memuat...</td></tr>';

  const search = val('konten-search');
  const status = val('konten-filter-status');
  const type   = val('konten-filter-type');
  const catId  = val('konten-filter-cat');

  let q = `?select=id,title,slug,post_type,is_published,is_featured,views,created_at,category_id,categories(name)&order=created_at.desc&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
  if (status === 'published') q += '&is_published=eq.true';
  if (status === 'draft')     q += '&is_published=eq.false';
  if (type)    q += `&post_type=eq.${type}`;
  if (catId)   q += `&category_id=eq.${catId}`;
  if (search)  q += `&or=(title.ilike.*${encodeURIComponent(search)}*,slug.ilike.*${encodeURIComponent(search)})` ;

  const data  = await supaGet('reviews', q);
  const items = Array.isArray(data) ? data : [];

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="tbl-loading">Belum ada konten</td></tr>';
    return;
  }

  const typeLabel = { review:'bt-review', list:'bt-list', video:'bt-video', news:'bt-news', article:'bt-article' };

  tbody.innerHTML = items.map(r => `
    <tr>
      <td class="tbl-title-cell">
        <span class="tbl-title-main">${r.title}</span>
        <span class="tbl-title-slug">${r.slug}</span>
      </td>
      <td><span class="badge-type ${typeLabel[r.post_type]||'bt-review'}">${r.post_type||'review'}</span></td>
      <td>${r.categories?.name || '–'}</td>
      <td>
        <span class="badge-status ${r.is_published ? 'bs-pub':'bs-draft'}">
          ${r.is_published ? '✅ Published':'⬜ Draft'}
        </span>
      </td>
      <td>${fmtViews(r.views)}</td>
      <td>${timeAgo(r.created_at)}</td>
      <td>
        <div class="tbl-actions">
          <button class="btn-tbl btn-tbl-edit" onclick='editKonten(${r.id})'>Edit</button>
          <button class="btn-tbl btn-tbl-toggle" onclick='togglePublish(${r.id},${r.is_published})'>
            ${r.is_published ? 'Unpublish':'Publish'}
          </button>
          <button class="btn-tbl btn-tbl-del" onclick='deleteKonten(${r.id},"${r.title.replace(/"/g,'')}")'>Hapus</button>
        </div>
      </td>
    </tr>`).join('');

  renderPagination('konten-pagination', page, items.length);
}

function renderPagination(containerId, current, count) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (count < PAGE_SIZE && current === 0) { wrap.innerHTML = ''; return; }
  let html = '';
  if (current > 0) html += `<button onclick="loadKonten(${current-1})">‹</button>`;
  html += `<button class="active">${current + 1}</button>`;
  if (count >= PAGE_SIZE) html += `<button onclick="loadKonten(${current+1})">›</button>`;
  wrap.innerHTML = html;
}

/* ===== KONTEN FORM ===== */
let productCount = 0;

function openKontenForm(existing = null) {
  resetKontenForm();
  document.getElementById('modal-konten-ttl').textContent = existing ? 'Edit Konten' : 'Tambah Konten';

  if (existing && typeof existing === 'object') {
    fillKontenForm(existing);
    return; // ← penting: cegah kode di bawah dieksekusi ulang
  } else if (typeof existing === 'number') {
    loadKontenForEdit(existing);
    return;
  }

  // Populate category select (hanya untuk konten BARU)
  const sel = document.getElementById('f-cat');
  if (sel) {
    sel.innerHTML = '<option value="">Pilih kategori...</option>' +
      allCategories.map(c => `<option value="${c.id}">${c.icon||'📌'} ${c.name}</option>`).join('');
  }

  openModal('modal-konten');
}

async function loadKontenForEdit(id) {
  const data = await supaGet('reviews', `?id=eq.${id}&limit=1`);
  const item = Array.isArray(data) ? data[0] : null;
  if (!item) { toast('Gagal memuat data', 'error'); return; }
  openKontenForm(item);
}

function fillKontenForm(r) {
  setVal('f-id',       r.id);
  setVal('f-title',    r.title);
  setVal('f-slug',     r.slug);
  setVal('f-excerpt',  r.excerpt);
  setVal('f-image',    r.image_url);
  setVal('f-image-alt', r.image_alt);
  setVal('f-emoji',    r.emoji);
  setVal('f-rating',   r.rating);
  setVal('f-affiliate',r.affiliate_url);
  setVal('f-video-url',r.video_url);
  setVal('f-duration', r.duration);
  setVal('f-author',   r.author || 'Admin');
  setVal('f-content',  r.content);
  setChecked('f-published', r.is_published);
  setChecked('f-featured',  r.is_featured);

  // Pros & Cons
  if (r.pros) {
    const pros = typeof r.pros === 'string' ? JSON.parse(r.pros) : r.pros;
    setVal('f-pros', Array.isArray(pros) ? pros.join('\n') : '');
  }
  if (r.cons) {
    const cons = typeof r.cons === 'string' ? JSON.parse(r.cons) : r.cons;
    setVal('f-cons', Array.isArray(cons) ? cons.join('\n') : '');
  }

  // Tags
  if (r.tags) {
    const tags = typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags;
    setVal('f-tags', Array.isArray(tags) ? tags.join(', ') : '');
  }

  // Products
  if (r.products) {
    const prods = typeof r.products === 'string' ? JSON.parse(r.products) : r.products;
    if (Array.isArray(prods)) prods.forEach(p => addProduct(p));
  }

  // Image preview
  if (r.image_url) previewImg(r.image_url);

  // 1. Rebuild category select DULU, lalu restore nilai
  const sel = document.getElementById('f-cat');
  if (sel) {
    sel.innerHTML = '<option value="">Pilih kategori...</option>' +
      allCategories.map(c => `<option value="${c.id}">${c.icon||'📌'} ${c.name}</option>`).join('');
    setVal('f-cat', r.category_id);
  }

  // 2. Set post_type SETELAH category, agar nilai tidak tertimpa
  setVal('f-type', r.post_type || 'review');

  // 3. Trigger onTypeChange TERAKHIR agar UI field menyesuaikan tipe yang benar
  onTypeChange();

  openModal('modal-konten');
}

function resetKontenForm() {
  ['f-id','f-title','f-slug','f-excerpt','f-image','f-image-alt','f-emoji','f-rating',
   'f-affiliate','f-video-url','f-duration','f-pros','f-cons','f-tags','f-content']
    .forEach(id => setVal(id, ''));
  setVal('f-author', 'Admin');
  setVal('f-type', 'review');
  setChecked('f-published', false);
  setChecked('f-featured', false);
  hide('img-prev-wrap');
  hide('content-preview-box');
  document.getElementById('btn-prev-toggle')?.classList.remove('active');
  // Reset products
  productCount = 0;
  const pl = document.getElementById('products-list');
  if (pl) pl.innerHTML = '';
  onTypeChange();
}

function onTypeChange() {
  const type = val('f-type');
  const isVideo   = type === 'video';
  const isList    = type === 'list';
  const isReview  = type === 'review';
  // news & article: tidak perlu field khusus (sama seperti review tapi tanpa rating/pros/cons/affiliate)

  document.getElementById('video-fields').style.display   = isVideo  ? 'block' : 'none';
  document.getElementById('list-fields').style.display    = isList   ? 'block' : 'none';
  document.getElementById('review-fields').style.display  = isReview ? 'block' : 'none';
}

function toISO8601Duration(input) {
  if (!input) return null;
  // Sudah format ISO, kembalikan apa adanya
  if (/^PT/i.test(input)) return input.toUpperCase();
  // Format H:MM:SS atau MM:SS
  const parts = input.split(':').map(s => parseInt(s, 10));
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) { [h, m, s] = parts; }
  else if (parts.length === 2) { [m, s] = parts; }
  else return null;
  return 'PT' + (h ? h + 'H' : '') + (m ? m + 'M' : '') + (s ? s + 'S' : '');
}

async function saveKonten() {
  const btn = document.getElementById('btn-save-konten');
  btn.textContent = '⏳ Menyimpan...';
  btn.disabled    = true;

  const type = val('f-type');
  const id   = val('f-id');

  // Validasi post_type wajib ada
  if (!type) {
    toast('Tipe konten wajib dipilih!', 'error');
    btn.textContent = '💾 Simpan Konten';
    btn.disabled    = false;
    return;
  }

  // Pros & cons
  const prosArr  = val('f-pros').split('\n').map(s=>s.trim()).filter(Boolean);
  const consArr  = val('f-cons').split('\n').map(s=>s.trim()).filter(Boolean);
  const tagsArr  = val('f-tags').split(',').map(s=>s.trim()).filter(Boolean);

  // Collect products from builder
  const products = collectProducts();

  const payload = {
    title:           val('f-title'),
    slug:            val('f-slug'),
    category_id:     val('f-cat') ? parseInt(val('f-cat')) : null,
    excerpt:         val('f-excerpt') || null,
    content:         val('f-content') || null,
    image_url:       val('f-image') || null,
    image_alt:       val('f-image-alt') || null,
    emoji:           val('f-emoji') || '📌',
    post_type:       type,
    author:          val('f-author') || 'Admin',
    is_published:    isChecked('f-published'),
    is_featured:     isChecked('f-featured'),
    tags:            tagsArr,
    rating:          val('f-rating') ? parseFloat(val('f-rating')) : null,
    affiliate_url:   val('f-affiliate') || null,
    pros:            prosArr,
    cons:            consArr,
    video_url:       val('f-video-url') || null,
    duration:        toISO8601Duration(val('f-duration')),
    products:        products,
    product_count:   products.length,
  };

  if (!payload.title || !payload.slug) {
    toast('Judul dan slug wajib diisi!', 'error');
    btn.textContent = '💾 Simpan Konten';
    btn.disabled    = false;
    return;
  }

  const result = id ? await supaUpdate('reviews', id, payload) : await supaInsert('reviews', payload);

  if (result.ok) {
    toast(id ? 'Konten berhasil diperbarui!' : 'Konten berhasil ditambahkan!');
    closeModal('modal-konten');
    loadKonten(kontenPage);
    loadDashboard();
  } else {
    const errMsg = result.data?.message || result.data?.[0]?.message || 'Terjadi kesalahan';
    toast('Gagal: ' + errMsg, 'error');
  }

  btn.textContent = '💾 Simpan Konten';
  btn.disabled    = false;
}

async function editKonten(id) {
  await loadKontenForEdit(id);
}

async function togglePublish(id, current) {
  const result = await supaUpdate('reviews', id, { is_published: !current });
  if (result.ok) {
    toast(current ? 'Konten di-unpublish' : 'Konten dipublish! ✅');
    loadKonten(kontenPage);
  } else {
    toast('Gagal mengubah status', 'error');
  }
}

function deleteKonten(id, title) {
  confirmDelete(`Hapus konten "${title}"?`, async () => {
    const ok = await supaDelete('reviews', id);
    if (ok) { toast('Konten dihapus'); loadKonten(kontenPage); loadDashboard(); }
    else toast('Gagal menghapus', 'error');
  });
}

/* ============================================================
   PRODUCTS BUILDER (untuk list type)
============================================================ */
function addProduct(data = {}) {
  productCount++;
  const num = productCount;
  const pl  = document.getElementById('products-list');
  if (!pl) return;

  const div = document.createElement('div');
  div.className = 'product-item';
  div.id = `product-item-${num}`;
  div.innerHTML = `
    <div class="product-item-header">
      <span class="product-item-num">Produk #${num}</span>
      <button type="button" class="btn-sm-outline" style="color:var(--danger)" onclick="removeProduct(${num})">✕ Hapus</button>
    </div>
    <div class="product-fields">
      <div class="product-field-full">
        <input type="text" id="p-name-${num}" class="form-input" placeholder="Nama produk..." value="${data.name||''}">
      </div>
      <div class="product-field-full">
        <textarea id="p-desc-${num}" class="form-input" rows="2" placeholder="Deskripsi singkat...">${data.description||''}</textarea>
      </div>
      <div>
        <input type="text" id="p-price-${num}" class="form-input" placeholder="Rp 150.000" value="${data.price||''}">
      </div>
      <div>
        <input type="text" id="p-rating-${num}" class="form-input" placeholder="Rating (4.5)" value="${data.rating||''}">
      </div>
      <div>
        <input type="text" id="p-emoji-${num}" class="form-input" placeholder="Emoji 🛍️" maxlength="4" value="${data.emoji||''}">
      </div>
      <div>
        <input type="url" id="p-img-${num}" class="form-input" placeholder="URL Gambar" value="${data.image||''}">
      </div>
      <div class="product-field-full">
        <input type="url" id="p-aff-${num}" class="form-input" placeholder="URL Afiliasi" value="${data.affiliate_url||''}">
      </div>
    </div>`;
  pl.appendChild(div);
}

function removeProduct(num) {
  document.getElementById(`product-item-${num}`)?.remove();
}

function collectProducts() {
  const items = document.querySelectorAll('.product-item');
  return Array.from(items).map(item => {
    const n = item.id.replace('product-item-', '');
    return {
      name:          (document.getElementById(`p-name-${n}`)?.value  || '').trim(),
      description:   (document.getElementById(`p-desc-${n}`)?.value  || '').trim(),
      price:         (document.getElementById(`p-price-${n}`)?.value || '').trim(),
      rating:        (document.getElementById(`p-rating-${n}`)?.value|| '').trim(),
      emoji:         (document.getElementById(`p-emoji-${n}`)?.value || '').trim(),
      image:         (document.getElementById(`p-img-${n}`)?.value   || '').trim(),
      affiliate_url: (document.getElementById(`p-aff-${n}`)?.value   || '').trim(),
    };
  }).filter(p => p.name);
}

/* ============================================================
   CONTENT EDITOR HELPERS
============================================================ */
let previewOn = false;

function ins(tag) {
  const ta = document.getElementById('f-content');
  if (!ta) return;
  ta.focus();
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.substring(start, end) || 'Teks di sini';
  const tags = {
    h2: `<h2>${sel}</h2>`, h3: `<h3>${sel}</h3>`,
    p:  `<p>${sel}</p>`,
    b:  `<b>${sel}</b>`,   i: `<i>${sel}</i>`,
    ul: `<ul>\n  <li>Item 1</li>\n  <li>Item 2</li>\n</ul>`,
    li: `<li>${sel}</li>`,
    bq: `<blockquote>${sel}</blockquote>`,
    img:`<img src="URL_GAMBAR" alt="${sel}">`,
    a:  `<a href="URL_LINK">${sel}</a>`,
  };
  const snippet = tags[tag] || sel;
  ta.value = ta.value.substring(0, start) + snippet + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = start + snippet.length;
  if (previewOn) updatePreview();
}

function togglePreview() {
  previewOn = !previewOn;
  const btn  = document.getElementById('btn-prev-toggle');
  const box  = document.getElementById('content-preview-box');
  const ta   = document.getElementById('f-content');
  if (!box || !ta) return;
  if (previewOn) {
    box.style.display = 'block';
    ta.style.display  = 'none';
    btn?.classList.add('active');
    updatePreview();
  } else {
    box.style.display = 'none';
    ta.style.display  = 'block';
    btn?.classList.remove('active');
  }
}

function updatePreview() {
  const box = document.getElementById('content-preview-box');
  const ta  = document.getElementById('f-content');
  if (box && ta) box.innerHTML = ta.value;
}

/* ============================================================
   IMAGE PREVIEW
============================================================ */
function previewImg(url) {
  const wrap = document.getElementById('img-prev-wrap');
  const img  = document.getElementById('img-prev');
  if (!url) { if (wrap) wrap.style.display = 'none'; return; }
  if (img)  img.src = url;
  if (wrap) wrap.style.display = 'inline-block';
}

function clearImgPreview() {
  setVal('f-image', '');
  hide('img-prev-wrap');
}

/* ============================================================
   KATEGORI PAGE
============================================================ */
async function loadKategoriPage() {
  const grid = document.getElementById('cat-grid-admin');
  if (!grid) return;
  grid.innerHTML = '<div class="tbl-loading">⏳ Memuat...</div>';

  const search = val('kat-search');
  let data = await supaGet('categories', '?select=id,name,slug,icon,description&order=name.asc');
  let cats = Array.isArray(data) ? data : [];

  if (search) {
    const q = search.toLowerCase();
    cats = cats.filter(c => c.name?.toLowerCase().includes(q) || c.slug?.toLowerCase().includes(q));
  }

  if (!cats.length) {
    grid.innerHTML = '<div class="tbl-loading">Belum ada kategori. Tambahkan sekarang!</div>';
    return;
  }

  grid.innerHTML = cats.map(c => `
    <div class="cat-admin-card">
      <div class="cat-admin-icon">${c.icon||'📌'}</div>
      <div class="cat-admin-info">
        <div class="cat-admin-name">${c.name}</div>
        <div class="cat-admin-slug">${c.slug}${c.description ? ' · '+c.description : ''}</div>
      </div>
      <div class="cat-admin-actions">
        <button class="btn-tbl btn-tbl-edit" onclick='editKat(${JSON.stringify(c).replace(/"/g,"&quot;")})'>Edit</button>
        <button class="btn-tbl btn-tbl-del"  onclick='deleteKat(${c.id},"${c.name}")'>Hapus</button>
      </div>
    </div>`).join('');
}

/* ===== Kat Modal Tab ===== */
let _katTab = 'single';
let _bulkRowCount = 0;

function switchKatTab(tab) {
  _katTab = tab;
  const isSingle = tab === 'single';
  document.getElementById('kat-panel-single').style.display = isSingle ? 'block' : 'none';
  document.getElementById('kat-panel-bulk').style.display   = isSingle ? 'none'  : 'block';
  document.getElementById('kat-tab-single').classList.toggle('active', isSingle);
  document.getElementById('kat-tab-bulk').classList.toggle('active', !isSingle);
  document.getElementById('modal-kat-ttl').textContent = isSingle ? 'Tambah Kategori' : 'Tambah Banyak Kategori';
  document.getElementById('btn-save-kat').textContent  = isSingle ? '💾 Simpan' : '💾 Simpan Semua';
}

/* ===== Preset ===== */
function applyPreset(name, icon, slug, desc) {
  if (_katTab !== 'single') return;
  document.getElementById('fk-name').value = name;
  document.getElementById('fk-icon').value = icon;
  document.getElementById('fk-slug').value = slug;
  document.getElementById('fk-desc').value = desc;
}

/* ===== Bulk Rows ===== */
function addBulkRow(data = {}) {
  _bulkRowCount++;
  const n = _bulkRowCount;
  const list = document.getElementById('bulk-rows-list');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'bulk-row';
  div.id = `bulk-row-${n}`;
  div.innerHTML = `
    <input type="text" id="br-icon-${n}" class="form-input" placeholder="📌" maxlength="4" value="${data.icon||''}">
    <input type="text" id="br-name-${n}" class="form-input" placeholder="Nama..." style="flex:2" value="${data.name||''}" oninput="autoBulkSlug(${n})">
    <input type="text" id="br-slug-${n}" class="form-input" placeholder="slug..." style="flex:2" value="${data.slug||''}">
    <input type="text" id="br-desc-${n}" class="form-input" placeholder="Deskripsi..." style="flex:3" value="${data.desc||''}">
    <button type="button" class="bulk-row-del" onclick="removeBulkRow(${n})" title="Hapus">✕</button>`;
  list.appendChild(div);
}

function removeBulkRow(n) {
  document.getElementById(`bulk-row-${n}`)?.remove();
}

function autoBulkSlug(n) {
  const nameEl = document.getElementById(`br-name-${n}`);
  const slugEl = document.getElementById(`br-slug-${n}`);
  if (!nameEl || !slugEl) return;
  slugEl.value = nameEl.value.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function collectBulkRows() {
  const rows = document.querySelectorAll('.bulk-row');
  return Array.from(rows).map(row => {
    const n = row.id.replace('bulk-row-', '');
    return {
      icon:        (document.getElementById(`br-icon-${n}`)?.value || '').trim() || '📌',
      name:        (document.getElementById(`br-name-${n}`)?.value || '').trim(),
      slug:        (document.getElementById(`br-slug-${n}`)?.value || '').trim(),
      description: (document.getElementById(`br-desc-${n}`)?.value || '').trim() || null,
    };
  }).filter(r => r.name && r.slug);
}

function initBulkDefaults() {
  const defaults = [
    { icon:'👗', name:'Fashion',       slug:'fashion',       desc:'Pakaian, aksesori, gaya hidup' },
    { icon:'📱', name:'Elektronik',    slug:'elektronik',    desc:'Gadget dan perangkat elektronik' },
    { icon:'🍜', name:'Makanan',       slug:'makanan',       desc:'Kuliner, resep, restoran' },
    { icon:'💄', name:'Kecantikan',    slug:'kecantikan',    desc:'Skincare, makeup, perawatan diri' },
    { icon:'🏠', name:'Rumah Tangga',  slug:'rumah-tangga',  desc:'Perabotan dan kebutuhan rumah' },
    { icon:'📚', name:'Buku',          slug:'buku',          desc:'Novel, buku teks, komik' },
  ];
  defaults.forEach(d => addBulkRow(d));
}

/* ===== Open / Edit ===== */
function openKatForm() {
  _bulkRowCount = 0;
  _katTab = 'single';
  ['fk-id','fk-name','fk-icon','fk-slug','fk-desc'].forEach(id => setVal(id,''));
  document.getElementById('bulk-rows-list').innerHTML = '';
  document.getElementById('kat-tab-bar').style.display = 'flex';
  switchKatTab('single');
  openModal('modal-kat');
}

function openKatFormBulk() {
  _bulkRowCount = 0;
  _katTab = 'bulk';
  ['fk-id','fk-name','fk-icon','fk-slug','fk-desc'].forEach(id => setVal(id,''));
  document.getElementById('bulk-rows-list').innerHTML = '';
  document.getElementById('kat-tab-bar').style.display = 'flex';
  initBulkDefaults();
  switchKatTab('bulk');
  openModal('modal-kat');
}

function editKat(c) {
  if (typeof c === 'string') c = JSON.parse(c);
  _bulkRowCount = 0;
  _katTab = 'single';
  document.getElementById('bulk-rows-list').innerHTML = '';
  setVal('fk-id',   c.id);
  setVal('fk-name', c.name);
  setVal('fk-icon', c.icon);
  setVal('fk-slug', c.slug);
  setVal('fk-desc', c.description);
  switchKatTab('single');
  document.getElementById('modal-kat-ttl').textContent = 'Edit Kategori';
  // Hide tab bar when editing
  document.getElementById('kat-tab-bar').style.display = 'none';
  openModal('modal-kat');
}

/* ===== Save ===== */
async function saveKat() {
  const btn = document.getElementById('btn-save-kat');
  btn.textContent = '⏳ Menyimpan...';
  btn.disabled = true;

  if (_katTab === 'bulk') {
    const rows = collectBulkRows();
    if (!rows.length) { toast('Isi minimal satu baris dengan Nama dan Slug!', 'error'); btn.textContent = '💾 Simpan Semua'; btn.disabled = false; return; }
    let ok = 0, fail = 0;
    for (const row of rows) {
      const r = await supaInsert('categories', { name: row.name, slug: row.slug, icon: row.icon, description: row.description });
      if (r.ok) ok++; else fail++;
    }
    toast(fail === 0 ? `✅ ${ok} kategori berhasil ditambahkan!` : `${ok} berhasil, ${fail} gagal`, fail ? 'error' : 'success');
    closeModal('modal-kat');
    loadKategoriPage();
    loadCategories();
  } else {
    const id   = val('fk-id');
    const name = val('fk-name');
    const slug = val('fk-slug');
    if (!name || !slug) { toast('Nama dan slug wajib diisi!', 'error'); btn.textContent = '💾 Simpan'; btn.disabled = false; return; }
    const payload = { name, slug, icon: val('fk-icon') || '📌', description: val('fk-desc') || null };
    const result = id ? await supaUpdate('categories', id, payload) : await supaInsert('categories', payload);
    if (result.ok) {
      toast(id ? 'Kategori diperbarui!' : 'Kategori ditambahkan!');
      closeModal('modal-kat');
      loadKategoriPage();
      loadCategories();
    } else {
      toast('Gagal menyimpan: ' + (result.data?.message || 'Error'), 'error');
    }
  }

  btn.textContent = _katTab === 'bulk' ? '💾 Simpan Semua' : '💾 Simpan';
  btn.disabled = false;
}

async function deleteKat(id, name) {
  confirmDelete(`Hapus kategori "${name}"?`, async () => {
    const ok = await supaDelete('categories', id);
    if (ok) { toast('Kategori dihapus'); loadKategoriPage(); loadCategories(); }
    else toast('Gagal menghapus', 'error');
  });
}

/* ============================================================
   TOKOH PAGE
============================================================ */
async function loadTokoh() {
  const tbody = document.getElementById('tokoh-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="tbl-loading">⏳ Memuat...</td></tr>';

  const search = val('tokoh-search');
  let q = '?select=id,name,slug,profession,is_published,is_featured,views,created_at&order=created_at.desc&limit=50';
  if (search) q += `&name=ilike.*${encodeURIComponent(search)}*`;

  const data  = await supaGet('tokoh', q);
  const items = Array.isArray(data) ? data : [];

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="tbl-loading">Belum ada tokoh</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(t => `
    <tr>
      <td>
        <span class="tbl-title-main">${t.name}</span>
        <span class="tbl-title-slug">${t.slug}</span>
      </td>
      <td>${t.profession || '–'}</td>
      <td><span class="badge-status ${t.is_published?'bs-pub':'bs-draft'}">${t.is_published?'✅ Published':'⬜ Draft'}</span></td>
      <td>${fmtViews(t.views)}</td>
      <td>${timeAgo(t.created_at)}</td>
      <td>
        <div class="tbl-actions">
          <button class="btn-tbl btn-tbl-edit" onclick="editTokoh(${t.id})">Edit</button>
          <button class="btn-tbl btn-tbl-toggle" onclick="toggleTokohPublish(${t.id},${t.is_published})">${t.is_published?'Unpublish':'Publish'}</button>
          <button class="btn-tbl btn-tbl-del" onclick='deleteTokoh(${t.id},"${t.name}")'>Hapus</button>
        </div>
      </td>
    </tr>`).join('');
}

function openTokohForm() {
  ['ft-id','ft-name','ft-slug','ft-prof','ft-nation','ft-image','ft-born','ft-bio','ft-content'].forEach(id => setVal(id,''));
  setChecked('ft-published', false);
  setChecked('ft-featured',  false);
  document.getElementById('modal-tokoh-ttl').textContent = 'Tambah Tokoh';
  openModal('modal-tokoh');
}

async function editTokoh(id) {
  const data = await supaGet('tokoh', `?id=eq.${id}&limit=1`);
  const t    = Array.isArray(data) ? data[0] : null;
  if (!t) { toast('Gagal memuat data', 'error'); return; }

  setVal('ft-id',     t.id);
  setVal('ft-name',   t.name);
  setVal('ft-slug',   t.slug);
  setVal('ft-prof',   t.profession);
  setVal('ft-nation', t.nationality);
  setVal('ft-image',  t.image_url);
  setVal('ft-born',   t.born);
  setVal('ft-bio',    t.bio);
  setVal('ft-content',t.content);
  setChecked('ft-published', t.is_published);
  setChecked('ft-featured',  t.is_featured);
  document.getElementById('modal-tokoh-ttl').textContent = 'Edit Tokoh';
  openModal('modal-tokoh');
}

async function saveTokoh() {
  const id = val('ft-id');
  const payload = {
    name:        val('ft-name'),
    slug:        val('ft-slug'),
    profession:  val('ft-prof')   || null,
    nationality: val('ft-nation') || null,
    image_url:   val('ft-image')  || null,
    born:        val('ft-born')   || null,
    bio:         val('ft-bio')    || null,
    content:     val('ft-content')|| null,
    is_published:isChecked('ft-published'),
    is_featured: isChecked('ft-featured'),
  };

  if (!payload.name || !payload.slug) { toast('Nama dan slug wajib!', 'error'); return; }

  const result = id ? await supaUpdate('tokoh', id, payload) : await supaInsert('tokoh', payload);

  if (result.ok) {
    toast(id ? 'Tokoh diperbarui!' : 'Tokoh ditambahkan!');
    closeModal('modal-tokoh');
    loadTokoh();
  } else {
    toast('Gagal: ' + (result.data?.message || 'Error'), 'error');
  }
}

async function toggleTokohPublish(id, current) {
  const r = await supaUpdate('tokoh', id, { is_published: !current });
  if (r.ok) { toast(!current ? 'Tokoh dipublish!' : 'Tokoh di-unpublish'); loadTokoh(); }
  else toast('Gagal', 'error');
}

function deleteTokoh(id, name) {
  confirmDelete(`Hapus tokoh "${name}"?`, async () => {
    const ok = await supaDelete('tokoh', id);
    if (ok) { toast('Tokoh dihapus'); loadTokoh(); }
    else toast('Gagal menghapus', 'error');
  });
}

/* ============================================================
   SEARCH
============================================================ */
function initSearch() {
  let timer;
  const debounce = (fn) => { clearTimeout(timer); timer = setTimeout(fn, 350); };

  document.getElementById('konten-search')?.addEventListener('input', () => debounce(loadKonten));
  document.getElementById('konten-filter-status')?.addEventListener('change', loadKonten);
  document.getElementById('konten-filter-cat')?.addEventListener('change',    loadKonten);
  document.getElementById('konten-filter-type')?.addEventListener('change',   loadKonten);
  document.getElementById('tokoh-search')?.addEventListener('input',  () => debounce(loadTokoh));
  document.getElementById('kat-search')?.addEventListener('input',    () => debounce(loadKategoriPage));
}

/* ============================================================
   BOOT
============================================================ */
document.addEventListener('DOMContentLoaded', async () => {

  // Login form
  document.getElementById('btn-login')?.addEventListener('click', login);
  document.getElementById('login-password')?.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  document.getElementById('toggle-pw')?.addEventListener('click', () => {
    const inp = document.getElementById('login-password');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Check existing session
  const loggedIn = await checkSession();
  if (loggedIn) {
    const email = localStorage.getItem('rp-admin-email') || currentUser?.email || 'Admin';
    enterApp(email);
  }
});
