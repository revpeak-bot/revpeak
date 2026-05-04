// ============================================================
// REVPEAK — agen-konten.js
// GitHub Actions + Cloudflare Workers AI REST API
// Pendekatan multi-bagian untuk artikel 2000–4000 kata:
//   Langkah 1 : metadata (title, excerpt, tags, image_query)
//   Langkah 2 : outline (daftar sub-judul section)
//   Langkah 3 : konten tiap section secara terpisah
//   Langkah 4 : gabung semua section → satu HTML lengkap
// ============================================================

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN   = process.env.CF_AI_TOKEN;
const UNSPLASH_KEY  = process.env.UNSPLASH_ACCESS_KEY;

const CF_AI_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`;

// Jumlah section per tipe konten
// artikel : 7 section × ~400 kata = ~2800 kata
// news    : 4 section × ~350 kata = ~1400 kata (berita tidak perlu sepanjang artikel)
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

// ============================================================
// CLOUDFLARE WORKERS AI — panggil model
// maxTokens bisa disesuaikan per kebutuhan call
// ============================================================

async function callAI(prompt, maxTokens = 1200) {
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
// LANGKAH 1 — Metadata
// ============================================================

async function generateMetadata(topik, subtopik, postType) {
  const isBerita = postType === "news";

  const prompt = `Buat metadata untuk ${isBerita ? "berita" : "artikel"} tentang "${subtopik}" kategori ${topik}.

Balas dengan format ini PERSIS (satu nilai per baris, tanpa penjelasan lain):
TITLE: [judul menarik maksimal 80 karakter dalam bahasa Indonesia]
EXCERPT: [ringkasan 1-2 kalimat maksimal 160 karakter dalam bahasa Indonesia]
TAGS: [tag1, tag2, tag3]
IMAGE: [2-3 kata bahasa Inggris untuk cari foto di Unsplash]`;

  const raw = await callAI(prompt, 512);

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

// ============================================================
// LANGKAH 2 — Outline (daftar sub-judul section)
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
      .replace(/^[-•*\d.]+\s*/, "")   // hapus bullet / nomor
      .replace(/\*\*/g, "")            // hapus markdown bold
      .replace(/^["']|["']$/g, "")     // hapus tanda kutip
    )
    .filter(l => l.length > 4)
    .slice(0, SECTION_COUNT[postType] ?? 6);

  // Fallback jika model mengembalikan respons aneh
  if (sections.length < 2) {
    return isBerita
      ? ["Latar Belakang", "Detail Peristiwa", "Dampak dan Analisis", "Kesimpulan"]
      : ["Pendahuluan", "Pengertian dan Konsep Dasar", "Manfaat Utama", "Cara Penerapan", "Tantangan yang Perlu Diwaspadai", "Tren dan Masa Depan", "Kesimpulan"];
  }

  return sections;
}

// ============================================================
// LANGKAH 3 — Generate tiap section secara terpisah
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
  // 1. Buat outline
  log("📐 Membuat outline artikel...");
  const sections = await generateOutline(topik, subtopik, postType, title);
  log(`✅ Outline (${sections.length} section): ${sections.join(" | ")}`);

  // 2. Generate tiap section
  const parts = [];
  for (let i = 0; i < sections.length; i++) {
    log(`✍️  Menulis section ${i + 1}/${sections.length}: "${sections[i]}"...`);
    try {
      const part = await generateSection(subtopik, title, sections[i], i, sections.length);
      parts.push(part);
      const kata = hitungKata(part);
      log(`✅ Section ${i + 1} selesai: ~${kata} kata`);
    } catch (e) {
      log(`⚠️  Section ${i + 1} gagal: ${e.message}, dilewati`);
    }
    // Jeda kecil antar call untuk menghindari rate limit
    if (i < sections.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  const fullContent = parts.join("\n\n");
  const totalKata   = hitungKata(fullContent);
  log(`📊 Total konten: ${fullContent.length} karakter | ~${totalKata} kata`);
  return fullContent;
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

  // Langkah 1 — Metadata
  log("📋 Membuat metadata...");
  let meta;
  try {
    meta = await generateMetadata(topikDipilih.kategori, subtopik, topikDipilih.post_type);
    log(`✅ Judul : "${meta.title}"`);
    log(`📎 Tags  : ${meta.tags.join(", ")}`);
  } catch (e) {
    console.error(`❌ Gagal buat metadata: ${e.message}`);
    process.exit(1);
  }

  // Langkah 2 & 3 — Outline + konten per section
  log("✍️  Membuat konten artikel (multi-bagian)...");
  let content;
  try {
    content = await generateArticleByParts(
      topikDipilih.kategori,
      subtopik,
      topikDipilih.post_type,
      meta.title
    );
  } catch (e) {
    console.error(`❌ Gagal buat konten: ${e.message}`);
    process.exit(1);
  }

  if (!content || content.trim().length < 100) {
    console.error("❌ Konten terlalu pendek atau kosong.");
    process.exit(1);
  }

  // Slug unik
  let slug      = slugify(meta.title);
  let slugFinal = slug;
  for (let i = 1; (await slugExists(slugFinal)) && i <= 5; i++) {
    slugFinal = `${slug}-${i}`;
    log(`⚠️  Slug duplikat, coba: ${slugFinal}`);
  }

  // Thumbnail
  log(`🖼️  Mencari gambar: "${meta.imageQuery}"...`);
  const thumb = await fetchThumbnail(meta.imageQuery);
  log(thumb.url ? `✅ Gambar: ${thumb.url}` : "⚠️  Tanpa gambar.");

  // Category & Author
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
