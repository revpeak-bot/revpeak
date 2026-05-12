/**
 * agen-berita.js — Revpeak AI News Agent
 * Gemini 2.0 Flash (Google Search grounding) + Cloudflare Workers AI (image)
 * Dijalankan otomatis via GitHub Actions setiap 4 jam
 */

// ─── Environment Variables (dari GitHub Secrets) ──────────────────────────────
const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;
const CF_ACCOUNT_ID   = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN    = process.env.CF_API_TOKEN;
const WORKER_URL      = process.env.WORKER_URL;       // https://revpeak.workers.dev
const WORKER_SECRET   = process.env.WORKER_SECRET;
const SUPABASE_URL    = process.env.SUPABASE_URL;
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY;

// ─── Konstanta ─────────────────────────────────────────────────────────────────
const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.0-flash';
const CF_AI_BASE   = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run`;
const IMAGE_MODEL  = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const JUMLAH_TOPIK = 3;   // artikel per run
const DELAY_MS     = 6000; // jeda antar artikel (hindari rate limit)

// ─── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

function parseGeminiJSON(text) {
  if (!text) throw new Error('Respons Gemini kosong');
  const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  const match = clean.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) throw new Error(`Tidak ada JSON valid dalam respons:\n${clean.slice(0, 300)}`);
  return JSON.parse(match[1]);
}

// ─── Step 1: Cari topik viral via Gemini + Google Search grounding ─────────────
async function getViralTopics() {
  console.log('🔍 Mencari topik viral di Indonesia hari ini...');

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text:
              `Gunakan Google Search untuk mencari ${JUMLAH_TOPIK} topik berita yang ` +
              `sedang paling viral dan banyak diperbincangkan di Indonesia HARI INI.\n\n` +
              `Pilih topik yang beragam. Kembalikan HANYA JSON array berikut, ` +
              `tanpa penjelasan dan tanpa markdown:\n` +
              `[\n` +
              `  {\n` +
              `    "topik": "deskripsi singkat topik dalam Bahasa Indonesia",\n` +
              `    "keywords_en": "2-5 kata kunci Bahasa Inggris untuk generate gambar",\n` +
              `    "kategori": "salah satu: teknologi|hiburan|olahraga|nasional|bisnis|gaya-hidup|kesehatan|sains"\n` +
              `  }\n` +
              `]`
          }]
        }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 800 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini getViralTopics gagal (${res.status}): ${err}`);
  }

  const data = await res.json();
  const topics = parseGeminiJSON(getGeminiText(data));

  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('Tidak ada topik yang dikembalikan Gemini');
  }

  console.log(`✅ ${topics.length} topik ditemukan:`);
  topics.forEach((t, i) => console.log(`   ${i + 1}. [${t.kategori}] ${t.topik}`));
  return topics;
}

// ─── Step 2: Generate artikel lengkap untuk satu topik ─────────────────────────
async function generateArticle(topic) {
  console.log(`\n📝 Menulis artikel: "${topic.topik}"`);

  const res = await fetch(
    `${GEMINI_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text:
              `Gunakan Google Search untuk riset terbaru, lalu tulis artikel berita ` +
              `profesional Bahasa Indonesia tentang:\n"${topic.topik}"\n\n` +
              `Ketentuan:\n` +
              `- Gaya jurnalistik, informatif, orisinal (bukan plagiat)\n` +
              `- Minimal 600 kata\n` +
              `- Format konten dalam HTML: gunakan <p>, <h2>, <h3>, <ul>, <li>, <strong>\n` +
              `- Slug: huruf kecil, tanda hubung, tanpa karakter khusus\n\n` +
              `Kembalikan HANYA JSON berikut, tanpa penjelasan, tanpa markdown:\n` +
              `{\n` +
              `  "judul": "Judul artikel menarik dan SEO-friendly",\n` +
              `  "slug": "judul-format-slug",\n` +
              `  "excerpt": "Ringkasan 1-2 kalimat, maks 160 karakter",\n` +
              `  "konten": "<p>Isi artikel lengkap dalam HTML...</p>",\n` +
              `  "tags": ["tag1", "tag2", "tag3", "tag4"],\n` +
              `  "meta_description": "Meta description SEO maks 160 karakter"\n` +
              `}`
          }]
        }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.75, maxOutputTokens: 4096 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini generateArticle gagal (${res.status}): ${err}`);
  }

  const data = await res.json();
  const article = parseGeminiJSON(getGeminiText(data));

  // Validasi field wajib
  for (const field of ['judul', 'slug', 'excerpt', 'konten']) {
    if (!article[field]) throw new Error(`Field "${field}" kosong di respons Gemini`);
  }

  // Sanitasi slug
  article.slug = article.slug
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  console.log(`   ✅ Judul : ${article.judul}`);
  console.log(`   ✅ Slug  : ${article.slug}`);
  return article;
}

// ─── Step 3: Cek duplikat slug di Supabase ─────────────────────────────────────
async function isSlugExists(slug) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/posts?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    }
  );
  if (!res.ok) return false;
  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

