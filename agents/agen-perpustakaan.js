// ============================================================
// REVPEAK — agen-perpustakaan.js
// Agen otomatis: riset buku nyata via Gemini + Google Search,
// buat dokumen PDF, generate cover via CF Workers AI,
// upload ke R2, simpan ke tabel `books` di Supabase.
// Jadwal: sekali sehari (lihat workflow YAML).
// ============================================================

'use strict';

// ── Pastikan pdfkit tersedia ─────────────────────────────────
const { execSync } = require('child_process');
try { require.resolve('pdfkit'); }
catch { execSync('npm install pdfkit --no-save', { stdio: 'inherit' }); }
const PDFDocument = require('pdfkit');

// ── ENV ───────────────────────────────────────────────────────
const GEMINI_API_KEY    = process.env.GEMINI_API_KEY;
const CF_ACCOUNT_ID     = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN      = process.env.CF_API_TOKEN;
const CF_R2_BUCKET      = process.env.CF_R2_LIB_BUCKET  || 'revpeak-library';
const R2_PUBLIC_URL     = (process.env.R2_LIB_URL        || 'https://library.revpeak.web.id').replace(/\/$/, '');
const SUPABASE_URL      = (process.env.SUPABASE_URL      || '').replace(/\/$/, '');
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_KEY;

// Validasi env
['GEMINI_API_KEY','CF_ACCOUNT_ID','CF_API_TOKEN','CF_R2_LIB_BUCKET','R2_LIB_URL','SUPABASE_URL','SUPABASE_SERVICE_KEY'].forEach(k => {
  if (!process.env[k]) throw new Error(`ENV tidak ditemukan: ${k}`);
});

// ── UTILS ─────────────────────────────────────────────────────
function toSlug(str) {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

/**
 * Parse label dari plain-text output Gemini.
 * Mendukung nilai multi-baris (contoh: SINOPSIS, RESENSI).
 */
function parseLabel(text, label) {
  const lines     = text.split('\n');
  const pattern   = new RegExp(`^${label}:\\s*`, 'i');
  const labelStop = /^[A-Z_]{3,}:\s*/;

  const startIdx = lines.findIndex(l => pattern.test(l.trim()));
  if (startIdx === -1) return '';

  const firstLine = lines[startIdx].replace(pattern, '').trim();
  const result    = [firstLine];

  for (let i = startIdx + 1; i < lines.length; i++) {
    if (labelStop.test(lines[i].trim())) break;
    result.push(lines[i]);
  }

  return result.join('\n').trim();
}

function sanitize(str) {
  // Buang karakter non-latin yang bisa merusak PDF
  return (str || '').replace(/[^\x20-\x7E\u00C0-\u024F\u2018\u2019\u201C\u201D\n\r]/g, ' ').trim();
}

// ── SUPABASE ──────────────────────────────────────────────────
async function sbSelect(table, select, qs = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}${qs ? '&' + qs : ''}`;
  const res = await fetch(url, {
    headers: {
      'apikey'        : SUPABASE_KEY,
      'Authorization' : `Bearer ${SUPABASE_KEY}`,
    }
  });
  if (!res.ok) throw new Error(`Supabase SELECT error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method  : 'POST',
    headers : {
      'apikey'        : SUPABASE_KEY,
      'Authorization' : `Bearer ${SUPABASE_KEY}`,
      'Content-Type'  : 'application/json',
      'Prefer'        : 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase INSERT error ${res.status}: ${await res.text()}`);
  return res.json();
}

/**
 * Cari genre_id dari tabel book_genres berdasarkan nama genre.
 * Jika belum ada, buat entry baru dan kembalikan ID-nya.
 */
async function resolveGenreId(genreName) {
  if (!genreName) return null;

  const slug = toSlug(genreName);

  // Cari berdasarkan slug dulu
  try {
    const rows = await sbSelect('book_genres', 'id,slug', `slug=eq.${encodeURIComponent(slug)}&limit=1`);
    if (rows.length) return rows[0].id;
  } catch { /* lanjut ke insert */ }

  // Belum ada → buat entry baru
  try {
    const inserted = await sbInsert('book_genres', { name: genreName, slug });
    const result   = Array.isArray(inserted) ? inserted[0] : inserted;
    return result?.id || null;
  } catch (e) {
    console.warn(`      Gagal insert genre "${genreName}":`, e.message);
    return null;
  }
}

// ── GEMINI ────────────────────────────────────────────────────
async function callGemini(prompt, useSearch = false) {
  const body = {
    contents        : [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 4096 },
  };

  if (useSearch) body.tools = [{ googleSearch: {} }];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );

  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .filter(p => p.text)
    .map(p => p.text)
    .join('');
}

// ── CLOUDFLARE WORKERS AI — image ────────────────────────────
async function generateCoverImage(prompt) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/stabilityai/stable-diffusion-xl-base-1.0`,
    {
      method : 'POST',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ prompt, num_steps: 20 }),
    }
  );
  if (!res.ok) throw new Error(`CF AI image error ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── R2 UPLOAD ─────────────────────────────────────────────────
async function uploadR2(key, buffer, contentType) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${CF_R2_BUCKET}/objects/${key}`,
    {
      method : 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
        'Content-Type' : contentType,
      },
      body: buffer,
    }
  );
  if (!res.ok) throw new Error(`R2 upload error ${res.status}: ${await res.text()}`);
  return `${R2_PUBLIC_URL}/${key}`;
}

