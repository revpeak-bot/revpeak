// ============================================================
// REVPEAK — agen-konten.js
// Agen AI otomatis pembuat artikel & berita
// Dijalankan via GitHub Actions setiap 4 jam
// ============================================================

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY; // service role key
const ANTHROPIC_KEY    = process.env.ANTHROPIC_API_KEY;
const UNSPLASH_KEY     = process.env.UNSPLASH_ACCESS_KEY;

// ============================================================
// KONFIGURASI TOPIK
// ============================================================

const TOPIK = [
  {
    kategori: "Teknologi",
    slug_kategori: "teknologi",
    post_type: "article",
    subtopik: [
      "kecerdasan buatan dan machine learning",
      "smartphone terbaru dan inovasinya",
      "keamanan siber dan privasi digital",
      "cloud computing untuk bisnis",
      "perkembangan chip dan prosesor",
      "internet of things dalam kehidupan",
      "teknologi blockchain dan kripto",
      "augmented reality dan virtual reality",
      "quantum computing masa depan",
      "open source software terpopuler",
    ],
  },
  {
    kategori: "Sains",
    slug_kategori: "sains",
    post_type: "article",
    subtopik: [
      "penemuan terbaru astronomi dan luar angkasa",
      "eksplorasi Mars dan planet lain",
      "perubahan iklim dan dampaknya",
      "bioteknologi dan rekayasa genetika",
      "fisika kuantum untuk pemula",
      "penemuan fosil dan paleontologi",
      "energi terbarukan dan masa depan bumi",
      "fenomena alam yang menakjubkan",
      "penelitian otak dan neurosains",
      "evolusi dan asal usul kehidupan",
    ],
  },
  {
    kategori: "Bisnis",
    slug_kategori: "bisnis",
    post_type: "article",
    subtopik: [
      "strategi startup yang berhasil",
      "investasi saham untuk pemula",
      "tren ekonomi global terkini",
      "UMKM digital dan e-commerce",
      "manajemen keuangan pribadi",
      "peluang bisnis online terkini",
      "kepemimpinan dan manajemen tim",
      "marketing digital yang efektif",
      "analisis pasar kripto terkini",
      "fintech dan inovasi perbankan",
    ],
  },
  {
    kategori: "Gaya Hidup",
    slug_kategori: "gaya-hidup",
    post_type: "article",
    subtopik: [
      "tips produktivitas kerja dari rumah",
      "kesehatan mental di era digital",
      "olahraga praktis untuk kesibukan",
      "nutrisi dan pola makan sehat",
      "traveling hemat dan tips wisata",
      "buku terbaik yang wajib dibaca",
      "minimalis dan hidup sederhana",
      "kebiasaan pagi orang sukses",
      "meditasi dan mindfulness",
      "work life balance generasi muda",
    ],
  },
  {
    kategori: "Teknologi",
    slug_kategori: "teknologi",
    post_type: "news",
    subtopik: [
      "berita peluncuran produk teknologi terbaru",
      "update kebijakan platform media sosial besar",
      "akuisisi perusahaan teknologi global",
      "regulasi AI terbaru dari pemerintah",
      "rilis update sistem operasi terbaru",
    ],
  },
  {
    kategori: "Bisnis",
    slug_kategori: "bisnis",
    post_type: "news",
    subtopik: [
      "berita ekonomi Indonesia terkini",
      "laporan kinerja perusahaan teknologi besar",
      "kebijakan bank sentral dan inflasi",
      "startup Indonesia yang baru dapat pendanaan",
      "tren PHK industri teknologi global",
    ],
  },
];

// ============================================================
// UTILS
// ============================================================

function pilihAcak(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 80);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ============================================================
// SUPABASE
// ============================================================

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      "apikey":        SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type":  "application/json",
      "Prefer":        options.prefer || "return=representation",
      ...options.headers,
    },
  });

  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(`Supabase error: ${JSON.stringify(data)}`);
  return data;
}

