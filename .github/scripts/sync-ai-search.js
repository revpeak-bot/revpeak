// ============================================================
// REVPEAK — .github/scripts/sync-ai-search.js
// Sync konten Revpeak ke Cloudflare AI Search
// Dipanggil oleh GitHub Actions (.github/workflows/sync-ai-search.yml)
//
// Secrets yang dibutuhkan:
//   SUPABASE_URL, SUPABASE_KEY, CF_ACCOUNT_ID, CF_API_TOKEN, WORKER_URL
// ============================================================

const SUPABASE_URL   = process.env.SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_KEY;
const CF_ACCOUNT_ID  = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN   = process.env.CF_API_TOKEN;
const WORKER_URL     = process.env.WORKER_URL; // contoh: https://revpeak-api.revpeak-bot.workers.dev

const AI_SEARCH_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai-search/instances`;

const INSTANCES = {
  artikel  : "revpeak-articles",
  berita   : "revpeak-news",
  buku     : "revpeak-library",
};

// ============================================================
// HELPER: Upload satu file Markdown ke AI Search instance
// POST /instances/{instance}/items
// Docs: https://developers.cloudflare.com/ai-search/get-started/api/
// ============================================================
async function uploadItem(instance, fileId, markdownContent, metadata = {}) {
  const url = `${AI_SEARCH_BASE}/${instance}/items`;

  const form = new FormData();
  form.append(
    "file",
    new Blob([markdownContent], { type: "text/markdown" }),
    `${fileId}.md`   // nama file = fileId, digunakan sebagai key unik di AI Search
  );
  // Metadata opsional: dikirim sebagai JSON string di field "metadata"
  form.append("metadata", JSON.stringify(metadata));

  const res = await fetch(url, {
    method : "POST",
    headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
    body   : form,
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`  ❌ Gagal [${instance}/${fileId}]: ${err}`);
    return false;
  }

  console.log(`  ✅ ${instance}/${fileId}`);
  return true;
}

// ============================================================
// HELPER: Fetch dari Supabase REST API
// Gunakan SUPABASE_SERVICE_KEY agar bisa baca field content (bypass RLS)
// ============================================================
async function supabaseFetch(path) {
  // Prioritaskan service key agar RLS tidak memblokir field content
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      "apikey"       : key,
      "Authorization": `Bearer ${key}`,
      "Content-Type" : "application/json",
    },
  });
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ============================================================
// SYNC ARTIKEL
// Field yang diindeks: title, excerpt, content, category, author
// ============================================================
async function syncArtikels() {
  console.log("\n📰 Sync Artikel...");

  const rows = await supabaseFetch(
    "articles"
    + "?select=slug,title,excerpt,content,published_at,categories(name),authors(name)"
    + "&post_type=eq.article"
    + "&status=eq.published"
    + "&order=published_at.desc"
    + "&limit=500"
  );

  let ok = 0, fail = 0;
  for (const a of rows) {
    const category = a.categories?.name || "";
    const author   = a.authors?.name   || "";

    const md = [
      `# ${a.title}`,
      category ? `Kategori: ${category}` : "",
      author   ? `Penulis: ${author}`     : "",
      "",
      a.excerpt || "",
      "",
      a.content || "",
    ].filter(l => l !== undefined).join("\n").trim();

    const success = await uploadItem(
      INSTANCES.artikel,
      `artikel-${a.slug}`,
      md,
      {
        slug    : a.slug,
        type    : "artikel",
        category: category,
        date    : (a.published_at || "").split("T")[0],
      }
    );

    success ? ok++ : fail++;
  }

  console.log(`  → ${ok} berhasil, ${fail} gagal dari ${rows.length} artikel`);
}

// ============================================================
// SYNC BERITA
// Field yang diindeks: title, excerpt, content, category, author
// ============================================================
async function syncBerita() {
  console.log("\n📡 Sync Berita...");

  const rows = await supabaseFetch(
    "articles"
    + "?select=slug,title,excerpt,content,published_at,categories(name),authors(name)"
    + "&post_type=eq.news"
    + "&status=eq.published"
    + "&order=published_at.desc"
    + "&limit=500"
  );

  let ok = 0, fail = 0;
  for (const n of rows) {
    const category = n.categories?.name || "";
    const author   = n.authors?.name   || "";

    const md = [
      `# ${n.title}`,
      category ? `Kategori: ${category}` : "",
      author   ? `Penulis: ${author}`     : "",
      "",
      n.excerpt || "",
      "",
      n.content || "",
    ].filter(l => l !== undefined).join("\n").trim();

    const success = await uploadItem(
      INSTANCES.berita,
      `berita-${n.slug}`,
      md,
      {
        slug    : n.slug,
        type    : "berita",
        category: category,
        date    : (n.published_at || "").split("T")[0],
      }
    );

    success ? ok++ : fail++;
  }

  console.log(`  → ${ok} berhasil, ${fail} gagal dari ${rows.length} berita`);
}

// ============================================================
// SYNC BUKU
// Data diambil dari Worker (/api/books) karena buku ada di D1
// ============================================================
async function syncBuku() {
  console.log("\n📚 Sync Buku...");

  if (!WORKER_URL) {
    console.warn("  ⚠️  WORKER_URL tidak diset, skip sync buku.");
    return;
  }

  // Ambil semua buku via Worker API (limit 200)
  const res = await fetch(`${WORKER_URL}/api/books?limit=200&page=1`);
  if (!res.ok) {
    console.error(`  ❌ Gagal fetch /api/books: ${res.status}`);
    return;
  }

  const { data: books } = await res.json();
  if (!books?.length) {
    console.log("  → Tidak ada buku ditemukan.");
    return;
  }

  let ok = 0, fail = 0;
  for (const b of books) {
    const md = [
      `# ${b.title}`,
      b.author ? `Penulis: ${b.author}` : "",
      b.genre  ? `Genre: ${b.genre}`   : "",
      b.year   ? `Tahun: ${b.year}`    : "",
      b.file_type ? `Format: ${b.file_type.toUpperCase()}` : "",
      "",
      b.description || "",
    ].filter(l => l !== undefined).join("\n").trim();

    const success = await uploadItem(
      INSTANCES.buku,
      `buku-${b.slug}`,
      md,
      {
        slug  : b.slug,
        type  : "buku",
        genre : b.genre || "",
        format: (b.file_type || "").toLowerCase(),
      }
    );

    success ? ok++ : fail++;
  }

  console.log(`  → ${ok} berhasil, ${fail} gagal dari ${books.length} buku`);
}

// ============================================================
// MAIN
// ============================================================
(async () => {
  console.log("🔄 Revpeak AI Search Sync dimulai...");
  console.log(`   Account : ${CF_ACCOUNT_ID}`);
  console.log(`   Worker  : ${WORKER_URL || "(tidak diset)"}`);

  // Validasi secrets wajib
  const missing = ["SUPABASE_URL", "CF_ACCOUNT_ID", "CF_API_TOKEN"]
    .filter(k => !process.env[k]);

  if (!process.env.SUPABASE_SERVICE_KEY && !process.env.SUPABASE_KEY) {
    missing.push("SUPABASE_SERVICE_KEY atau SUPABASE_KEY");
  }

  if (missing.length) {
    console.error(`\n❌ Secret berikut belum diset: ${missing.join(", ")}`);
    process.exit(1);
  }

  try {
    await syncArtikels();
    await syncBerita();
    await syncBuku();
    console.log("\n🎉 Sync selesai!");
  } catch (err) {
    console.error("\n❌ Error tidak terduga:", err.message);
    process.exit(1);
  }
})();
