// .github/scripts/sync-ai-search.js
// Sync konten Revpeak ke Cloudflare AI Search

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;

const INSTANCES = {
  articles: 'revpeak-articles',
  news: 'revpeak-news',
  library: 'revpeak-library',
};

const AI_SEARCH_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai-search/instances`;

// ─── Helper: Upload file ke AI Search instance ───────────────────────────────
async function uploadToAISearch(instanceName, fileId, content, metadata = {}) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const form = new FormData();
  form.append('file', blob, `${fileId}.md`);
  form.append('metadata', JSON.stringify(metadata));

  const res = await fetch(`${AI_SEARCH_BASE}/${instanceName}/items/${fileId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ Gagal upload ${fileId} ke ${instanceName}:`, err);
  } else {
    console.log(`✅ Uploaded: ${instanceName}/${fileId}`);
  }
}

// ─── Fetch dari Supabase ──────────────────────────────────────────────────────
async function fetchFromSupabase(table, select, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=${select}${filters}&limit=500`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  return res.json();
}

// ─── Sync Artikel ─────────────────────────────────────────────────────────────
async function syncArticles() {
  console.log('\n📰 Sync Artikel...');
  const articles = await fetchFromSupabase(
    'articles',
    'id,slug,title,excerpt,content,created_at',
    '&post_type=eq.artikel&status=eq.published&order=created_at.desc'
  );

  for (const a of articles) {
    const md = `# ${a.title}\n\n${a.excerpt || ''}\n\n${a.content || ''}`;
    await uploadToAISearch(INSTANCES.articles, `artikel-${a.slug}`, md, {
      slug: a.slug,
      type: 'artikel',
      date: a.created_at,
    });
  }
  console.log(`✅ Selesai sync ${articles.length} artikel`);
}

// ─── Sync Berita ──────────────────────────────────────────────────────────────
async function syncNews() {
  console.log('\n📡 Sync Berita...');
  const news = await fetchFromSupabase(
    'articles',
    'id,slug,title,excerpt,content,created_at',
    '&post_type=eq.berita&status=eq.published&order=created_at.desc'
  );

  for (const n of news) {
    const md = `# ${n.title}\n\n${n.excerpt || ''}\n\n${n.content || ''}`;
    await uploadToAISearch(INSTANCES.news, `berita-${n.slug}`, md, {
      slug: n.slug,
      type: 'berita',
      date: n.created_at,
    });
  }
  console.log(`✅ Selesai sync ${news.length} berita`);
}

// ─── Sync Buku (via Worker D1 API) ───────────────────────────────────────────
async function syncBooks() {
  console.log('\n📚 Sync Buku...');
  const res = await fetch('https://revpeak-api.revpeak-bot.workers.dev/api/books?limit=200', {
    headers: { 'x-internal-key': process.env.INTERNAL_API_KEY || '' },
  });
  const { data: books } = await res.json();

  for (const b of books) {
    const md = `# ${b.title}\n\nPenulis: ${b.author || '-'}\nGenre: ${b.genre || '-'}\n\n${b.description || ''}`;
    await uploadToAISearch(INSTANCES.library, `buku-${b.slug}`, md, {
      slug: b.slug,
      type: 'buku',
      date: b.created_at,
    });
  }
  console.log(`✅ Selesai sync ${books?.length || 0} buku`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('🔄 Memulai sync Revpeak → Cloudflare AI Search...');
  await syncArticles();
  await syncNews();
  await syncBooks();
  console.log('\n🎉 Semua konten berhasil diindeks!');
})();