// ── GENERATE PDF ──────────────────────────────────────────────
function buildPDF(book) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size   : 'A5',
      margins: { top: 55, bottom: 55, left: 55, right: 55 },
      info   : {
        Title   : book.title,
        Author  : book.author,
        Subject : book.description.slice(0, 200),
        Creator : 'Revpeak – revpeak.web.id',
      },
    });

    const chunks = [];
    doc.on('data',  c   => chunks.push(c));
    doc.on('end',   ()  => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    const W      = doc.page.width;
    const margin = 55;
    const inner  = W - margin * 2;

    // ── Halaman Judul ─────────────────────────────────────────
    doc.moveDown(4);

    doc.font('Helvetica-Bold')
       .fontSize(20)
       .fillColor('#1a1a1a')
       .text(sanitize(book.title), { align: 'center', width: inner, lineGap: 4 });

    doc.moveDown(1);
    doc.font('Helvetica')
       .fontSize(12)
       .fillColor('#444444')
       .text(`oleh ${sanitize(book.author)}`, { align: 'center' });

    doc.moveDown(0.4);
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('#888888')
       .text(`${sanitize(book.genre)}  ·  ${book.year}`, { align: 'center' });

    // Garis pemisah
    doc.moveDown(2.5);
    const ly = doc.y;
    doc.moveTo(margin, ly).lineTo(W - margin, ly)
       .strokeColor('#dddddd').lineWidth(0.5).stroke();
    doc.moveDown(2);

    // ── Sinopsis ──────────────────────────────────────────────
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor('#1a1a1a')
       .text('Sinopsis', { align: 'left' });

    doc.moveDown(0.5);
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('#333333');

    sanitize(book.description)
      .split(/\n\n+/)
      .filter(p => p.trim())
      .forEach((para, i, arr) => {
        doc.text(para.trim(), { align: 'justify', lineGap: 2 });
        if (i < arr.length - 1) doc.moveDown(0.6);
      });

    doc.moveDown(1.8);

    // ── Resensi ───────────────────────────────────────────────
    doc.font('Helvetica-Bold')
       .fontSize(12)
       .fillColor('#1a1a1a')
       .text('Resensi', { align: 'left' });

    doc.moveDown(0.5);
    doc.font('Helvetica')
       .fontSize(10)
       .fillColor('#333333');

    sanitize(book.resensi)
      .split(/\n\n+/)
      .filter(p => p.trim())
      .forEach((para, i, arr) => {
        doc.text(para.trim(), { align: 'justify', lineGap: 2 });
        if (i < arr.length - 1) doc.moveDown(0.7);
      });

    doc.moveDown(2);

    // ── Info buku ─────────────────────────────────────────────
    const infoY = doc.y;
    doc.moveTo(margin, infoY).lineTo(W - margin, infoY)
       .strokeColor('#dddddd').lineWidth(0.5).stroke();

    doc.moveDown(1);
    doc.font('Helvetica')
       .fontSize(8.5)
       .fillColor('#888888')
       .text(
         `${sanitize(book.title)}  ·  ${sanitize(book.author)}  ·  ${book.year}\n` +
         `Dipublikasikan oleh Revpeak — revpeak.web.id`,
         { align: 'center', lineGap: 2 }
       );

    doc.end();
  });
}