async function getCategoryId(slug) {
  try {
    const cats = await supabaseFetch(`/categories?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    return cats?.[0]?.id || null;
  } catch { return null; }
}

async function getAuthorId() {
  try {
    const authors = await supabaseFetch("/authors?select=id&order=id.asc&limit=10");
    if (!authors?.length) return null;
    return pilihAcak(authors).id;
  } catch { return null; }
}

async function slugExists(slug) {
  try {
    const res = await supabaseFetch(`/articles?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`);
    return res?.length > 0;
  } catch { return false; }
}

async function simpanArtikel(data) {
  return supabaseFetch("/articles", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================
// CLAUDE AI — Generate Konten
// ============================================================

async function generateKonten(topik, subtopik, postType) {
  const isBerita = postType === "news";

  const systemPrompt = `Anda adalah editor konten profesional untuk website berita dan artikel Indonesia bernama Revpeak. 
Tugas Anda menulis konten berkualitas tinggi dalam Bahasa Indonesia yang informatif, akurat, dan menarik.
Selalu tulis dalam format JSON yang valid tanpa markdown code block.`;

  const userPrompt = `Tulis ${isBerita ? "berita" : "artikel"} tentang: "${subtopik}" dalam kategori ${topik}.

Kembalikan HANYA JSON dengan format berikut (tanpa penjelasan tambahan):
{
  "title": "judul menarik dan SEO-friendly (max 80 karakter)",
  "excerpt": "ringkasan 1-2 kalimat yang menarik (max 160 karakter)",
  "content": "konten HTML lengkap dengan tag h2, h3, p, ul, li, strong. Min 600 kata. Gunakan struktur yang baik dengan beberapa sub-bagian.",
  "tags": ["tag1", "tag2", "tag3", "tag4"],
  "image_query": "kata kunci bahasa Inggris untuk mencari foto relevan di Unsplash (2-3 kata)"
}

Panduan konten:
- Bahasa Indonesia yang baku namun mudah dipahami
- Faktual dan informatif
- ${isBerita ? "Format berita: lead paragraph penting, lalu detail" : "Format artikel: pengantar, isi mendalam, kesimpulan"}
- Sertakan data atau fakta yang relevan
- Hindari kalimat yang terlalu panjang`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || "";

  // Bersihkan jika ada markdown code block
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  return JSON.parse(cleaned);
}

// ============================================================
// UNSPLASH — Fetch Thumbnail
// ============================================================

async function fetchThumbnail(query) {
  if (!UNSPLASH_KEY) return { url: null, alt: query };

  try {
    const res = await fetch(
      `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&orientation=landscape&content_filter=high`,
      {
        headers: { "Authorization": `Client-ID ${UNSPLASH_KEY}` },
      }
    );

    if (!res.ok) throw new Error(`Unsplash error: ${res.status}`);
    const data = await res.json();

    return {
      url: data.urls?.regular || null,
      alt: data.alt_description || data.description || query,
      credit: data.user?.name || "",
    };
  } catch (e) {
    log(`⚠️  Unsplash gagal: ${e.message}`);
    return { url: null, alt: query };
  }
}

// ============================================================
// MAIN — Jalankan Agen
// ============================================================

async function main() {
  log("🤖 Agen konten Revpeak mulai berjalan...");

  // Validasi env
  const missing = ["SUPABASE_URL","SUPABASE_SERVICE_KEY","ANTHROPIC_API_KEY"]
    .filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`❌ ENV tidak ditemukan: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Pilih topik acak
  const topikDipilih = pilihAcak(TOPIK);
  const subtopik     = pilihAcak(topikDipilih.subtopik);

  log(`📌 Topik: ${topikDipilih.kategori} — "${subtopik}"`);
  log(`📄 Tipe: ${topikDipilih.post_type}`);

  // Generate konten via Claude
  log("✍️  Mengenerate konten via Claude AI...");
  let konten;
  try {
    konten = await generateKonten(topikDipilih.kategori, subtopik, topikDipilih.post_type);
  } catch (e) {
    console.error(`❌ Gagal generate konten: ${e.message}`);
    process.exit(1);
  }

  log(`✅ Judul: ${konten.title}`);

  // Buat slug unik
  let slug = slugify(konten.title);
  let slugFinal = slug;
  let attempt = 0;

  while (await slugExists(slugFinal)) {
    attempt++;
    slugFinal = `${slug}-${attempt}`;
    log(`⚠️  Slug duplikat, coba: ${slugFinal}`);
  }

  // Fetch thumbnail dari Unsplash
  log(`🖼️  Mencari gambar: "${konten.image_query}"...`);
  const thumb = await fetchThumbnail(konten.image_query);
  if (thumb.url) log(`✅ Gambar ditemukan: ${thumb.url}`);
  else log("⚠️  Gambar tidak ditemukan, lanjut tanpa thumbnail.");

  // Ambil category_id dan author_id dari Supabase
  const [categoryId, authorId] = await Promise.all([
    getCategoryId(topikDipilih.slug_kategori),
    getAuthorId(),
  ]);

  log(`🗂️  Category ID: ${categoryId || "null (tidak ditemukan)"}`);
  log(`👤 Author ID: ${authorId || "null (tidak ditemukan)"}`);

  // Siapkan data artikel
  const artikelData = {
    title:         konten.title,
    slug:          slugFinal,
    excerpt:       konten.excerpt,
    content:       konten.content,
    post_type:     topikDipilih.post_type,
    status:        "published",
    category_id:   categoryId,
    author_id:     authorId,
    tags:          konten.tags || [],
    thumbnail_url: thumb.url,
    thumbnail_alt: thumb.alt,
    published_at:  new Date().toISOString(),
  };

  // Simpan ke Supabase
  log("💾 Menyimpan artikel ke Supabase...");
  try {
    const hasil = await simpanArtikel(artikelData);
    log(`✅ Artikel berhasil disimpan! ID: ${hasil?.[0]?.id || "?"}`);
    log(`🔗 URL: https://revpeak.web.id/${slugFinal}`);
  } catch (e) {
    console.error(`❌ Gagal menyimpan: ${e.message}`);
    process.exit(1);
  }

  log("🎉 Agen selesai berjalan.");
}

main().catch(e => {
  console.error("❌ Error tidak tertangani:", e);
  process.exit(1);
});
