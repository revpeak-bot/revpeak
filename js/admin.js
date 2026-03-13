/* ===== REVPEAK ADMIN JS ===== */
/* Menggunakan Supabase Authentication */

// ===== KONFIGURASI =====
// Ganti dengan URL dan Anon Key project Supabase kamu
// Anon key AMAN dipakai di frontend karena Row Level Security (RLS) yang melindungi data
const SUPABASE_URL = 'https://efaniqeslqtdfeblgffl.supabase.co'; // ← ganti ini
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmYW5pcWVzbHF0ZGZlYmxnZmZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMjgxNTcsImV4cCI6MjA4ODkwNDE1N30.sVs4XEO1jnv6E8PSELug0s0So4lteV-O9QcPUGLasao'; // ← ganti ini (anon key, bukan service role!)

// Init Supabase client
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== STATE =====
let allReviews = []; // cache semua review untuk filter
let categoriesList = []; // cache kategori

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // Cek apakah sudah login
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    showApp(session.user);
  } else {
    showLogin();
  }

  // Listener perubahan auth state (login/logout)
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      showApp(session.user);
    } else if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });

  // Auto slug dari judul
  document.getElementById('f-title').addEventListener('input', e => {
    const slug = e.target.value.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    document.getElementById('f-slug').value = slug;
  });

  // Auto slug kategori
  document.getElementById('cat-name').addEventListener('input', e => {
    document.getElementById('cat-slug').value = e.target.value.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
  });
});

// ===== SHOW / HIDE SCREENS =====
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

async function showApp(user) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  // Isi info user di sidebar
  const name = user.email.split('@')[0];
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-avatar').textContent = name[0].toUpperCase();
  document.getElementById('footer-email').textContent = user.email;

  // Load data
  await loadCategories();
  await loadDashboard();
  await loadReviewsTable();
  await loadCatsTable();
}

// ===== AUTH: LOGIN =====
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const btnText = document.getElementById('login-text');
  const btnLoader = document.getElementById('login-loader');
  const btn = document.getElementById('btn-login');

  if (!email || !password) {
    showLoginError('Email dan password wajib diisi!');
    return;
  }

  // Loading state
  btn.disabled = true;
  btnText.style.display = 'none';
  btnLoader.style.display = 'inline';
  errorEl.style.display = 'none';

  const { error } = await sb.auth.signInWithPassword({ email, password });

  btn.disabled = false;
  btnText.style.display = 'inline';
  btnLoader.style.display = 'none';

  if (error) {
    showLoginError(
      error.message.includes('Invalid login') ? 'Email atau password salah!' :
      error.message.includes('Email not confirmed') ? 'Email belum dikonfirmasi. Cek inbox kamu!' :
      'Login gagal: ' + error.message
    );
  }
  // Kalau berhasil, onAuthStateChange otomatis dipanggil
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = '⚠️ ' + msg;
  el.style.display = 'block';
}

// ===== AUTH: LOGOUT =====
async function doLogout() {
  if (!confirm('Yakin ingin keluar?')) return;
  await sb.auth.signOut();
}