// ── MAIN ──────────────────────────────────────────────────────
async function main() {
  console.log('======================================');
  console.log(' REVPEAK — Agen Perpustakaan');
  console.log(` ${new Date().toISOString()}`);
  console.log('======================================\n');

  // 1. Ambil judul buku yang sudah ada (hindari duplikasi)
  console.log('[1/6] Mengambil daftar buku yang sudah ada...');
  let existingTitles = [];
  try {
    const rows = await sbSelect('books', 'title', 'order=created_at.desc&limit=60');
    existingTitles = rows.map(r => r.title);
    console.log(`      ${existingTitles.length} buku sudah ada di database.\n`);
  } catch (e) {
    console.warn('      Gagal ambil data lama (lanjut tanpa filter):', e.message, '\n');
  }

  const excludeSection = existingTitles.length
    ? `\nJangan pilih buku yang sudah ada dalam daftar berikut:\n${existingTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
    : '';

  // 2. Riset buku dengan Gemini + Google Search
  console.log('[2/6] Meminta Gemini memilih & meiriset buku...');

  const prompt = `Kamu adalah kurator perpustakaan digital Revpeak berbahasa Indonesia.
Tugasmu: pilih 1 buku nyata yang terkenal, populer, dan layak dibaca (fiksi atau non-fiksi), lalu riset informasi lengkapnya dari internet.
${excludeSection}
Tulis output PERSIS dengan format berikut. Jangan gunakan tanda bintang, markdown, atau poin bertanda. Pisahkan setiap label dengan baris baru:

JUDUL: [judul asli buku]
PENULIS: [nama penulis lengkap]
PENERBIT: [nama penerbit asli buku]
TAHUN: [tahun pertama terbit]
GENRE: [genre dalam bahasa Indonesia, contoh: Fiksi Ilmiah]
SINOPSIS: [2–3 paragraf sinopsis menarik dalam bahasa Indonesia, pisahkan tiap paragraf dengan baris kosong]
RESENSI: [6–8 paragraf resensi mendalam dalam bahasa Indonesia mencakup: keunggulan gaya penulisan, tema utama, kekuatan cerita/argumen, dampak pada pembaca, dan rekomendasi untuk siapa buku ini cocok. Pisahkan tiap paragraf dengan baris kosong.]
VISUAL_COVER: [1 kalimat deskripsi visual dalam bahasa Inggris untuk ilustrasi cover buku, gaya artistic book cover illustration]`;

  const raw = await callGemini(prompt, true);
  if (!raw) throw new Error('Gemini tidak mengembalikan output.');
  console.log('      Output diterima dari Gemini.\n');

  // 3. Parse output
  console.log('[3/6] Mem-parse output...');
  const title      = parseLabel(raw, 'JUDUL');
  const author     = parseLabel(raw, 'PENULIS');
  const publisher  = parseLabel(raw, 'PENERBIT');
  const yearStr    = parseLabel(raw, 'TAHUN');
  const genre      = parseLabel(raw, 'GENRE');
  const description = parseLabel(raw, 'SINOPSIS');
  const resensi    = parseLabel(raw, 'RESENSI');
  const visualDesc = parseLabel(raw, 'VISUAL_COVER');
  const year       = parseInt(yearStr) || new Date().getFullYear();

  if (!title || !author || !description || !resensi) {
    console.error('      Raw output:\n', raw);
    throw new Error('Output Gemini tidak lengkap. Field wajib kosong.');
  }

  const slug = toSlug(title);
  console.log(`      Judul  : ${title}`);
  console.log(`      Penulis: ${author}`);
  console.log(`      Tahun  : ${year}`);
  console.log(`      Genre  : ${genre}`);
  console.log(`      Slug   : ${slug}\n`);

  // Cek duplikasi slug
  const dup = await sbSelect('books', 'id', `slug=eq.${encodeURIComponent(slug)}`);
  if (dup.length > 0) {
    console.log(`      Buku dengan slug "${slug}" sudah ada. Proses dihentikan.`);
    process.exit(0);
  }

  // Resolve genre_id dari tabel book_genres
  console.log('      Mencari/membuat genre di book_genres...');
  const genreId = await resolveGenreId(genre);
  console.log(`      genre_id: ${genreId ?? '(tidak ditemukan)'}\n`);

  // 4. Buat dokumen PDF
  console.log('[4/6] Membuat dokumen PDF...');
  const pdfBuffer = await buildPDF({ title, author, year, genre, description, resensi });
  const pdfSizeKB = (pdfBuffer.length / 1024).toFixed(1);
  // Estimasi halaman: ~1400 karakter teks per halaman A5 font 10pt
  const estPages  = Math.max(8, Math.round((description.length + resensi.length) / 1400));
  console.log(`      Ukuran PDF : ${pdfSizeKB} KB`);
  console.log(`      Est. halaman: ${estPages}\n`);

  // 5. Upload PDF ke R2
  console.log('[5/6] Upload PDF ke R2...');
  const pdfKey  = `ebooks/${slug}.pdf`;
  const fileUrl = await uploadR2(pdfKey, pdfBuffer, 'application/pdf');
  console.log(`      File URL: ${fileUrl}\n`);

  // 6. Generate & upload cover
  console.log('[6/6] Membuat cover buku...');
  let coverUrl = 'https://placehold.co/270x480/EFECE6/6B6560?text=No+Cover';
  try {
    const coverPrompt  = `${visualDesc}, professional book cover design, elegant, high quality, detailed illustration, publishing industry standard`;
    const coverBuffer  = await generateCoverImage(coverPrompt);
    const coverKey     = `covers/books/${slug}.jpg`;
    coverUrl           = await uploadR2(coverKey, coverBuffer, 'image/jpeg');
    console.log(`      Cover URL: ${coverUrl}\n`);
  } catch (e) {
    console.warn(`      Cover gagal di-generate: ${e.message}`);
    console.warn('      Menggunakan cover fallback.\n');
  }

  // 7. Simpan ke Supabase
  console.log('[7/7] Menyimpan ke Supabase tabel `books`...');
  const now    = new Date().toISOString();
  const record = {
    slug,
    title,
    author,
    publisher     : publisher || null,
    year,
    genre,
    genre_id      : genreId,
    description,
    cover_url     : coverUrl,
    cover_alt     : `Cover buku ${title} oleh ${author}`,
    file_url      : fileUrl,
    file_type     : 'pdf',
    file_size     : pdfBuffer.length,
    pages         : estPages,
    language      : 'id',
    status        : 'published',
    view_count    : 0,
    download_count: 0,
    created_at    : now,
    updated_at    : now,
  };

  await sbInsert('books', record);

  console.log('\n======================================');
  console.log(` ✅ BERHASIL: "${title}"`);
  console.log('======================================\n');
}

main().catch(err => {
  console.error('\n❌ GAGAL:', err.message);
  process.exit(1);
});
