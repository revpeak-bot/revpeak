/**
 * agen-berita.js — Revpeak AI News Agent
 * Sumber topik : RSS feed media Indonesia (fallback: Llama generate sendiri)
 * AI penulis   : Cloudflare Workers AI (Llama 3.1)
 * AI gambar    : Cloudflare Workers AI (Stable Diffusion XL)
 * Penyimpanan  : Cloudflare R2 (sama seperti agen-konten.js)
 * Dijalankan   : GitHub Actions setiap 4 jam
 */

import sharp from "sharp";

// ─── Environment Variables ─────────────────────────────────────────────────────
const CF_ACCOUNT_ID           = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN             = process.env.CF_AI_TOKEN;
const CF_R2_PUBLIC_URL        = process.env.CF_R2_PUBLIC_URL;
const CF_R2_BUCKET            = process.env.CF_R2_BUCKET;
const CF_R2_ACCESS_KEY_ID     = process.env.CF_R2_ACCESS_KEY_ID;
const CF_R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY;
const WORKER_URL              = process.env.WORKER_URL;
const WORKER_SECRET           = process.env.WORKER_SECRET;
const SUPABASE_URL            = process.env.SUPABASE_URL;
const SUPABASE_KEY            = process.env.SUPABASE_SERVICE_KEY;

// ─── Konstanta ─────────────────────────────────────────────────────────────────
const CF_AI_BASE     = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run`;
const TEXT_MODEL     = "@cf/meta/llama-3.1-8b-instruct";
const IMAGE_MODEL    = "@cf/stabilityai/stable-diffusion-xl-base-1.0";
const JUMLAH_ARTIKEL = 3;
const DELAY_MS       = 5000;

// RSS feed media Indonesia
const RSS_FEEDS = [
  { url: "https://www.antaranews.com/rss/terkini.xml",  nama: "Antara News"    },
  { url: "https://www.cnnindonesia.com/nasional/rss",   nama: "CNN Nasional"   },
  { url: "https://www.cnnindonesia.com/teknologi/rss",  nama: "CNN Teknologi"  },
  { url: "https://rss.detik.com/index.php/detikcom",    nama: "Detik.com"      },
  { url: "https://tekno.kompas.com/rss/index.xml",      nama: "Kompas Tekno"   },
  { url: "https://health.kompas.com/rss/index.xml",     nama: "Kompas Health"  },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log   = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

function generateFileName(slug) {
  const rand      = Math.random().toString(36).substring(2, 8);
  const shortSlug = slug.substring(0, 40).replace(/-+$/, "");
  return `news/${shortSlug}-${rand}.webp`;
}

function parseJSON(text) {
  if (!text) throw new Error("Respons AI kosong");

  // Hapus markdown fence
  let clean = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();

  // Hapus control character tidak valid (kecuali \n \r \t yang valid di luar string)
  clean = clean.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

  // Jika Llama output multiple array terpisah newline → gabungkan jadi satu array
  // Contoh: [{...}]\n[{...}] → [{...},{...}]
  const arrays = [];
  const arrayRegex = /\[[\s\S]*?\]/g;
  let m;
  while ((m = arrayRegex.exec(clean)) !== null) {
    try {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed)) arrays.push(...parsed);
    } catch { /* skip invalid */ }
  }
  if (arrays.length > 0) return arrays;

  // Fallback: coba ambil satu blok JSON (object atau array) dan parse langsung
  const match = clean.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) throw new Error(`Tidak ada JSON valid:\n${clean.slice(0, 300)}`);

  // Escape newline literal di dalam string values saja
  const escaped = match[1].replace(/"((?:[^"\\]|\\.)*)"/gs, (_, inner) => {
    return `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "").replace(/\t/g, " ")}"`;
  });

  try {
    return JSON.parse(escaped);
  } catch (e) {
    throw new Error(`Tidak ada JSON valid:\n${clean.slice(0, 300)}`);
  }
}

