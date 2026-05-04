// ============================================================
// REVPEAK — agen-konten.js
// GitHub Actions + Cloudflare Workers AI REST API
// Pendekatan multi-bagian untuk artikel 2000–4000 kata:
//   Langkah 1 : metadata (title, excerpt, tags, image_prompt)
//   Langkah 2 : outline (daftar sub-judul section)
//   Langkah 3 : konten tiap section secara terpisah
//   Langkah 4 : gabung semua section → satu HTML lengkap
//   Langkah 5 : generate gambar via CF Workers AI → upload R2
// ============================================================

const SUPABASE_URL           = process.env.SUPABASE_URL;
const SUPABASE_KEY           = process.env.SUPABASE_KEY;           // SUPABASE_KEY (anon/service key)
const CF_ACCOUNT_ID          = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN            = process.env.CF_AI_TOKEN;
const CF_R2_PUBLIC_URL       = process.env.CF_R2_PUBLIC_URL;       // base URL publik R2
const CF_R2_ACCESS_KEY_ID    = process.env.CF_R2_ACCESS_KEY_ID;    // S3-compatible access key
const CF_R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY; // S3-compatible secret key

// Nama bucket R2 diambil dari CF_R2_PUBLIC_URL atau di-hardcode
// Format CF_R2_PUBLIC_URL: https://<accountid>.r2.cloudflarestorage.com/<bucket>
// atau custom domain. Bucket diparse otomatis dari URL jika menggunakan
// endpoint r2.cloudflarestorage.com, atau bisa di-set manual di sini:
const CF_R2_BUCKET = (() => {
  if (!CF_R2_PUBLIC_URL) return "";
  // Coba parse bucket dari URL r2.cloudflarestorage.com/<bucket>
  const m = CF_R2_PUBLIC_URL.match(/cloudflarestorage\.com\/([^/?#]+)/);
  if (m) return m[1];
  // Fallback: ambil segment pertama setelah domain sebagai bucket
  try {
    const u = new URL(CF_R2_PUBLIC_URL);
    const seg = u.pathname.replace(/^\//, "").split("/")[0];
    return seg || "revpeak-media";
  } catch { return "revpeak-media"; }
})();

// ============================================================
// URL ENDPOINT
// ============================================================

const CF_AI_BASE    = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run`;
const CF_AI_TEXT    = `${CF_AI_BASE}/@cf/meta/llama-3.1-8b-instruct`;
const CF_AI_IMAGE   = `${CF_AI_BASE}/@cf/stabilityai/stable-diffusion-xl-base-1.0`;
// Alternatif model gambar yang lebih cepat (uncomment jika perlu):
// const CF_AI_IMAGE = `${CF_AI_BASE}/@cf/bytedance/stable-diffusion-xl-lightning`;

// Endpoint S3-compatible Cloudflare R2
const CF_R2_ENDPOINT = `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Jumlah section per tipe konten
const SECTION_COUNT = { article: 7, news: 4 };

// ============================================================
// TOPIK
// ============================================================

const TOPIK = [
  {
    kategori: "Teknologi", slug_kategori: "teknologi", post_type: "article",
    subtopik: [
      "kecerdasan buatan dan penerapannya dalam kehidupan sehari-hari",
      "smartphone terbaru dan inovasinya di tahun ini",
      "keamanan siber dan cara melindungi data pribadi",
      "cloud computing dan manfaatnya untuk bisnis kecil",
      "perkembangan chip AI terbaru dari perusahaan teknologi besar",
      "internet of things dan rumah pintar masa depan",
      "open source software yang wajib diketahui developer",
      "tips memilih laptop terbaik sesuai kebutuhan",
    ],
  },
  {
    kategori: "Sains", slug_kategori: "sains", post_type: "article",
    subtopik: [
      "penemuan terbaru dalam eksplorasi luar angkasa",
      "penelitian terkini tentang Mars dan planet lain",
      "dampak perubahan iklim terhadap ekosistem bumi",
      "bioteknologi modern dan dampaknya bagi kesehatan",
      "fisika kuantum dijelaskan dengan cara sederhana",
      "energi terbarukan dan potensinya menggantikan fosil",
      "fenomena alam langka yang menakjubkan",
      "penelitian otak manusia dan misteri kesadaran",
    ],
  },
  {
    kategori: "Bisnis", slug_kategori: "bisnis", post_type: "article",
    subtopik: [
      "strategi membangun startup dari nol hingga berhasil",
      "panduan investasi saham untuk pemula",
      "tren ekonomi digital yang perlu diperhatikan",
      "cara mengembangkan UMKM melalui platform digital",
      "tips manajemen keuangan pribadi yang efektif",
      "kepemimpinan efektif di era kerja hybrid",
      "strategi digital marketing untuk bisnis lokal",
      "inovasi fintech yang mengubah cara bertransaksi",
    ],
  },
  {
    kategori: "Gaya Hidup", slug_kategori: "gaya-hidup", post_type: "article",
    subtopik: [
      "tips produktivitas bekerja dari rumah yang terbukti efektif",
      "cara menjaga kesehatan mental di tengah kesibukan",
      "olahraga praktis yang bisa dilakukan di rumah",
      "panduan pola makan sehat dan bergizi",
      "tips traveling hemat namun tetap menyenangkan",
      "kebiasaan pagi yang dilakukan orang sukses dunia",
      "panduan meditasi untuk pemula",
      "cara mencapai keseimbangan kerja dan kehidupan pribadi",
    ],
  },
  {
    kategori: "Teknologi", slug_kategori: "teknologi", post_type: "news",
    subtopik: [
      "peluncuran produk teknologi terbaru yang menggemparkan industri",
      "kebijakan baru platform media sosial yang berdampak luas",
      "regulasi AI terbaru dan dampaknya bagi pengembang",
      "update sistem operasi terbaru dengan fitur baru",
    ],
  },
  {
    kategori: "Bisnis", slug_kategori: "bisnis", post_type: "news",
    subtopik: [
      "perkembangan ekonomi digital Indonesia terkini",
      "startup Indonesia yang berhasil mendapatkan pendanaan besar",
      "kebijakan moneter dan dampaknya terhadap investasi",
      "tren pasar kerja teknologi di Indonesia dan global",
    ],
  },
];

// ============================================================
// UTILS
// ============================================================

const pilihAcak = arr => arr[Math.floor(Math.random() * arr.length)];

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim().replace(/\s+/g, "-")
    .replace(/-+/g, "-").substring(0, 80);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function hitungKata(html) {
  return html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

/** Hitung estimasi waktu baca dalam menit (asumsi 200 kata/menit) */
function hitungReadingTime(html) {
  return Math.max(1, Math.round(hitungKata(html) / 200));
}

/** Generate nama file unik untuk R2 */
function generateFileName(slug) {
  const ts   = Date.now();
  const rand = Math.random().toString(36).substring(2, 8);
  return `thumbnails/${slug}-${ts}-${rand}.png`;
}

// ============================================================
// CLOUDFLARE WORKERS AI — panggil model teks
// ============================================================

async function callAI(prompt, maxTokens = 1200) {
  const res = await fetch(CF_AI_TEXT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_AI_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: "Anda adalah editor konten profesional untuk website Indonesia bernama Revpeak. Ikuti instruksi dengan tepat.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens:  maxTokens,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI ${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.result?.response || "";
  if (!text) throw new Error("CF AI tidak mengembalikan respons");
  return text.trim();
}

// ============================================================
// CLOUDFLARE WORKERS AI — generate gambar (binary PNG)
// ============================================================

/**
 * Menghasilkan gambar PNG dari prompt teks menggunakan
 * Stable Diffusion XL via Cloudflare Workers AI.
 * Mengembalikan ArrayBuffer berisi byte PNG.
 */
async function generateImage(prompt) {
  log(`🎨 Generating gambar AI: "${prompt}"...`);

  const res = await fetch(CF_AI_IMAGE, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_AI_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      prompt,
      num_steps: 20,          // kualitas vs kecepatan (8–50)
      guidance:  7.5,         // kesetiaan ke prompt
      width:     1024,
      height:    576,         // rasio 16:9 untuk thumbnail web
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI Image ${res.status}: ${err.substring(0, 200)}`);
  }

  // Workers AI Image endpoint mengembalikan binary langsung (ReadableStream)
  const buffer = await res.arrayBuffer();
  if (!buffer || buffer.byteLength < 1000) {
    throw new Error("Gambar yang dihasilkan terlalu kecil atau kosong");
  }

  log(`✅ Gambar berhasil dibuat: ${(buffer.byteLength / 1024).toFixed(1)} KB`);
  return buffer;
}

// ============================================================
// CLOUDFLARE R2 — upload gambar
// ============================================================

// ── AWS Signature v4 helpers (untuk S3-compatible R2) ──────────────

/** Encode string ke hex */
const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 hash → hex string */
async function sha256Hex(data) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}

/** HMAC-SHA256 → ArrayBuffer */
async function hmacSha256(key, data) {
  const keyBuf  = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const dataBuf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, dataBuf);
}

/** Derive AWS Sig v4 signing key */
async function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = await hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion  = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

/**
 * Upload ArrayBuffer PNG ke Cloudflare R2 melalui S3-compatible API
 * menggunakan AWS Signature v4 (HMAC credentials).
 * Mengembalikan URL publik gambar.
 */
async function uploadToR2(imageBuffer, fileName) {
  log(`☁️  Upload ke R2: ${fileName}...`);

  const region  = "auto";
  const service = "s3";
  const now     = new Date();

  // Format tanggal untuk Sig v4
  const dateStamp  = now.toISOString().replace(/[-:]/g, "").split("T")[0];          // YYYYMMDD
  const amzDate    = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");   // YYYYMMDDTHHmmssZ

  const bucket    = CF_R2_BUCKET;
  const objectKey = fileName;                          // e.g. "thumbnails/slug-ts-rand.png"
  const host      = `${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const uploadUrl = `${CF_R2_ENDPOINT}/${bucket}/${objectKey}`;

  const contentType   = "image/png";
  const payloadHash   = await sha256Hex(imageBuffer);

  // Canonical headers (harus lowercase, sorted)
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${bucket}/${objectKey}`,
    "",                    // query string (kosong)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSigningKey(CF_R2_SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature  = toHex(await hmacSha256(signingKey, stringToSign));

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${CF_R2_ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(uploadUrl, {
    method:  "PUT",
    headers: {
      "Authorization":        authorizationHeader,
      "Content-Type":         contentType,
      "x-amz-date":           amzDate,
      "x-amz-content-sha256": payloadHash,
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 Upload ${res.status}: ${err.substring(0, 300)}`);
  }

  // URL publik: gunakan CF_R2_PUBLIC_URL (custom domain atau URL publik bucket)
  const publicUrl = `${CF_R2_PUBLIC_URL.replace(/\/$/, "")}/${fileName}`;
  log(`✅ Upload R2 berhasil: ${publicUrl}`);
  return publicUrl;
}

/**
 * Orkestrator: generate gambar AI → upload ke R2 → kembalikan URL publik.
 * Jika gagal, kembalikan null (konten tetap disimpan tanpa gambar).
 */
async function generateAndUploadImage(imagePrompt, slug) {
  try {
    const imageBuffer = await generateImage(imagePrompt);
    const fileName    = generateFileName(slug);
    const publicUrl   = await uploadToR2(imageBuffer, fileName);
    return { url: publicUrl, alt: imagePrompt, fileName };
  } catch (e) {
    log(`⚠️  Gagal generate/upload gambar: ${e.message}`);
    return { url: null, alt: imagePrompt, fileName: null };
  }
}

// ============================================================
// LANGKAH 1 — Metadata (termasuk prompt gambar untuk AI)
// ============================================================

async function generateMetadata(topik, subtopik, postType) {
  const isBerita = postType === "news";

  const prompt = `Buat metadata untuk ${isBerita ? "berita" : "artikel"} tentang "${subtopik}" kategori ${topik}.

Balas dengan format ini PERSIS (satu nilai per baris, tanpa penjelasan lain):
TITLE: [judul menarik maksimal 80 karakter dalam bahasa Indonesia]
EXCERPT: [ringkasan 1-2 kalimat maksimal 160 karakter dalam bahasa Indonesia]
TAGS: [tag1, tag2, tag3, tag4, tag5]
META_DESC: [meta description SEO 120-155 karakter bahasa Indonesia]
IMAGE_PROMPT: [deskripsi gambar dalam bahasa Inggris untuk AI image generator, spesifik dan visual, 10-20 kata, gaya fotorealistik profesional, contoh: "modern laptop on clean desk with glowing holographic AI interface, professional studio lighting, 4k"]`;

  const raw = await callAI(prompt, 600);

  const get = (key) => {
    const m = raw.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return m ? m[1].trim() : "";
  };

  const title        = get("TITLE")        || subtopik.substring(0, 70);
  const excerpt      = get("EXCERPT")      || "";
  const metaDesc     = get("META_DESC")    || excerpt;
  const tagsRaw      = get("TAGS")         || "";
  const imagePrompt  = get("IMAGE_PROMPT") || `${topik.toLowerCase()} concept, professional photography, high quality`;

  const tags = tagsRaw
    .replace(/[\[\]]/g, "")
    .split(",")
    .map(t => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return { title, excerpt, metaDesc, tags, imagePrompt };
}

// ============================================================
// LANGKAH 2 — Outline
// ============================================================

async function generateOutline(topik, subtopik, postType, title) {
  const isBerita   = postType === "news";
  const jumlah     = SECTION_COUNT[postType] ?? 6;

  const tipeKonten = isBerita
    ? "artikel berita dengan struktur: latar belakang, detail peristiwa, dampak, analisis, penutup"
    : "artikel informatif mendalam dengan pendahuluan, beberapa sub-topik utama, dan kesimpulan";

  const prompt = `Buat outline untuk ${isBerita ? "berita" : "artikel"} panjang tentang "${subtopik}" kategori ${topik}.
Judul: ${title}
Tipe konten: ${tipeKonten}

Balas HANYA dengan daftar tepat ${jumlah} judul sub-bagian (tanpa nomor, tanpa penjelasan, satu per baris):`;

  const raw = await callAI(prompt, 512);

  const sections = raw
    .split("\n")
    .map(l => l.trim()
      .replace(/^[-•*\d.]+\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/^["']|["']$/g, "")
    )
    .filter(l => l.length > 4)
    .slice(0, SECTION_COUNT[postType] ?? 6);

  if (sections.length < 2) {
    return isBerita
      ? ["Latar Belakang", "Detail Peristiwa", "Dampak dan Analisis", "Kesimpulan"]
      : ["Pendahuluan", "Pengertian dan Konsep Dasar", "Manfaat Utama", "Cara Penerapan", "Tantangan yang Perlu Diwaspadai", "Tren dan Masa Depan", "Kesimpulan"];
  }

  return sections;
}

// ============================================================
// LANGKAH 3 — Generate tiap section
// ============================================================

async function generateSection(subtopik, title, sectionTitle, index, total) {
  const isFirst = index === 0;
  const isLast  = index === total - 1;

  let instruksi;
  if (isFirst) {
    instruksi = "Ini adalah bagian pembuka artikel. Mulai dengan paragraf hook yang menarik perhatian pembaca, lalu perkenalkan topik secara singkat.";
  } else if (isLast) {
    instruksi = "Ini adalah bagian penutup artikel. Tulis kesimpulan yang kuat, rangkum poin utama, dan beri pesan penutup yang berkesan.";
  } else {
    instruksi = "Ini adalah bagian isi artikel. Fokus pada sub-topik ini secara mendalam dengan informasi faktual dan contoh konkret.";
  }

  const prompt = `Tulis satu bagian dari artikel tentang "${subtopik}" untuk website Revpeak Indonesia.

Artikel berjudul: ${title}
Judul sub-bagian ini: ${sectionTitle}

Instruksi:
- ${instruksi}
- Tulis antara 350–500 kata untuk sub-bagian ini
- Mulai dengan tag <h2>${sectionTitle}</h2>
- Gunakan tag HTML: <p>, <ul>, <li>, <strong> sesuai kebutuhan
- Bahasa Indonesia baku yang mengalir dan mudah dipahami
- Isi dengan informasi faktual dan bermanfaat
- JANGAN tambahkan kalimat penutup seperti "Semoga bermanfaat" kecuali di bagian terakhir
- JANGAN ulangi hal yang sudah jelas ada di bagian lain
- Jangan sertakan tag <html>, <body>, atau <h1>`;

  return await callAI(prompt, 1200);
}

// ============================================================
// ORCHESTRATOR — gabungkan semua section
// ============================================================

async function generateArticleByParts(topik, subtopik, postType, title) {
  log("📐 Membuat outline artikel...");
  const sections = await generateOutline(topik, subtopik, postType, title);
  log(`✅ Outline (${sections.length} section): ${sections.join(" | ")}`);

  const parts = [];
  for (let i = 0; i < sections.length; i++) {
    log(`✍️  Menulis section ${i + 1}/${sections.length}: "${sections[i]}"...`);
    try {
      const part = await generateSection(subtopik, title, sections[i], i, sections.length);
      parts.push(part);
      log(`✅ Section ${i + 1} selesai: ~${hitungKata(part)} kata`);
    } catch (e) {
      log(`⚠️  Section ${i + 1} gagal: ${e.message}, dilewati`);
    }
    if (i < sections.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  const fullContent = parts.join("\n\n");
  log(`📊 Total konten: ${fullContent.length} karakter | ~${hitungKata(fullContent)} kata`);
  return fullContent;
}

// ============================================================
// SUPABASE
// ============================================================

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        options.prefer || "return=representation",
    },
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(`Supabase: ${JSON.stringify(data)}`);
  return data;
}

async function getCategoryId(slug) {
  try {
    const r = await sbFetch(`/categories?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    return r?.[0]?.id || null;
  } catch { return null; }
}

async function getAuthorId() {
  try {
    const r = await sbFetch("/authors?select=id&order=id.asc&limit=10");
    return r?.length ? pilihAcak(r).id : null;
  } catch { return null; }
}

async function slugExists(slug) {
  try {
    const r = await sbFetch(`/articles?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    return r?.length > 0;
  } catch { return false; }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  log("🤖 Agen konten Revpeak mulai...");

  // Validasi env vars
  const required = [
    ["SUPABASE_URL",              SUPABASE_URL],
    ["SUPABASE_KEY",              SUPABASE_KEY],
    ["CF_ACCOUNT_ID",             CF_ACCOUNT_ID],
    ["CF_AI_TOKEN",               CF_AI_TOKEN],
    ["CF_R2_PUBLIC_URL",          CF_R2_PUBLIC_URL],
    ["CF_R2_ACCESS_KEY_ID",       CF_R2_ACCESS_KEY_ID],
    ["CF_R2_SECRET_ACCESS_KEY",   CF_R2_SECRET_ACCESS_KEY],
  ];

  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`❌ ENV tidak ditemukan: ${missing.join(", ")}`);
    process.exit(1);
  }

  // ── Pilih topik ──────────────────────────────────────────────
  const topikDipilih = pilihAcak(TOPIK);
  const subtopik     = pilihAcak(topikDipilih.subtopik);

  log(`📌 Topik : [${topikDipilih.kategori}] ${subtopik}`);
  log(`📄 Tipe  : ${topikDipilih.post_type}`);

  // ── Langkah 1 — Metadata ─────────────────────────────────────
  log("📋 Membuat metadata...");
  let meta;
  try {
    meta = await generateMetadata(topikDipilih.kategori, subtopik, topikDipilih.post_type);
    log(`✅ Judul        : "${meta.title}"`);
    log(`📎 Tags         : ${meta.tags.join(", ")}`);
    log(`🎨 Image prompt : "${meta.imagePrompt}"`);
  } catch (e) {
    console.error(`❌ Gagal buat metadata: ${e.message}`);
    process.exit(1);
  }

  // ── Slug unik ────────────────────────────────────────────────
  let slug      = slugify(meta.title);
  let slugFinal = slug;
  for (let i = 1; (await slugExists(slugFinal)) && i <= 5; i++) {
    slugFinal = `${slug}-${i}`;
    log(`⚠️  Slug duplikat, coba: ${slugFinal}`);
  }

  // ── Langkah 5 — Generate & Upload Gambar (paralel dengan konten) ──
  // Gambar dan konten di-generate secara paralel untuk menghemat waktu
  log("🚀 Memulai generate gambar & konten secara paralel...");

  const [imageResult, content] = await Promise.allSettled([
    generateAndUploadImage(meta.imagePrompt, slugFinal),
    generateArticleByParts(topikDipilih.kategori, subtopik, topikDipilih.post_type, meta.title),
  ]);

  // Ambil hasil gambar
  const thumb = imageResult.status === "fulfilled"
    ? imageResult.value
    : { url: null, alt: meta.imagePrompt, fileName: null };

  if (imageResult.status === "rejected") {
    log(`⚠️  Generate gambar gagal total: ${imageResult.reason}`);
  }
  log(thumb.url ? `✅ Thumbnail URL : ${thumb.url}` : "⚠️  Artikel disimpan tanpa gambar.");

  // Ambil hasil konten
  if (content.status === "rejected") {
    console.error(`❌ Gagal buat konten: ${content.reason}`);
    process.exit(1);
  }
  const articleContent = content.value;

  if (!articleContent || articleContent.trim().length < 100) {
    console.error("❌ Konten terlalu pendek atau kosong.");
    process.exit(1);
  }

  // ── Category & Author ────────────────────────────────────────
  const [categoryId, authorId] = await Promise.all([
    getCategoryId(topikDipilih.slug_kategori),
    getAuthorId(),
  ]);
  log(`🗂️  Category: ${categoryId ?? "null"} | Author: ${authorId ?? "null"}`);

  // ── Hitung reading time ──────────────────────────────────────
  const readingTime = hitungReadingTime(articleContent);
  const wordCount   = hitungKata(articleContent);
  log(`📊 Word count: ${wordCount} | Reading time: ${readingTime} menit`);

  // ── Simpan ke Supabase ───────────────────────────────────────
  log("💾 Menyimpan ke Supabase...");
  try {
    const publishedAt = new Date().toISOString();

    // Kolom inti yang hampir pasti ada di semua skema articles
    const payloadCore = {
      title:        meta.title,
      slug:         slugFinal,
      excerpt:      meta.excerpt,
      content:      articleContent,
      status:       "published",
      category_id:  categoryId,
      author_id:    authorId,
      published_at: publishedAt,
      created_at:   publishedAt,
      updated_at:   publishedAt,
    };

    // Kolom opsional — hapus baris yang kolomnya tidak ada di tabel Supabase kamu
    const payloadOptional = {
      post_type:     topikDipilih.post_type,  // 'article' | 'news'
      tags:          meta.tags,               // TEXT[] atau JSONB
      thumbnail_url: thumb.url,               // URL publik R2
      reading_time:  readingTime,             // dalam menit
      view_count:    0,
    };

    const payload = { ...payloadCore, ...payloadOptional };

    // Coba simpan dengan payload lengkap dulu
    let hasil;
    try {
      hasil = await sbFetch("/articles", {
        method: "POST",
        body:   JSON.stringify(payload),
      });
    } catch (eFull) {
      // Jika gagal karena kolom tidak dikenal, fallback ke kolom inti saja
      log(`⚠️  Payload lengkap gagal (${eFull.message}), coba kolom inti...`);
      hasil = await sbFetch("/articles", {
        method: "POST",
        body:   JSON.stringify(payloadCore),
      });
    }

    log(`✅ Artikel tersimpan — ID: ${hasil?.[0]?.id ?? "?"}`);
    log(`🔗 URL: https://revpeak.web.id/${topikDipilih.slug_kategori}/${slugFinal}`);
  } catch (e) {
    console.error(`❌ Gagal simpan ke Supabase: ${e.message}`);
    process.exit(1);
  }

  log("🎉 Selesai.");
}

main().catch(e => { console.error("❌", e); process.exit(1); });