// ─── Step 4: Generate cover image via Cloudflare Workers AI ───────────────────
async function generateImage(keywordsEn, kategori) {
  console.log(`🖼️  Generate gambar: "${keywordsEn}"`);

  const styleMap = {
    teknologi    : 'futuristic technology, digital art, blue tones, modern',
    hiburan      : 'entertainment, colorful, vibrant, celebrity, stage lights',
    olahraga     : 'sports action shot, dynamic, energetic, stadium',
    nasional     : 'Indonesia landmark, news photography, realistic',
    bisnis       : 'business meeting, professional, corporate, finance',
    'gaya-hidup' : 'lifestyle photography, modern living, bright and airy',
    kesehatan    : 'healthcare, medical, clean white background, doctor',
    sains        : 'science laboratory, research, discovery, microscope'
  };

  const style = styleMap[kategori] || 'news photography, professional journalism';
  const prompt = `${keywordsEn}, ${style}, high quality, sharp focus, 16:9, photorealistic, no text, no watermark`;

  const res = await fetch(`${CF_AI_BASE}/${IMAGE_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt, num_steps: 20, guidance: 7.5 })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cloudflare AI image gagal (${res.status}): ${err}`);
  }

  const buffer = await res.arrayBuffer();
  console.log(`   ✅ Gambar di-generate (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  return Buffer.from(buffer);
}

// ─── Step 5: Upload gambar ke Supabase Storage ─────────────────────────────────
async function uploadImage(imageBuffer, slug) {
  const filename = `news/${slug}-${Date.now()}.png`;
  console.log(`☁️  Upload ke Supabase Storage: ${filename}`);

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/images/${filename}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'image/png',
        'x-upsert': 'true'
      },
      body: imageBuffer
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Upload Supabase Storage gagal (${res.status}): ${err}`);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/images/${filename}`;
  console.log(`   ✅ URL: ${publicUrl}`);
  return publicUrl;
}

// ─── Step 6: Simpan artikel ke Supabase via Cloudflare Worker ─────────────────
async function saveArticle(payload) {
  console.log(`💾 Menyimpan artikel via Worker...`);

  const res = await fetch(`${WORKER_URL}/api/save-news`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': WORKER_SECRET
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Worker /api/save-news gagal (${res.status}): ${err}`);
  }

  const result = await res.json();
  console.log(`   ✅ Tersimpan! ID: ${result.id ?? 'N/A'}`);
  return result;
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const waktu = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log('═══════════════════════════════════════════════════');
  console.log('  REVPEAK AI NEWS AGENT');
  console.log(`  ${waktu} WIB`);
  console.log('═══════════════════════════════════════════════════\n');

  // Validasi environment variables
  const envCheck = { GEMINI_API_KEY, CF_ACCOUNT_ID, CF_API_TOKEN, WORKER_URL, WORKER_SECRET, SUPABASE_URL, SUPABASE_KEY };
  const missing = Object.entries(envCheck).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error(`❌ Environment variable belum diset: ${missing.join(', ')}`);
    process.exit(1);
  }

  let successCount = 0;
  let topics = [];

  try {
    topics = await getViralTopics();
  } catch (err) {
    console.error(`❌ Gagal mendapatkan topik viral: ${err.message}`);
    process.exit(1);
  }

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`📌 Artikel ${i + 1}/${topics.length}: ${topic.topik}`);
    console.log('─'.repeat(55));

    try {
      // 1. Generate artikel
      const article = await generateArticle(topic);
      await sleep(2000);

      // 2. Cek duplikat slug
      const exists = await isSlugExists(article.slug);
      if (exists) {
        console.log(`   ⚠️  Slug "${article.slug}" sudah ada di database, dilewati.`);
        continue;
      }

      // 3. Generate & upload gambar
      const imgBuffer = await generateImage(topic.keywords_en, topic.kategori);
      const coverImageUrl = await uploadImage(imgBuffer, article.slug);
      await sleep(1000);

      // 4. Simpan ke Supabase
      await saveArticle({
        title            : article.judul,
        slug             : article.slug,
        excerpt          : article.excerpt,
        content          : article.konten,
        cover_image      : coverImageUrl,
        tags             : article.tags ?? [],
        meta_description : article.meta_description ?? article.excerpt,
        category         : topic.kategori,
        post_type        : 'news',
        status           : 'published',
        source           : 'ai-agent',
        published_at     : new Date().toISOString()
      });

      successCount++;
      console.log(`\n🎉 Berhasil: "${article.judul}"`);

    } catch (err) {
      console.error(`\n❌ Error artikel "${topic.topik}": ${err.message}`);
    }

    // Jeda sebelum iterasi berikutnya
    if (i < topics.length - 1) {
      console.log(`\n⏳ Jeda ${DELAY_MS / 1000} detik...`);
      await sleep(DELAY_MS);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  SELESAI: ${successCount}/${topics.length} artikel berhasil dipublikasi`);
  console.log('═══════════════════════════════════════════════════');

  if (successCount === 0 && topics.length > 0) {
    process.exit(1); // Tandai sebagai gagal di GitHub Actions
  }
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