// ===== NAVIGATION =====
const sectionTitles = {
  'dashboard': 'Dashboard',
  'reviews': 'Semua Review',
  'add-review': 'Tambah Review',
  'categories': 'Kategori',
};

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-section]').forEach(n => n.classList.remove('active'));

  const section = document.getElementById('section-' + name);
  if (section) section.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-section="${name}"]`);
  if (navItem) navItem.classList.add('active');

  document.getElementById('topbar-title').textContent = sectionTitles[name] || '';

  // Tutup sidebar di mobile
  closeSidebar();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ===== DASHBOARD =====
async function loadDashboard() {
  try {
    const [{ count: total }, { count: published }, { count: cats }] = await Promise.all([
      sb.from('reviews').select('*', { count: 'exact', head: true }),
      sb.from('reviews').select('*', { count: 'exact', head: true }).eq('is_published', true),
      sb.from('categories').select('*', { count: 'exact', head: true }),
    ]);

    document.getElementById('stat-total').textContent = total || 0;
    document.getElementById('stat-published').textContent = published || 0;
    document.getElementById('stat-draft').textContent = (total || 0) - (published || 0);
    document.getElementById('stat-cats').textContent = cats || 0;

    // Recent reviews
    const { data: recent } = await sb.from('reviews')
      .select('id, title, slug, rating, is_published, categories(name)')
      .order('created_at', { ascending: false })
      .limit(5);

    const el = document.getElementById('recent-list');
    if (!recent?.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Belum ada review.</p>
        <button class="btn-primary" onclick="showSection('add-review')">+ Tambah Review Pertama</button>
      </div>`;
      return;
    }

    el.innerHTML = `<div class="table-wrap"><table>
      ${recent.map(r => `<tr>
        <td class="td-title">${r.title}</td>
        <td style="color:var(--text-muted);font-size:13px">${r.categories?.name || '–'}</td>
        <td class="stars">${r.rating ? r.rating + '★' : '–'}</td>
        <td><span class="badge ${r.is_published ? 'badge-green' : 'badge-gray'}">${r.is_published ? '✅ Live' : '📝 Draft'}</span></td>
        <td><button class="btn-edit" onclick="editReview(${r.id})">✏️ Edit</button></td>
      </tr>`).join('')}
    </table></div>`;
  } catch (e) {
    toast('Gagal load dashboard', 'error');
    console.error(e);
  }
}

// ===== REVIEWS TABLE =====
async function loadReviewsTable() {
  try {
    const { data, error } = await sb.from('reviews')
      .select('id, title, slug, rating, is_published, created_at, category_id, categories(name)')
      .order('created_at', { ascending: false });

    if (error) throw error;
    allReviews = data || [];
    renderReviewsTable(allReviews);
  } catch (e) {
    toast('Gagal load reviews', 'error');
    console.error(e);
  }
}

