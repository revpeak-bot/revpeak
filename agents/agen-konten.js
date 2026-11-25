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

import sharp from "sharp";

const SUPABASE_URL           = process.env.SUPABASE_URL;
const SUPABASE_KEY           = process.env.SUPABASE_KEY;
const CF_ACCOUNT_ID          = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN            = process.env.CF_AI_TOKEN;
const CF_R2_PUBLIC_URL       = process.env.CF_R2_PUBLIC_URL;
const CF_R2_ACCESS_KEY_ID    = process.env.CF_R2_ACCESS_KEY_ID;
const CF_R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY;

// Nama bucket R2 - wajib di set di GitHub Secrets
const CF_R2_BUCKET = process.env.CF_R2_BUCKET;
if (!CF_R2_BUCKET) {
  console.error("❌ CF_R2_BUCKET environment variable is required!");
  process.exit(1);
}

// Endpoint S3-compatible Cloudflare R2
const CF_R2_ENDPOINT = `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Endpoint Cloudflare Workers AI
const CF_AI_BASE    = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run`;
// Model teks: bisa diganti lewat env AI_TEXT_MODEL (tanpa mengubah kode).
// Default memakai model lebih besar; jika gagal otomatis turun ke model kecil.
const AI_TEXT_MODEL    = process.env.AI_TEXT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AI_FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const CF_AI_TEXT_PRIMARY  = `${CF_AI_BASE}/${AI_TEXT_MODEL}`;
const CF_AI_TEXT_FALLBACK = `${CF_AI_BASE}/${AI_FALLBACK_MODEL}`;
const CF_AI_IMAGE   = `${CF_AI_BASE}/@cf/stabilityai/stable-diffusion-xl-base-1.0`;

// Jumlah section per tipe konten
const SECTION_COUNT = { article: 7, news: 4 };

// ── Pengaturan kualitas & keamanan konten ───────────────────
// ARTICLE_STATUS: "draft" (default, ditinjau manual di admin) atau "published"
const ARTICLE_STATUS = (process.env.ARTICLE_STATUS || "draft") === "published" ? "published" : "draft";
const MIN_WORDS      = Number(process.env.MIN_WORDS || 1200);   // di bawah ini → tidak disimpan
const MAX_TOPIC_TRIES = 4;                                       // percobaan cari topik yang belum ada
const SIMILARITY_LIMIT = 0.6;                                    // kemiripan judul maksimum (0–1)
const AUTHOR_SLUG    = process.env.AUTHOR_SLUG || "redaksi-revpeak";

// ============================================================
// TOPIK
// ============================================================

