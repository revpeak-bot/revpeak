/**
 * agen-berita.js — Revpeak AI News Agent
 * Sumber topik : RSS feed media Indonesia (Antara, CNN, Detik, Kompas)
 * AI penulis   : Cloudflare Workers AI (Llama 3.1)
 * AI gambar    : Cloudflare Workers AI (Stable Diffusion XL)
 * Dijalankan   : GitHub Actions setiap 4 jam
 */

// ─── Environment Variables (dari GitHub Secrets) ──────────────────────────────
const CF_ACCOUNT_ID  = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN    = process.env.CF_AI_TOKEN;
const WORKER_URL     = process.env.WORKER_URL;
const WORKER_SECRET  = process.env.WORKER_SECRET;
const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;

// ─── Konstanta ─────────────────────────────────────────────────────────────────
const CF_AI_BASE    = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run`;
const TEXT_MODEL    = '@cf/meta/llama-3.1-8b-instruct';
const IMAGE_MODEL   = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const JUMLAH_ARTIKEL = 3;
const DELAY_MS       = 5000;

// RSS feed media Indonesia — ambil berita terkini
const RSS_FEEDS = [
  { url: 'https://www.antaranews.com/rss/terkini.xml',          nama: 'Antara News' },
  { url: 'https://www.cnnindonesia.com/nasional/rss',           nama: 'CNN Indonesia' },
  { url: 'https://www.cnnindonesia.com/teknologi/rss',          nama: 'CNN Teknologi' },
  { url: 'https://rss.detik.com/index.php/detikcom',            nama: 'Detik.com' },
  { url: 'https://tekno.kompas.com/rss/index.xml',              nama: 'Kompas Tekno' },
  { url: 'https://health.kompas.com/rss/index.xml',             nama: 'Kompas Health' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseGeminiJSON(text) {
  if (!text) throw new Error('Respons AI kosong');
  const clean = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  const match = clean.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) throw new Error(`Tidak ada JSON valid:\n${clean.slice(0, 300)}`);
  return JSON.parse(match[1]);
}

// ─── Step 1: Fetch & parse RSS feed ───────────────────────────────────────────
async function fetchRSSItems(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'Revpeak-Bot/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];

    const xml = await res.text();

    // Parse judul + deskripsi dari tag <item>
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const block = match[1];
      const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     block.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
      const desc  = (block.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                     block.match(/<description>(.*?)<\/description>/))?.[1]
                       ?.replace(/<[^>]+>/g, '')
                       ?.trim()
                       ?.slice(0, 200);

      if (title && title.length > 10) {
        items.push({ judul: title, ringkasan: desc || '', sumber: feed.nama });
      }
    }

    return items;
  } catch {
    console.log(`   ⚠️  RSS ${feed.nama} gagal diakses, dilewati.`);
    return [];
  }
}

async function getAllRSSItems() {
  console.log('📡 Mengambil berita terkini dari RSS feed...');
  const results = await Promise.all(RSS_FEEDS.map(fetchRSSItems));
  const all = results.flat();
  console.log(`   ✅ Total ${all.length} berita terkumpul dari ${RSS_FEEDS.length} sumber`);
  return all;
}

// ─── Step 2: Llama pilih topik paling menarik dari daftar RSS ─────────────────
async function selectTopics(rssItems) {
  console.log('\n🤖 Llama memilih topik paling viral...');

  const daftarBerita = rssItems
    .slice(0, 40)
    .map((item, i) => `${i + 1}. [${item.sumber}] ${item.judul}`)
    .join('\n');

  const prompt =
    `Kamu adalah editor berita Indonesia. Dari daftar berita di bawah, pilih ` +
    `${JUMLAH_ARTIKEL} berita yang paling menarik, viral, dan beragam topiknya.\n\n` +
    `DAFTAR BERITA:\n${daftarBerita}\n\n` +
    `Kembalikan HANYA JSON array berikut tanpa penjelasan dan tanpa markdown:\n` +
    `[\n` +
    `  {\n` +
    `    "nomor": 1,\n` +
    `    "topik": "judul/topik berita yang dipilih",\n` +
    `    "ringkasan": "ringkasan singkat konteks berita ini",\n` +
    `    "keywords_en": "2-4 kata kunci Bahasa Inggris untuk generate gambar",\n` +
    `    "kategori": "salah satu: teknologi|hiburan|olahraga|nasional|bisnis|gaya-hidup|kesehatan|sains"\n` +
    `  }\n` +
    `]`;

  const res = await fetch(`${CF_AI_BASE}/${TEXT_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_AI_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'Kamu adalah editor berita profesional Indonesia. Selalu balas dalam format JSON yang diminta.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1000,
      temperature: 0.5
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI selectTopics gagal (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data?.result?.response ?? '';
  const topics = parseGeminiJSON(text);

  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('Tidak ada topik yang dipilih Llama');
  }

  console.log(`   ✅ ${topics.length} topik dipilih:`);
  topics.forEach((t, i) => console.log(`   ${i + 1}. [${t.kategori}] ${t.topik}`));
  return topics;
}

