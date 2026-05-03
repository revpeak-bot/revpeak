// ============================================================
// REVPEAK — agen-konten.js
// GitHub Actions + Cloudflare Workers AI REST API
// Menggunakan pendekatan dua langkah untuk menghindari
// masalah parsing JSON dari respons AI
// ============================================================

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN   = process.env.CF_AI_TOKEN;
const UNSPLASH_KEY  = process.env.UNSPLASH_ACCESS_KEY;

const CF_AI_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`;

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

// ============================================================
// CLOUDFLARE WORKERS AI — panggil model
// ============================================================

async function callAI(prompt) {
  const res = await fetch(CF_AI_URL, {
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
      max_tokens:  2048,
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
// GENERATE KONTEN — dua langkah terpisah
// Langkah 1: metadata (title, excerpt, tags, image_query)
// Langkah 2: konten HTML
// Tidak menggunakan JSON.parse untuk menghindari error karakter
// ============================================================

async function generateMetadata(topik, subtopik, postType) {
  const isBerita = postType === "news";

  const prompt = `Buat metadata untuk ${isBerita ? "berita" : "artikel"} tentang "${subtopik}" kategori ${topik}.

Balas dengan format ini PERSIS (satu nilai per baris, tanpa penjelasan lain):
TITLE: [judul menarik maksimal 80 karakter dalam bahasa Indonesia]
EXCERPT: [ringkasan 1-2 kalimat maksimal 160 karakter dalam bahasa Indonesia]
TAGS: [tag1, tag2, tag3]
IMAGE: [2-3 kata bahasa Inggris untuk cari foto di Unsplash]`;

  const raw = await callAI(prompt);

  // Ekstrak dengan regex — tidak ada JSON sama sekali
  const get = (key) => {
    const m = raw.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return m ? m[1].trim() : "";
  };

  const title      = get("TITLE")   || subtopik.substring(0, 70);
  const excerpt    = get("EXCERPT") || "";
  const tagsRaw    = get("TAGS")    || "";
  const imageQuery = get("IMAGE")   || topik.toLowerCase();

  const tags = tagsRaw
    .replace(/[\[\]]/g, "")
    .split(",")
    .map(t => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return { title, excerpt, tags, imageQuery };
}

async function generateContent(topik, subtopik, postType, title) {
  const isBerita = postType === "news";

  const prompt = `Tulis ${isBerita ? "berita" : "artikel"} lengkap dalam bahasa Indonesia tentang "${subtopik}" untuk website Revpeak.

Judul artikel: ${title}

Persyaratan:
- Minimal 500 kata
- Tulis dalam format HTML dengan tag: <h2>, <h3>, <p>, <ul>, <li>, <strong>
- ${isBerita ? "Format berita: paragraf utama berisi inti berita, lalu detail dan konteks" : "Format artikel: pendahuluan menarik, isi mendalam dengan beberapa sub-bagian, kesimpulan"}
- Bahasa Indonesia baku yang mudah dipahami
- Isi dengan fakta dan informasi yang bermanfaat
- JANGAN tambahkan judul utama (h1) karena sudah ada di halaman
- Mulai langsung dengan konten, bukan dengan kata "Berikut" atau sejenisnya`;

  return await callAI(prompt);
}

// ============================================================
// UNSPLASH
// ============================================================

async function fetchThumbnail(query) {
  if (!UNSPLASH_KEY) return { url: null, alt: query };
  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`,
      { headers: { "Authorization": `Client-ID ${UNSPLASH_KEY}` } }
    );
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    return { url: data.urls?.regular || null, alt: data.alt_description || query };
  } catch (e) {
    log(`⚠️  Unsplash gagal: ${e.message}`);
    return { url: null, alt: query };
  }
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

  // Validasi env
  const missing = [
    ["SUPABASE_URL",        SUPABASE_URL],
    ["SUPABASE_SERVICE_KEY", SUPABASE_KEY],
    ["CF_ACCOUNT_ID",       CF_ACCOUNT_ID],
    ["CF_AI_TOKEN",         CF_AI_TOKEN],
  ].filter(([, v]) => !v).map(([k]) => k);

  if (missing.length) {
    console.error(`❌ ENV tidak ditemukan: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Pilih topik
  const topikDipilih = pilihAcak(TOPIK);
  const subtopik     = pilihAcak(topikDipilih.subtopik);

  log(`📌 Topik : [${topikDipilih.kategori}] ${subtopik}`);
  log(`📄 Tipe  : ${topikDipilih.post_type}`);

  // Langkah 1: Generate metadata
  log("📋 Membuat metadata (judul, excerpt, tags)...");
  let meta;
  try {
    meta = await generateMetadata(
      topikDipilih.kategori,
      subtopik,
      topikDipilih.post_type
    );
    log(`✅ Judul : "${meta.title}"`);
    log(`📎 Tags  : ${meta.tags.join(", ")}`);
  } catch (e) {
    console.error(`❌ Gagal buat metadata: ${e.message}`);
    process.exit(1);
  }

  // Langkah 2: Generate konten HTML
  log("✍️  Membuat konten artikel...");
  let content;
  try {
    content = await generateContent(
      topikDipilih.kategori,
      subtopik,
      topikDipilih.post_type,
      meta.title
    );
    log(`✅ Konten: ${content.length} karakter`);
  } catch (e) {
    console.error(`❌ Gagal buat konten: ${e.message}`);
    process.exit(1);
  }

  // Slug unik
  let slug = slugify(meta.title);
  let slugFinal = slug;
  for (let i = 1; (await slugExists(slugFinal)) && i <= 5; i++) {
    slugFinal = `${slug}-${i}`;
    log(`⚠️  Slug duplikat, coba: ${slugFinal}`);
  }

  // Thumbnail
  log(`🖼️  Mencari gambar: "${meta.imageQuery}"...`);
  const thumb = await fetchThumbnail(meta.imageQuery);
  log(thumb.url ? `✅ Gambar: ${thumb.url}` : "⚠️  Tanpa gambar.");

  // Category & author
  const [categoryId, authorId] = await Promise.all([
    getCategoryId(topikDipilih.slug_kategori),
    getAuthorId(),
  ]);
  log(`🗂️  Category: ${categoryId ?? "null"} | Author: ${authorId ?? "null"}`);

  // Simpan ke Supabase
  log("💾 Menyimpan ke Supabase...");
  try {
    const hasil = await sbFetch("/articles", {
      method: "POST",
      body: JSON.stringify({
        title:         meta.title,
        slug:          slugFinal,
        excerpt:       meta.excerpt,
        content:       content,
        post_type:     topikDipilih.post_type,
        status:        "published",
        category_id:   categoryId,
        author_id:     authorId,
        tags:          meta.tags,
        thumbnail_url: thumb.url,
        thumbnail_alt: thumb.alt,
        published_at:  new Date().toISOString(),
      }),
    });
    log(`✅ ID: ${hasil?.[0]?.id ?? "?"}`);
    log(`🔗 URL: https://revpeak.web.id/${slugFinal}`);
  } catch (e) {
    console.error(`❌ Gagal simpan: ${e.message}`);
    process.exit(1);
  }

  log("🎉 Selesai.");
}

main().catch(e => { console.error("❌", e); process.exit(1); });