// Topik EVERGREEN: panduan & penjelasan yang tahan lama.
// Sengaja tidak memuat: "terbaru/tahun ini", saran investasi, kesehatan/medis,
// karena model AI bisa keliru dan topik itu butuh tinjauan ahli.
// Anda bebas menambah/mengubah daftar ini.
const TOPIK = [
  {
    kategori: "Teknologi", slug_kategori: "teknologi", post_type: "article",
    subtopik: [
      "cara kerja kecerdasan buatan dijelaskan untuk orang awam",
      "cara melindungi akun online dengan kata sandi dan verifikasi dua langkah",
      "mengenali penipuan online dan phishing agar tidak jadi korban",
      "perbedaan cloud storage dan penyimpanan lokal serta cara memilihnya",
      "panduan memilih laptop sesuai kebutuhan kerja dan belajar",
      "cara kerja internet dan jaringan Wi-Fi di rumah",
      "dasar-dasar open source dan manfaatnya bagi pengguna biasa",
      "cara menghemat baterai dan memperpanjang umur smartphone",
    ],
  },
  {
    kategori: "Sains", slug_kategori: "sains", post_type: "article",
    subtopik: [
      "bagaimana tata surya terbentuk dan apa saja anggotanya",
      "mengapa terjadi perubahan musim dan fenomena gerhana",
      "dasar-dasar fisika kuantum dengan analogi sederhana",
      "cara kerja energi surya dan energi angin",
      "siklus air dan perannya bagi kehidupan di bumi",
      "bagaimana vaksin dan sistem kekebalan secara umum dipelajari sains",
      "proses fotosintesis dan peran tumbuhan bagi atmosfer",
      "bagaimana gempa bumi terjadi dan cara mitigasinya",
    ],
  },
  {
    kategori: "Bisnis", slug_kategori: "bisnis", post_type: "article",
    subtopik: [
      "langkah menyusun rencana bisnis sederhana untuk usaha kecil",
      "cara memulai usaha online dari nol dengan modal terbatas",
      "dasar-dasar pembukuan sederhana untuk UMKM",
      "strategi membangun merek usaha yang mudah diingat",
      "cara menulis deskripsi produk yang menarik pembeli",
      "dasar-dasar pemasaran digital untuk bisnis lokal",
      "cara melayani pelanggan dengan baik dan menangani keluhan",
      "memahami arus kas dan mengapa penting bagi usaha",
    ],
  },
  {
    kategori: "Gaya Hidup", slug_kategori: "gaya-hidup", post_type: "article",
    subtopik: [
      "tips mengatur waktu dan prioritas agar lebih produktif",
      "cara menyiapkan ruang kerja di rumah yang nyaman",
      "panduan merencanakan perjalanan hemat dengan anggaran jelas",
      "kebiasaan sederhana untuk menjaga fokus saat bekerja",
      "cara menyusun jadwal belajar mandiri yang konsisten",
      "tips merapikan rumah dengan prinsip minimalis",
      "panduan membaca buku lebih banyak dengan kebiasaan kecil",
      "cara menyiapkan perjalanan dan barang bawaan yang efisien",
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

function hitungReadingTime(html) {
  return Math.max(1, Math.round(hitungKata(html) / 200));
}

function generateFileName(slug) {
  const rand = Math.random().toString(36).substring(2, 8);
  const shortSlug = slug.substring(0, 40).replace(/-+$/, "");
  return `thumbnails/${shortSlug}-${rand}.webp`;
}

// ============================================================
// CLOUDFLARE WORKERS AI — panggil model teks
// ============================================================

async function callAI(prompt, maxTokens = 1200) {
  try {
    return await callAIModel(CF_AI_TEXT_PRIMARY, prompt, maxTokens);
  } catch (e) {
    if (CF_AI_TEXT_PRIMARY === CF_AI_TEXT_FALLBACK) throw e;
    log(`⚠️  Model utama gagal (${e.message.substring(0, 120)}), memakai model cadangan...`);
    return await callAIModel(CF_AI_TEXT_FALLBACK, prompt, maxTokens);
  }
}

async function callAIModel(endpoint, prompt, maxTokens) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_AI_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: `Anda adalah penulis dan editor senior Revpeak, media digital Indonesia. Gaya penulisan: lugas, informatif, hangat, tidak terasa ditulis mesin, SEO-friendly. ATURAN KEJUJURAN (paling penting): (1) JANGAN mengarang statistik, persentase, angka survei, tanggal, nama orang, nama lembaga, kutipan, hasil penelitian, atau tautan. Jika tidak yakin 100%, gunakan bahasa umum ("banyak orang", "biasanya", "umumnya") tanpa angka. (2) JANGAN menulis seolah Anda pernah mencoba, mengunjungi, atau mewawancarai sesuatu. (3) JANGAN menyebut "terbaru", "tahun ini", "saat ini", atau harga/spesifikasi produk tertentu karena bisa sudah berubah. (4) Jika memberi contoh, tandai sebagai contoh/ilustrasi ("misalnya", "sebagai gambaran"). (5) Jangan memberi nasihat medis, hukum, atau investasi yang spesifik. Aturan gaya: paragraf pendek maksimal 3-4 kalimat; kata kunci utama muncul natural di paragraf pertama tiap sub-bagian; gunakan <strong> hanya untuk istilah atau poin kunci; hindari pembuka klise ("Dalam era modern ini...", "Tidak dapat dipungkiri..."); ikuti format HTML yang diperintahkan dengan tepat, jangan Markdown.`,
        },
        { role: "user", content: prompt },
      ],
      max_tokens:  maxTokens,
      temperature: 0.72,
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
// CLOUDFLARE WORKERS AI — generate gambar
// ============================================================

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
      num_steps: 20,
      guidance:  7.5,
      width:     1024,
      height:    576,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI Image ${res.status}: ${err.substring(0, 200)}`);
  }

  const buffer = await res.arrayBuffer();
  if (!buffer || buffer.byteLength < 1000) {
    throw new Error("Gambar yang dihasilkan terlalu kecil atau kosong");
  }

  log(`✅ Gambar berhasil dibuat: ${(buffer.byteLength / 1024).toFixed(1)} KB`);
  return buffer;
}

// ============================================================
// CLOUDFLARE R2 — upload gambar (AWS Signature v4)
// ============================================================

const toHex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(data) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}

async function hmacSha256(key, data) {
  const keyBuf  = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const dataBuf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBuf, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, dataBuf);
}

async function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = await hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion  = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, "aws4_request");
}

async function uploadToR2(imageBuffer, fileName) {
  const bucket = CF_R2_BUCKET;
  const objectKey = fileName;
  const host = `${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const uploadUrl = `https://${host}/${bucket}/${objectKey}`;
  
  log(`☁️  Upload ke R2: ${fileName} (${imageBuffer.byteLength} bytes)...`);
  log(`🔗 Upload URL: ${uploadUrl}`);

  const region = "auto";
  const service = "s3";
  const now = new Date();

  const dateStamp = now.toISOString().replace(/[-:]/g, "").split("T")[0];
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

  const contentType = "image/webp";
  const payloadHash = await sha256Hex(imageBuffer);

  const canonicalHeaders =
    `content-length:${imageBuffer.byteLength}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    `/${bucket}/${objectKey}`,
    "",
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
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const authorizationHeader =
    `AWS4-HMAC-SHA256 Credential=${CF_R2_ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Authorization": authorizationHeader,
      "Content-Length": imageBuffer.byteLength.toString(),
      "Content-Type": contentType,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
    },
    body: imageBuffer,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`R2 Upload ${res.status}: ${err.substring(0, 300)}`);
  }

  const publicUrl = `${CF_R2_PUBLIC_URL.replace(/\/$/, "")}/${fileName}`;
  log(`✅ Upload R2 berhasil: ${publicUrl}`);
  
  return publicUrl;
}