function renderReviewsTable(reviews) {
  const tbody = document.getElementById('reviews-tbody');
  const empty = document.getElementById('reviews-empty');

  if (!reviews.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = reviews.map(r => `
    <tr>
      <td class="td-title" style="max-width:200px">
        ${r.title}
        <small>${r.slug}</small>
      </td>
      <td>${r.categories?.name || '–'}</td>
      <td class="stars">${r.rating ? r.rating + '★' : '–'}</td>
      <td><span class="badge ${r.is_published ? 'badge-green' : 'badge-gray'}">
        ${r.is_published ? '✅ Live' : '📝 Draft'}
      </span></td>
      <td style="font-size:12px;color:var(--text-muted);white-space:nowrap">
        ${new Date(r.created_at).toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric'})}
      </td>
      <td>
        <div class="actions">
          <button class="btn-edit" onclick="editReview(${r.id})">✏️ Edit</button>
          <button class="btn-toggle" onclick="togglePublish(${r.id}, ${r.is_published})">
            ${r.is_published ? '⬇️ Unpublish' : '⬆️ Publish'}
          </button>
          <button class="btn-del" onclick="deleteReview(${r.id}, '${r.title.replace(/'/g, "\\'").substring(0, 30)}')">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Filter reviews
function filterReviews() {
  const search = document.getElementById('filter-search').value.toLowerCase();
  const status = document.getElementById('filter-status').value;
  const catId = document.getElementById('filter-cat').value;

  let filtered = allReviews.filter(r => {
    const matchSearch = !search || r.title.toLowerCase().includes(search) || r.slug.includes(search);
    const matchStatus = !status ||
      (status === 'published' && r.is_published) ||
      (status === 'draft' && !r.is_published);
    const matchCat = !catId || String(r.category_id) === catId;
    return matchSearch && matchStatus && matchCat;
  });

  renderReviewsTable(filtered);
}

// Toggle publish
async function togglePublish(id, currentStatus) {
  const { error } = await sb.from('reviews')
    .update({ is_published: !currentStatus, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) { toast('Gagal update status', 'error'); return; }
  toast(!currentStatus ? '✅ Review dipublish!' : '📝 Review dijadikan draft', 'success');
  await loadReviewsTable();
  await loadDashboard();
}

// Delete review
async function deleteReview(id, title) {
  if (!confirm(`Hapus review "${title}..."?\n\nTindakan ini tidak bisa dibatalkan!`)) return;
  const { error } = await sb.from('reviews').delete().eq('id', id);
  if (error) { toast('Gagal hapus review', 'error'); return; }
  toast('Review dihapus', 'success');
  await loadReviewsTable();
  await loadDashboard();
}

// ===== CATEGORIES =====
async function loadCategories() {
  const { data } = await sb.from('categories').select('*').order('name');
  categoriesList = data || [];

  // Update dropdown di form review
  const sel = document.getElementById('f-category');
  sel.innerHTML = '<option value="">Pilih kategori...</option>' +
    categoriesList.map(c => `<option value="${c.id}">${c.icon || '📌'} ${c.name}</option>`).join('');

  // Update dropdown di filter
  const filterCat = document.getElementById('filter-cat');
  filterCat.innerHTML = '<option value="">Semua Kategori</option>' +
    categoriesList.map(c => `<option value="${c.id}">${c.icon || '📌'} ${c.name}</option>`).join('');
}

async function loadCatsTable() {
  const { data } = await sb.from('categories').select('*').order('name');
  const tbody = document.getElementById('cats-tbody');

  if (!data?.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="loading-text">Belum ada kategori. Tambahkan sekarang!</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(c => `
    <tr>
      <td style="font-size:24px">${c.icon || '📌'}</td>
      <td style="font-weight:600">${c.name}</td>
      <td style="color:var(--text-muted);font-size:13px">${c.slug}</td>
      <td>
        <button class="btn-del" onclick="deleteCat(${c.id}, '${c.name.replace(/'/g, "\\'")}')">🗑️ Hapus</button>
      </td>
    </tr>
  `).join('');
}

function toggleCatForm() {
  const form = document.getElementById('cat-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') document.getElementById('cat-name').focus();
}

async function saveCat() {
  const name = document.getElementById('cat-name').value.trim();
  const slug = document.getElementById('cat-slug').value.trim();
  const icon = document.getElementById('cat-icon').value.trim() || '📌';

  if (!name || !slug) { toast('Nama dan slug wajib diisi!', 'error'); return; }

  const { error } = await sb.from('categories').insert({ name, slug, icon });
  if (error) {
    toast(error.message.includes('unique') ? 'Slug sudah ada, gunakan slug lain!' : 'Gagal simpan: ' + error.message, 'error');
    return;
  }

  toast('Kategori berhasil ditambahkan! 🎉', 'success');
  document.getElementById('cat-name').value = '';
  document.getElementById('cat-slug').value = '';
  document.getElementById('cat-icon').value = '';
  toggleCatForm();
  await loadCategories();
  await loadCatsTable();
  await loadDashboard();
}

async function deleteCat(id, name) {
  if (!confirm(`Hapus kategori "${name}"?\n\nPastikan tidak ada review di kategori ini!`)) return;
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) {
    toast(error.message.includes('foreign') ? 'Tidak bisa hapus – masih ada review di kategori ini!' : 'Gagal hapus', 'error');
    return;
  }
  toast('Kategori dihapus', 'success');
  await loadCategories();
  await loadCatsTable();
}

// ===== SAVE REVIEW =====
async function saveReview() {
  const editId = document.getElementById('edit-id').value;
  const title = document.getElementById('f-title').value.trim();
  const slug = document.getElementById('f-slug').value.trim();
  const excerpt = document.getElementById('f-excerpt').value.trim();
  const content = document.getElementById('f-content').value.trim();

  if (!title) { toast('Judul wajib diisi!', 'error'); return; }
  if (!slug) { toast('Slug wajib diisi!', 'error'); return; }
  if (!excerpt) { toast('Ringkasan (excerpt) wajib diisi!', 'error'); return; }

  const category_id = document.getElementById('f-category').value;
  const rating = parseFloat(document.getElementById('f-rating').value) || null;
  const emoji = document.getElementById('f-emoji').value.trim() || '📱';
  const author = document.getElementById('f-author').value.trim() || 'Admin';
  const affiliate_url = document.getElementById('f-affiliate').value.trim() || null;
  const image_url = document.getElementById('f-image').value.trim() || null;
  const is_published = document.getElementById('f-published').checked;
  const is_featured = document.getElementById('f-featured').checked;

  // Pros & Cons: 1 per baris → JSON array
  const pros = document.getElementById('f-pros').value.trim().split('\n').map(s => s.trim()).filter(Boolean);
  const cons = document.getElementById('f-cons').value.trim().split('\n').map(s => s.trim()).filter(Boolean);

  const payload = {
    title, slug, excerpt, content,
    pros: JSON.stringify(pros),
    cons: JSON.stringify(cons),
    rating, emoji, author,
    affiliate_url, image_url,
    is_published, is_featured,
    updated_at: new Date().toISOString(),
    ...(category_id ? { category_id: parseInt(category_id) } : { category_id: null }),
  };

  const btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = '⏳ Menyimpan...';

  let error;
  if (editId) {
    ({ error } = await sb.from('reviews').update(payload).eq('id', editId));
  } else {
    payload.created_at = new Date().toISOString();
    ({ error } = await sb.from('reviews').insert(payload));
  }

  btn.disabled = false;
  btn.textContent = '💾 Simpan Review';

  if (error) {
    toast(
      error.message.includes('unique') ? 'Slug sudah dipakai! Gunakan slug lain.' :
      'Gagal simpan: ' + error.message,
      'error'
    );
    return;
  }

  toast(editId ? 'Review berhasil diperbarui! ✨' : 'Review berhasil ditambahkan! 🎉', 'success');
  resetForm();
  await loadReviewsTable();
  await loadDashboard();
  showSection('reviews');
}

// Edit review – load data ke form
async function editReview(id) {
  const { data, error } = await sb.from('reviews').select('*').eq('id', id).single();
  if (error || !data) { toast('Gagal load review', 'error'); return; }

  document.getElementById('edit-id').value = data.id;
  document.getElementById('f-title').value = data.title || '';
  document.getElementById('f-slug').value = data.slug || '';
  document.getElementById('f-category').value = data.category_id || '';
  document.getElementById('f-excerpt').value = data.excerpt || '';
  document.getElementById('f-content').value = data.content || '';
  document.getElementById('f-rating').value = data.rating || '';
  document.getElementById('f-emoji').value = data.emoji || '📱';
  document.getElementById('f-author').value = data.author || 'Admin';
  document.getElementById('f-affiliate').value = data.affiliate_url || '';
  document.getElementById('f-image').value = data.image_url || '';
  document.getElementById('f-published').checked = data.is_published || false;
  document.getElementById('f-featured').checked = data.is_featured || false;

  // Parse pros & cons
  let pros = [], cons = [];
  try { pros = typeof data.pros === 'string' ? JSON.parse(data.pros) : (data.pros || []); } catch(e) {}
  try { cons = typeof data.cons === 'string' ? JSON.parse(data.cons) : (data.cons || []); } catch(e) {}
  document.getElementById('f-pros').value = pros.join('\n');
  document.getElementById('f-cons').value = cons.join('\n');

  updateRatingPreview();
  document.getElementById('form-title').textContent = '✏️ Edit Review';
  showSection('add-review');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  document.getElementById('edit-id').value = '';
  document.getElementById('form-title').textContent = '➕ Tambah Review';
  ['f-title','f-slug','f-excerpt','f-content','f-rating','f-emoji',
   'f-affiliate','f-image','f-pros','f-cons'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('f-author').value = 'Admin';
  document.getElementById('f-category').value = '';
  document.getElementById('f-published').checked = false;
  document.getElementById('f-featured').checked = false;
  document.getElementById('rating-preview').textContent = '☆☆☆☆☆';
  document.getElementById('btn-save').textContent = '💾 Simpan Review';
}

// ===== RATING PREVIEW =====
function updateRatingPreview() {
  const r = parseFloat(document.getElementById('f-rating').value) || 0;
  const full = Math.floor(r);
  const empty = 5 - Math.ceil(r);
  const half = 5 - full - empty;
  document.getElementById('rating-preview').textContent =
    '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

// ===== TOAST =====
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  el.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