// ─── Step 3: Generate artikel lengkap via Llama ────────────────────────────────
async function generateArticle(topic) {
  console.log(`\n📝 Menulis artikel: "${topic.topik}"`);

  const prompt =
    `Tulis artikel berita profesional dalam Bahasa Indonesia tentang:\n` +
    `"${topic.topik}"\n\n` +
    `Konteks: ${topic.ringkasan}\n\n` +
    `Ketentuan:\n` +
    `- Gaya jurnalistik, informatif, orisinal\n` +
    `- Minimal 500 kata\n` +
    `- Format konten HTML: gunakan tag <p>, <h2>, <h3>, <ul>, <li>, <strong>\n` +
    `- Slug: huruf kecil, tanda hubung, tanpa karakter khusus, tanpa angka di awal\n\n` +
    `Kembalikan HANYA JSON berikut tanpa penjelasan dan tanpa markdown:\n` +
    `{\n` +
    `  "judul": "Judul artikel menarik dan SEO-friendly dalam Bahasa Indonesia",\n` +
    `  "slug": "judul-format-slug",\n` +
    `  "excerpt": "Ringkasan 1-2 kalimat maksimal 160 karakter",\n` +
    `  "konten": "<p>Isi artikel dalam HTML...</p>",\n` +
    `  "tags": ["tag1", "tag2", "tag3", "tag4"],\n` +
    `  "meta_description": "Meta description SEO maksimal 160 karakter"\n` +
    `}`;

  const res = await fetch(`${CF_AI_BASE}/${TEXT_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_AI_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'Kamu adalah jurnalis profesional Indonesia. Tulis artikel berita berkualitas tinggi. Selalu balas dalam format JSON yang diminta.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 3000,
      temperature: 0.7
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI generateArticle gagal (${res.status}): ${err}`);
  }

  const data = await res.json();
  const text = data?.result?.response ?? '';
  const article = parseGeminiJSON(text);

  // Validasi field wajib
  for (const field of ['judul', 'slug', 'excerpt', 'konten']) {
    if (!article[field]) throw new Error(`Field "${field}" kosong di respons Llama`);
  }

  // Sanitasi slug
  article.slug = article.slug
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/^\d+/, '');

  console.log(`   ✅ Judul : ${article.judul}`);
  console.log(`   ✅ Slug  : ${article.slug}`);
  return article;
}

// ─── Step 4: Cek duplikat slug di Supabase ─────────────────────────────────────
async function isSlugExists(slug) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/articles?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
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
  } catch {
    return false;
  }
}

// ─── Step 5: Generate cover image via Cloudflare Workers AI ───────────────────
async function generateImage(keywordsEn, kategori) {
  console.log(`🖼️  Generate gambar: "${keywordsEn}"`);

  const styleMap = {
    teknologi    : 'futuristic technology, digital art, blue tones, modern',
    hiburan      : 'entertainment, colorful, vibrant, stage lights',
    olahraga     : 'sports action shot, dynamic, energetic, stadium',
    nasional     : 'Indonesia, news photography, realistic, professional',
    bisnis       : 'business meeting, professional, corporate, finance',
    'gaya-hidup' : 'lifestyle photography, modern living, bright',
    kesehatan    : 'healthcare, medical, clean, doctor, hospital',
    sains        : 'science laboratory, research, discovery'
  };

  const style = styleMap[kategori] || 'news photography, professional journalism';
  const prompt = `${keywordsEn}, ${style}, high quality, sharp focus, 16:9, photorealistic, no text, no watermark`;

  const res = await fetch(`${CF_AI_BASE}/${IMAGE_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CF_AI_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt, num_steps: 20, guidance: 7.5 })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`CF AI image gagal (${res.status}): ${err}`);
  }

  const buffer = await res.arrayBuffer();
  console.log(`   ✅ Gambar di-generate (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  return Buffer.from(buffer);
}

// ─── Step 6: Upload gambar ke Supabase Storage ─────────────────────────────────
async function uploadImage(imageBuffer, slug) {
  const filename = `news/${slug}-${Date.now()}.png`;
  console.log(`☁️  Upload ke Supabase Storage...`);

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

// ─── Step 7: Simpan artikel ke Supabase via Cloudflare Worker ─────────────────
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
  const envCheck = { CF_ACCOUNT_ID, CF_AI_TOKEN, WORKER_URL, WORKER_SECRET, SUPABASE_URL, SUPABASE_KEY };
  const missing = Object.entries(envCheck).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error(`❌ Environment variable belum diset: ${missing.join(', ')}`);
    process.exit(1);
  }

  let successCount = 0;

  // Step 1: Ambil RSS
  const rssItems = await getAllRSSItems();
  if (rssItems.length < 3) {
    console.error('❌ Tidak cukup berita dari RSS feed');
    process.exit(1);
  }

  // Step 2: Pilih topik
  let topics = [];
  try {
    topics = await selectTopics(rssItems);
  } catch (err) {
    console.error(`❌ Gagal memilih topik: ${err.message}`);
    process.exit(1);
  }

  // Step 3–7: Proses tiap topik
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`\n${'─'.repeat(55)}`);
    console.log(`📌 Artikel ${i + 1}/${topics.length}: ${topic.topik}`);
    console.log('─'.repeat(55));

    try {
      // Generate artikel
      const article = await generateArticle(topic);
      await sleep(2000);

      // Cek duplikat slug
      const exists = await isSlugExists(article.slug);
      if (exists) {
        console.log(`   ⚠️  Slug "${article.slug}" sudah ada, dilewati.`);
        continue;
      }

      // Generate & upload gambar
      const imgBuffer = await generateImage(topic.keywords_en, topic.kategori);
      const coverImageUrl = await uploadImage(imgBuffer, article.slug);
      await sleep(1000);

      // Simpan ke Supabase
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

    if (i < topics.length - 1) {
      console.log(`\n⏳ Jeda ${DELAY_MS / 1000} detik...`);
      await sleep(DELAY_MS);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  SELESAI: ${successCount}/${topics.length} artikel berhasil dipublikasi`);
  console.log('═══════════════════════════════════════════════════');

  if (successCount === 0 && topics.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