// ─── Cloudflare Workers AI — teks ─────────────────────────────────────────────
async function callAI(messages, maxTokens = 2000) {
  const res = await fetch(`${CF_AI_BASE}/${TEXT_MODEL}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_AI_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature: 0.72 }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI teks gagal (${res.status}): ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.result?.response ?? "";
  if (!text) throw new Error("CF AI tidak mengembalikan respons");
  return text.trim();
}

// ─── Cloudflare Workers AI — gambar ───────────────────────────────────────────
async function generateImage(prompt) {
  log(`🎨 Generate gambar: "${prompt}"`);

  const res = await fetch(`${CF_AI_BASE}/${IMAGE_MODEL}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${CF_AI_TOKEN}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({ prompt, num_steps: 20, guidance: 7.5, width: 1024, height: 576 }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI gambar gagal (${res.status}): ${err.substring(0, 200)}`);
  }

  const buffer = await res.arrayBuffer();
  if (!buffer || buffer.byteLength < 1000) throw new Error("Gambar terlalu kecil atau kosong");

  log(`✅ Gambar di-generate: ${(buffer.byteLength / 1024).toFixed(1)} KB`);
  return buffer;
}

// ─── Cloudflare R2 Upload (AWS Signature v4) ──────────────────────────────────
const toHex = (buf) =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(data) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", buf));
}

async function hmacSha256(key, data) {
  const keyBuf    = typeof key === "string"  ? new TextEncoder().encode(key)  : key;
  const dataBuf   = typeof data === "string" ? new TextEncoder().encode(data) : data;
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
  const host      = `${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const uploadUrl = `https://${host}/${CF_R2_BUCKET}/${fileName}`;

  log(`☁️  Upload ke R2: ${fileName} (${imageBuffer.byteLength} bytes)`);

  const region  = "auto";
  const service = "s3";
  const now     = new Date();

  const dateStamp = now.toISOString().replace(/[-:]/g, "").split("T")[0];
  const amzDate   = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

  const contentType = "image/webp";
  const payloadHash = await sha256Hex(imageBuffer);

  const canonicalHeaders =
    `content-length:${imageBuffer.byteLength}\n` +
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders    = "content-length;content-type;host;x-amz-content-sha256;x-amz-date";
  const credentialScope  = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalRequest = [
    "PUT",
    `/${CF_R2_BUCKET}/${fileName}`,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey  = await getSigningKey(CF_R2_SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature   = toHex(await hmacSha256(signingKey, stringToSign));

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${CF_R2_ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Authorization":        authHeader,
      "Content-Length":       imageBuffer.byteLength.toString(),
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

  const publicUrl = `${CF_R2_PUBLIC_URL.replace(/\/$/, "")}/${fileName}`;
  log(`✅ Upload R2 berhasil: ${publicUrl}`);
  return publicUrl;
}

async function generateAndUploadImage(imagePrompt, slug) {
  try {
    const imageBuffer = await generateImage(imagePrompt);

    log("🔄 Konversi ke WebP...");
    const webpBuffer = await sharp(Buffer.from(imageBuffer))
      .webp({ quality: 85 })
      .toBuffer();
    log(`✅ WebP: ${(webpBuffer.byteLength / 1024).toFixed(1)} KB`);

    const fileName  = generateFileName(slug);
    const publicUrl = await uploadToR2(webpBuffer, fileName);
    return { url: publicUrl, fileName };
  } catch (e) {
    log(`⚠️  Gagal generate/upload gambar: ${e.message}`);
    return { url: null, fileName: null };
  }
}

// ─── Step 1: Fetch RSS ─────────────────────────────────────────────────────────
async function fetchRSSItems(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Revpeak-Bot/1.0" },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];

    const xml   = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const block = match[1];
      const title = (
        block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
        block.match(/<title>(.*?)<\/title>/)
      )?.[1]?.trim();
      const desc = (
        block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
        block.match(/<description>(.*?)<\/description>/)
      )?.[1]?.replace(/<[^>]+>/g, "")?.trim()?.slice(0, 200);

      if (title && title.length > 10) {
        items.push({ judul: title, ringkasan: desc || "", sumber: feed.nama });
      }
    }
    return items;
  } catch {
    log(`⚠️  RSS ${feed.nama} gagal diakses, dilewati.`);
    return [];
  }
}

async function getAllRSSItems() {
  log("📡 Mengambil berita dari RSS feed...");
  const results = await Promise.all(RSS_FEEDS.map(fetchRSSItems));
  const all     = results.flat();
  log(`✅ ${all.length} berita terkumpul dari ${RSS_FEEDS.length} sumber`);
  return all;
}

// ─── Step 2a: Pilih topik dari RSS ────────────────────────────────────────────
async function selectTopicsFromRSS(rssItems) {
  log("🤖 Llama memilih topik dari RSS...");

  const daftarBerita = rssItems.slice(0, 40)
    .map((item, i) => `${i + 1}. [${item.sumber}] ${item.judul}`)
    .join("\n");

  const text = await callAI([
    { role: "system", content: "Kamu adalah editor berita Indonesia. Selalu balas dalam format JSON yang diminta." },
    { role: "user", content:
      `Dari daftar berita berikut, pilih ${JUMLAH_ARTIKEL} yang paling menarik dan beragam topiknya.\n\n` +
      `DAFTAR:\n${daftarBerita}\n\n` +
      `Kembalikan HANYA JSON array berikut tanpa penjelasan:\n` +
      `[{"topik":"...","ringkasan":"...","gambar":"2-5 kata Inggris untuk gambar","kategori":"teknologi|hiburan|olahraga|nasional|bisnis|gaya-hidup|kesehatan|sains"}]`
    },
  ], 800);

  const topics = parseJSON(text);
  if (!Array.isArray(topics) || topics.length === 0) throw new Error("Tidak ada topik dari RSS");
  return topics;
}

// ─── Step 2b: Fallback — Llama generate topik sendiri ─────────────────────────
async function selectTopicsFallback() {
  log("🤖 RSS tidak tersedia, Llama generate topik sendiri...");

  const hari = new Date().toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const text = await callAI([
    { role: "system", content: "Kamu adalah editor berita Indonesia. Selalu balas dalam format JSON yang diminta." },
    { role: "user", content:
      `Hari ini ${hari}. Buat ${JUMLAH_ARTIKEL} topik berita yang kemungkinan sedang ` +
      `ramai diperbincangkan di Indonesia. Pilih topik yang beragam.\n\n` +
      `Kembalikan HANYA JSON array berikut tanpa penjelasan:\n` +
      `[{"topik":"...","ringkasan":"konteks singkat topik ini","gambar":"2-5 kata Inggris untuk gambar","kategori":"teknologi|hiburan|olahraga|nasional|bisnis|gaya-hidup|kesehatan|sains"}]`
    },
  ], 800);

  const topics = parseJSON(text);
  if (!Array.isArray(topics) || topics.length === 0) throw new Error("Llama tidak mengembalikan topik");
  return topics;
}

// ─── Step 2: Pilih topik (RSS → fallback Llama) ───────────────────────────────
async function selectTopics(rssItems) {
  if (rssItems.length >= 3) {
    try {
      const topics = await selectTopicsFromRSS(rssItems);
      log(`✅ ${topics.length} topik dipilih dari RSS:`);
      topics.forEach((t, i) => log(`   ${i + 1}. [${t.kategori}] ${t.topik}`));
      return topics;
    } catch (err) {
      log(`⚠️  Seleksi RSS gagal: ${err.message}, beralih ke fallback...`);
    }
  }

  // Fallback: Llama generate topik sendiri
  const topics = await selectTopicsFallback();
  log(`✅ ${topics.length} topik di-generate Llama (fallback):`);
  topics.forEach((t, i) => log(`   ${i + 1}. [${t.kategori}] ${t.topik}`));
  return topics;
}

// ─── Step 3: Generate artikel via Llama ───────────────────────────────────────
async function generateArticle(topic, attempt = 1) {
  log(`📝 Menulis artikel (percobaan ${attempt}): "${topic.topik}"`);

  const text = await callAI([
    { role: "system", content: "Kamu adalah jurnalis profesional Indonesia. Balas HANYA dengan JSON, tanpa teks lain, tanpa markdown." },
    { role: "user", content:
      `Tulis artikel berita Bahasa Indonesia tentang:\n"${topic.topik}"\nKonteks: ${topic.ringkasan}\n\n` +
      `Ketentuan: gaya jurnalistik, minimal 400 kata, konten HTML sederhana (hanya tag p, h2, ul, li, strong).\n\n` +
      `Balas HANYA dengan JSON ini, tidak ada teks lain:\n` +
      `{"judul":"judul artikel","slug":"judul-slug","excerpt":"ringkasan 1 kalimat","konten":"<p>isi artikel</p>","tags":["tag1","tag2"],"meta_description":"deskripsi seo"}`
    },
  ], 3000);

  let article = parseJSON(text);

  // Normalisasi field — Llama kadang pakai nama field berbeda
  if (!article.judul && article.title)   article.judul   = article.title;
  if (!article.konten && article.content) article.konten = article.content;
  if (!article.excerpt && article.summary) article.excerpt = article.summary;
  if (!article.slug && article.judul) {
    article.slug = article.judul.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  }

  // Validasi — jika field wajib masih kosong, coba sekali lagi
  const missing = ["judul", "slug", "excerpt", "konten"].filter(f => !article[f]);
  if (missing.length > 0) {
    if (attempt < 2) {
      log(`⚠️  Field kosong (${missing.join(", ")}), mencoba ulang...`);
      await sleep(3000);
      return generateArticle(topic, attempt + 1);
    }
    throw new Error(`Field "${missing[0]}" kosong setelah 2 percobaan`);
  }

  // Sanitasi slug
  article.slug = article.slug
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/^\d+/, "");

  log(`✅ Judul : ${article.judul}`);
  log(`✅ Slug  : ${article.slug}`);
  return article;
}

// ─── Step 4: Cek duplikat slug ────────────────────────────────────────────────
async function slugExists(slug) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

// ─── Step 5: Simpan ke Supabase via Worker ────────────────────────────────────
async function saveArticle(payload) {
  log("💾 Menyimpan artikel via Worker...");

  const res = await fetch(`${WORKER_URL}/api/save-news`, {
    method: "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-Worker-Secret": WORKER_SECRET,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Worker /api/save-news gagal (${res.status}): ${err}`);
  }

  const result = await res.json();
  log(`✅ Tersimpan! ID: ${result.id ?? "N/A"}`);
  return result;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const waktu = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  log("═══════════════════════════════════════════════════");
  log("  REVPEAK AI NEWS AGENT");
  log(`  ${waktu} WIB`);
  log("═══════════════════════════════════════════════════");

  // Validasi env
  const required = [
    ["CF_ACCOUNT_ID",           CF_ACCOUNT_ID],
    ["CF_AI_TOKEN",             CF_AI_TOKEN],
    ["CF_R2_PUBLIC_URL",        CF_R2_PUBLIC_URL],
    ["CF_R2_BUCKET",            CF_R2_BUCKET],
    ["CF_R2_ACCESS_KEY_ID",     CF_R2_ACCESS_KEY_ID],
    ["CF_R2_SECRET_ACCESS_KEY", CF_R2_SECRET_ACCESS_KEY],
    ["WORKER_URL",              WORKER_URL],
    ["WORKER_SECRET",           WORKER_SECRET],
    ["SUPABASE_URL",            SUPABASE_URL],
    ["SUPABASE_SERVICE_KEY",    SUPABASE_KEY],
  ];
  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`❌ ENV belum diset: ${missing.join(", ")}`);
    process.exit(1);
  }

  // Step 1: Ambil RSS (tidak wajib berhasil)
  const rssItems = await getAllRSSItems();

  // Step 2: Pilih topik (RSS → fallback Llama)
  let topics = [];
  try {
    topics = await selectTopics(rssItems);
  } catch (err) {
    console.error(`❌ Gagal pilih topik: ${err.message}`);
    process.exit(1);
  }

  let successCount = 0;

  // Step 3–5: Proses tiap topik
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    log(`\n${"─".repeat(55)}`);
    log(`📌 Artikel ${i + 1}/${topics.length}: ${topic.topik}`);
    log("─".repeat(55));

    try {
      // Generate artikel
      const article = await generateArticle(topic);
      await sleep(2000);

      // Cek duplikat slug
      if (await slugExists(article.slug)) {
        log(`⚠️  Slug "${article.slug}" sudah ada, dilewati.`);
        continue;
      }

      // Generate & upload gambar ke R2
      const imagePrompt = `${topic.gambar}, photorealistic, high quality, no text, no watermark`;
      const { url: coverImageUrl } = await generateAndUploadImage(imagePrompt, article.slug);

      // Simpan ke Supabase
      await saveArticle({
        title:            article.judul,
        slug:             article.slug,
        excerpt:          article.excerpt,
        content:          article.konten,
        cover_image:      coverImageUrl,
        tags:             article.tags ?? [],
        meta_description: article.meta_description ?? article.excerpt,
        category:         topic.kategori,
        post_type:        "news",
        status:           "published",
        source:           "ai-agent",
        published_at:     new Date().toISOString(),
      });

      successCount++;
      log(`🎉 Berhasil: "${article.judul}"`);

    } catch (err) {
      console.error(`❌ Error "${topic.topik}": ${err.message}`);
    }

    if (i < topics.length - 1) {
      log(`⏳ Jeda ${DELAY_MS / 1000} detik...`);
      await sleep(DELAY_MS);
    }
  }

  log("═══════════════════════════════════════════════════");
  log(`  SELESAI: ${successCount}/${topics.length} artikel berhasil dipublikasi`);
  log("═══════════════════════════════════════════════════");

  if (successCount === 0 && topics.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌ Fatal:", err.message);
  process.exit(1);
});