async function generateAndUploadImage(imagePrompt, slug) {
  try {
    const imageBuffer = await generateImage(imagePrompt);

    log("🔄 Mengkonversi gambar ke WebP...");
    const webpBuffer = await sharp(Buffer.from(imageBuffer))
      .webp({ quality: 85 })
      .toBuffer();
    log(`✅ Konversi WebP selesai: ${(webpBuffer.byteLength / 1024).toFixed(1)} KB`);

    const fileName  = generateFileName(slug);
    const publicUrl = await uploadToR2(webpBuffer, fileName);
    return { url: publicUrl, alt: imagePrompt, fileName };
  } catch (e) {
    log(`⚠️  Gagal generate/upload gambar: ${e.message}`);
    return { url: null, alt: imagePrompt, fileName: null };
  }
}

// ============================================================
// METADATA, OUTLINE, SECTION, SUPABASE (sama seperti sebelumnya)
// ============================================================

async function generateMetadata(topik, subtopik, postType) {
  const isBerita = postType === "news";

  const prompt = `Buat metadata SEO untuk ${isBerita ? "berita" : "artikel"} tentang "${subtopik}" kategori ${topik}.

Balas PERSIS dengan format ini (satu nilai per baris, tanpa penjelasan lain):
FOCUS_KW: [kata kunci utama 2-4 kata yang paling sering dicari di Google Indonesia]
TITLE: [judul 50-60 karakter: letakkan kata kunci di AWAL, gunakan angka atau kata tanya jika relevan, harus menarik untuk diklik]
EXCERPT: [140-155 karakter: sebut kata kunci di kalimat pertama, padat dan bernilai, hindari frasa "artikel ini membahas"]
TAGS: [6-8 tag relevan dari umum ke spesifik, pisahkan koma]
META_DESC: [130-155 karakter: buka dengan kata kunci, sebutkan manfaat utama pembaca, akhiri dengan CTA seperti "Simak panduan lengkapnya." atau "Pelajari lebih lanjut di sini."]
IMAGE_PROMPT: [10-20 kata bahasa Inggris: clean modern editorial illustration, flat vector style, soft colors, relevan dengan topik, no text, no letters, no logos, no real people faces]`;

  const raw = await callAI(prompt, 600);

  const get = (key) => {
    const m = raw.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return m ? m[1].trim() : "";
  };

  const focusKw     = get("FOCUS_KW")     || subtopik.split(" ").slice(0, 3).join(" ");
  const title        = get("TITLE")        || subtopik.substring(0, 60);
  const excerpt      = get("EXCERPT")      || "";
  const metaDesc     = get("META_DESC")    || excerpt;
  const tagsRaw      = get("TAGS")         || "";
  const imagePrompt  = get("IMAGE_PROMPT") || `${topik.toLowerCase()} clean modern editorial illustration, flat vector style, no text, no logos`;

  const tags = tagsRaw
    .replace(/[\[\]]/g, "")
    .split(",")
    .map(t => t.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return { title, excerpt, metaDesc, tags, imagePrompt, focusKw };
}

async function generateOutline(topik, subtopik, postType, title) {
  const isBerita   = postType === "news";
  const jumlah     = SECTION_COUNT[postType] ?? 6;

  const tipeKonten = isBerita
    ? "artikel berita dengan struktur: latar belakang, detail peristiwa, dampak, analisis, penutup"
    : "artikel informatif mendalam dengan pendahuluan, beberapa sub-topik utama, dan kesimpulan";

  const prompt = `Buat outline SEO-friendly untuk ${isBerita ? "berita" : "artikel"} panjang tentang "${subtopik}" kategori ${topik}.
Judul artikel: ${title}
Struktur: ${tipeKonten}

Aturan wajib untuk setiap judul sub-bagian:
- Mengandung kata kunci atau variasi sinonimnya secara natural
- Gunakan format pertanyaan ("Bagaimana...", "Apa...", "Mengapa...", "Berapa...") untuk 1-2 sub-bagian di tengah
- Sub-bagian TERAKHIR wajib berisi kata "Pertanyaan Umum" diikuti kata kunci singkat (untuk FAQ schema Google)
- JANGAN gunakan nomor urut, tanda bintang, tanda strip, atau tanda petik di depan judul

Balas HANYA dengan daftar tepat ${jumlah} judul sub-bagian, satu per baris:`;

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

function sanitizeHTML(html) {
  return html
    // Markdown heading → HTML heading (h2–h4 saja, h1 tidak dipakai dalam konten)
    .replace(/^#{1}\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#{2}\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#{3}\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^#{4,6}\s+(.+)$/gm, "<h4>$1</h4>")
    // Pastikan tidak ada h1 di dalam konten
    .replace(/<h1(\s[^>]*)?>/gi, "<h2>")
    .replace(/<\/h1>/gi, "</h2>")
    // Bold dan italic dari markdown
    .replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
    // Baris teks biasa yang belum dibungkus tag → jadikan <p>
    .replace(/^(?!<[a-z/])(.{20,})$/gm, "<p>$1</p>");
}

async function generateSection(subtopik, title, sectionTitle, index, total) {
  const isFirst = index === 0;
  const isLast  = index === total - 1;

  let instruksiPosisi;
  if (isFirst) {
    instruksiPosisi = `Ini adalah bagian PEMBUKA artikel. Mulai dengan kalimat pertama yang langsung menarik—bisa berupa pertanyaan yang relevan, situasi yang dekat dengan pembaca, atau pernyataan kuat (tanpa angka atau kutipan karangan). Jangan mulai dengan "Dalam era modern ini" atau sejenisnya. Perkenalkan topik secara konkret dan beri pembaca alasan kuat untuk terus membaca.`;
  } else if (isLast) {
    instruksiPosisi = `Ini adalah bagian PENUTUP artikel. Tulis kesimpulan yang tegas dan berkesan—rangkum poin utama secara padat, lalu tutup dengan kalimat yang memberi perspektif atau ajakan berpikir bagi pembaca. Hindari penutup klise seperti "Demikianlah artikel ini...".`;
  } else {
    instruksiPosisi = `Ini adalah bagian ISI artikel. Bahas sub-topik ini secara mendalam dengan penjelasan, contoh ilustrasi, atau analisis yang tajam. Jadikan setiap paragraf bernilai—tidak ada kalimat pengisi.`;
  }

  const instruksiFAQ = isLast
    ? `\n\n   CATATAN: Jika judul sub-bagian ini mengandung kata "Pertanyaan" atau "FAQ", gunakan format berikut:\n   <h3>Pertanyaan yang sering ditanyakan 1?</h3>\n   <p>Jawaban ringkas 2-3 kalimat yang informatif.</p>\n   (ulangi untuk 3-4 pertanyaan umum tentang topik ini)`
    : "";

  const prompt = `Tulis satu bagian artikel jurnalistik SEO-friendly tentang "${subtopik}" untuk Revpeak.

Judul artikel: ${title}
Judul sub-bagian ini: ${sectionTitle}
Posisi: ${instruksiPosisi}

═══ FORMAT HTML — WAJIB DIIKUTI ═══

1. JUDUL SUB-BAGIAN
   Buka tepat dengan satu: <h2>${sectionTitle}</h2>

2. PARAGRAF
   - Bungkus setiap paragraf dengan <p>...</p>
   - Satu paragraf = 2-4 kalimat (jangan lebih panjang)
   - Paragraf pertama: masukkan kata kunci topik secara natural di kalimat pertama atau kedua

3. SUB-POIN (gunakan jika ada 2+ aspek berbeda)
   <h3>Judul Sub-Poin yang Deskriptif</h3>
   <p>Penjelasan paragraf di bawahnya...</p>

4. PENEKANAN
   - <strong> untuk: istilah kunci dan poin terpenting saja (JANGAN menaruh angka atau statistik karangan)
   - <em> hanya untuk penekanan makna yang benar-benar perlu
   - Tempatkan 2-4 tag <strong> per bagian secara natural, bukan dipaksakan

5. DAFTAR — wajib jika ada 3+ item/langkah/manfaat yang setara:
   <ul><li>Item dengan minimal 1 kalimat penjelasan</li></ul>
   atau <ol> untuk urutan langkah yang harus berurutan${instruksiFAQ}

═══ LARANGAN ═══
- JANGAN gunakan <h1> sama sekali
- JANGAN gunakan Markdown (**, ##, *, __, dsb.)
- JANGAN tulis kalimat pengisi seperti "Dalam sub-bagian ini..." atau "Seperti yang telah dibahas..."
- JANGAN tambahkan komentar, catatan, atau teks apa pun di luar konten artikel

═══ GAYA PENULISAN ═══
- Bahasa Indonesia baku, kalimat aktif, langsung ke inti
- Sertakan minimal satu contoh ilustrasi yang mudah dibayangkan per bagian (tandai sebagai "misalnya"). JANGAN mengarang statistik, tanggal, nama, atau kutipan
- Hindari kalimat pasif berlebihan dan kata sifat yang tidak terukur ("sangat", "banyak", "berbagai")
- Target: 280-380 kata untuk bagian ini

Langsung tulis konten HTML mulai dari <h2>:`;

  const raw = await callAI(prompt, 1400);
  return sanitizeHTML(raw);
}

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
// SUPABASE FUNCTIONS
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

// Penulis tetap: akun "Redaksi Revpeak" (slug dari AUTHOR_SLUG). Jika belum dibuat di admin,
// null → website menampilkan "Revpeak". Tidak lagi memilih penulis acak.
async function getAuthorId() {
  try {
    const r = await sbFetch(`/authors?slug=eq.${encodeURIComponent(AUTHOR_SLUG)}&select=id&limit=1`);
    return r?.[0]?.id || null;
  } catch { return null; }
}

// ── Cek kemiripan judul agar topik tidak kembar ─────────────
const STOPWORDS = new Set(["yang","dan","di","ke","dari","untuk","dengan","pada","cara","tips","panduan","apa","bagaimana","dalam","atau","ini","itu","agar","serta","lebih"]);
function kataPenting(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w)));
}
function kemiripan(a, b) {
  const A = kataPenting(a), B = kataPenting(b);
  if (!A.size || !B.size) return 0;
  let irisan = 0;
  for (const w of A) if (B.has(w)) irisan++;
  return irisan / (A.size + B.size - irisan);
}
async function getJudulTerbaru() {
  try {
    const r = await sbFetch("/articles?select=title&order=created_at.desc&limit=500");
    return (r || []).map(x => x.title).filter(Boolean);
  } catch { return []; }
}
function judulMirip(judulBaru, daftar) {
  return daftar.some(j => kemiripan(judulBaru, j) >= SIMILARITY_LIMIT);
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

  const required = [
    ["SUPABASE_URL", SUPABASE_URL],
    ["SUPABASE_KEY", SUPABASE_KEY],
    ["CF_ACCOUNT_ID", CF_ACCOUNT_ID],
    ["CF_AI_TOKEN", CF_AI_TOKEN],
    ["CF_R2_PUBLIC_URL", CF_R2_PUBLIC_URL],
    ["CF_R2_BUCKET", CF_R2_BUCKET],
    ["CF_R2_ACCESS_KEY_ID", CF_R2_ACCESS_KEY_ID],
    ["CF_R2_SECRET_ACCESS_KEY", CF_R2_SECRET_ACCESS_KEY],
  ];

  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`❌ ENV tidak ditemukan: ${missing.join(", ")}`);
    process.exit(1);
  }

  log(`🛡️  Mode status artikel: ${ARTICLE_STATUS} | Model: ${AI_TEXT_MODEL} | Min kata: ${MIN_WORDS}`);
  log(`📦 Menggunakan bucket: ${CF_R2_BUCKET}`);

  // Pilih topik yang belum pernah dibahas (cek kemiripan judul)
  const judulLama = await getJudulTerbaru();
  log(`📚 Judul yang sudah ada: ${judulLama.length}`);

  let topikDipilih, subtopik, meta = null;
  for (let percobaan = 1; percobaan <= MAX_TOPIC_TRIES; percobaan++) {
    topikDipilih = pilihAcak(TOPIK);
    subtopik     = pilihAcak(topikDipilih.subtopik);
    log(`📌 Topik (percobaan ${percobaan}): [${topikDipilih.kategori}] ${subtopik}`);
    log(`📄 Tipe  : ${topikDipilih.post_type}`);

    log("📋 Membuat metadata...");
    try {
      meta = await generateMetadata(topikDipilih.kategori, subtopik, topikDipilih.post_type);
      log(`✅ Judul        : "${meta.title}"`);
      log(`🔑 Focus KW     : "${meta.focusKw}"`);
      log(`📎 Tags         : ${meta.tags.join(", ")}`);
      log(`🎨 Image prompt : "${meta.imagePrompt}"`);
    } catch (e) {
      console.error(`❌ Gagal buat metadata: ${e.message}`);
      process.exit(1);
    }

    if (!judulMirip(meta.title, judulLama)) break;
    log(`⚠️  Judul mirip artikel yang sudah ada, cari topik lain...`);
    meta = null;
  }
  if (!meta) {
    log("⏭️  Semua percobaan menghasilkan topik yang mirip artikel lama. Run ini dilewati (bukan error).");
    process.exit(0);
  }

  let slug      = slugify(meta.title);
  let slugFinal = slug;
  for (let i = 1; (await slugExists(slugFinal)) && i <= 5; i++) {
    slugFinal = `${slug}-${i}`;
    log(`⚠️  Slug duplikat, coba: ${slugFinal}`);
  }

  log("🚀 Memulai generate gambar & konten secara paralel...");

  const [imageResult, content] = await Promise.allSettled([
    generateAndUploadImage(meta.imagePrompt, slugFinal),
    generateArticleByParts(topikDipilih.kategori, subtopik, topikDipilih.post_type, meta.title),
  ]);

  const thumb = imageResult.status === "fulfilled"
    ? imageResult.value
    : { url: null, alt: meta.imagePrompt, fileName: null };

  if (imageResult.status === "rejected") {
    log(`⚠️  Generate gambar gagal total: ${imageResult.reason}`);
  }
  log(thumb.url ? `✅ Thumbnail URL : ${thumb.url}` : "⚠️  Artikel disimpan tanpa gambar.");

  if (content.status === "rejected") {
    console.error(`❌ Gagal buat konten: ${content.reason}`);
    process.exit(1);
  }
  let articleContent = content.value;

  if (!articleContent || articleContent.trim().length < 100) {
    console.error("❌ Konten terlalu pendek atau kosong.");
    process.exit(1);
  }

  // Tolak artikel yang terlalu pendek (bukan error sistem, tidak disimpan)
  const jumlahKata = hitungKata(articleContent);
  if (jumlahKata < MIN_WORDS) {
    console.error(`❌ Artikel hanya ${jumlahKata} kata (minimum ${MIN_WORDS}). Tidak disimpan.`);
    process.exit(1);
  }

  // Keterangan transparansi (jujur sesuai mode: ditinjau hanya jika masuk draft)
  articleContent += ARTICLE_STATUS === "draft"
    ? '\n\n<p class="ai-disclosure"><em>Artikel ini disusun dengan bantuan AI dan ditinjau oleh tim redaksi Revpeak sebelum dipublikasikan.</em></p>'
    : '\n\n<p class="ai-disclosure"><em>Artikel ini disusun dengan bantuan AI.</em></p>';

  const [categoryId, authorId] = await Promise.all([
    getCategoryId(topikDipilih.slug_kategori),
    getAuthorId(),
  ]);
  log(`🗂️  Category: ${categoryId ?? "null"} | Author: ${authorId ?? "null"}`);

  const readingTime = hitungReadingTime(articleContent);
  const wordCount   = hitungKata(articleContent);
  log(`📊 Word count: ${wordCount} | Reading time: ${readingTime} menit`);

  log("💾 Menyimpan ke Supabase...");
  try {
    const publishedAt = new Date().toISOString();

    const payloadCore = {
      title:         meta.title,
      slug:          slugFinal,
      excerpt:       meta.excerpt,
      content:       articleContent,
      status:        ARTICLE_STATUS,
      category_id:   categoryId,
      author_id:     authorId,
      published_at:  publishedAt,
      created_at:    publishedAt,
      updated_at:    publishedAt,
      thumbnail_url: thumb.url,   // selalu disertakan agar tidak hilang saat fallback
      thumbnail_alt: `Ilustrasi: ${meta.title}`,
    };

    const payloadOptional = {
      post_type:    topikDipilih.post_type,
      tags:         meta.tags,
      reading_time: readingTime,
      view_count:   0,
    };

    const payload = { ...payloadCore, ...payloadOptional };

    let hasil;
    try {
      hasil = await sbFetch("/articles", {
        method: "POST",
        body:   JSON.stringify(payload),
      });
    } catch (eFull) {
      log(`⚠️  Payload lengkap gagal (${eFull.message}), coba kolom inti...`);
      hasil = await sbFetch("/articles", {
        method: "POST",
        body:   JSON.stringify(payloadCore),
      });
    }

    log(`✅ Artikel tersimpan — ID: ${hasil?.[0]?.id ?? "?"}`);
    log(ARTICLE_STATUS === "draft"
      ? `📝 Tersimpan sebagai DRAFT. Tinjau di admin, lalu ubah status ke published. Slug: ${slugFinal}`
      : `🔗 URL: https://revpeak.web.id/${slugFinal}`);
  } catch (e) {
    console.error(`❌ Gagal simpan ke Supabase: ${e.message}`);
    process.exit(1);
  }

  log("🎉 Selesai.");
}

main().catch(e => { console.error("❌", e); process.exit(1); });