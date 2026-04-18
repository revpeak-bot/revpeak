const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN = process.env.CF_AI_TOKEN;

// Model Cloudflare AI (gratis, tanpa batasan region)
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';

async function dapatkanTrenTerbaru() {
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items.slice(0, 5).map(item => item.title).join(" | ");
    } catch (e) {
        console.log("RSS gagal, menggunakan topik default.");
        return "Teknologi, Politik, dan Ekonomi Indonesia";
    }
}

async function generateBerita(tren) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${CF_MODEL}`;

    const promptText = `Konteks Tren Terkini: ${tren}

Tugas: Sebagai editor senior Revpeak, tuliskan 1 artikel berita trending yang mendalam, akurat, dan netral dalam Bahasa Indonesia.

PENTING: Balas HANYA dengan JSON murni, tanpa teks lain, tanpa markdown, tanpa backtick.
Format JSON:
{
  "title": "Judul berita yang menarik dan SEO-friendly",
  "slug": "url-slug-seo-friendly",
  "excerpt": "Ringkasan singkat berita maksimal 150 karakter",
  "content": "Isi berita lengkap minimal 5 paragraf dengan tag HTML <h2> dan <p>"
}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${CF_AI_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messages: [
                {
                    role: "system",
                    content: "Anda adalah editor senior Revpeak, platform berita dan ulasan produk Indonesia. Anda selalu membalas HANYA dengan JSON murni yang valid, tanpa teks tambahan, tanpa markdown, tanpa backtick."
                },
                {
                    role: "user",
                    content: promptText
                }
            ],
            max_tokens: 2048,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Cloudflare AI Error (${response.status}): ${errText}`);
    }

    const result = await response.json();

    if (!result.success) {
        throw new Error(`Cloudflare AI gagal: ${JSON.stringify(result.errors)}`);
    }

    const rawText = result.result.response.trim();

    // Bersihkan backtick dan karakter kontrol yang menyebabkan JSON.parse gagal
    const cleanText = rawText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();

    // Ekstrak blok JSON terlebih dahulu, lalu sanitasi karakter kontrol di dalamnya
    function sanitizeAndParse(text) {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : text;

        // Ganti karakter kontrol yang tidak di-escape (newline, tab, dll)
        // hanya di dalam nilai string JSON (di antara tanda kutip)
        const sanitized = jsonStr.replace(
            /"((?:[^"\\]|\\.)*)"/g,
            (match, inner) => {
                return '"' + inner
                    .replace(/\n/g, '\\n')
                    .replace(/\r/g, '\\r')
                    .replace(/\t/g, '\\t')
                    .replace(/[\x00-\x1F\x7F]/g, '') // hapus control chars lain
                    + '"';
            }
        );

        return JSON.parse(sanitized);
    }

    let data;
    try {
        data = sanitizeAndParse(cleanText);
    } catch (e) {
        throw new Error("Gagal parse JSON dari respons AI: " + e.message + " | Raw: " + cleanText.substring(0, 300));
    }

    // Validasi field wajib
    if (!data.title || !data.slug || !data.excerpt || !data.content) {
        throw new Error("JSON tidak lengkap, field wajib tidak ada: " + JSON.stringify(data));
    }

    return data;
}

async function simpanKeSupabase(dataAI) {
    // Cek apakah slug sudah ada untuk mencegah duplikat
    const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('slug', dataAI.slug)
        .single();

    if (existing) {
        // Tambahkan timestamp ke slug agar unik
        dataAI.slug = `${dataAI.slug}-${Date.now()}`;
        console.log(`Slug duplikat, diubah menjadi: ${dataAI.slug}`);
    }

    const { error } = await supabase
        .from('reviews')
        .insert([{
            title: dataAI.title,
            slug: dataAI.slug,
            excerpt: dataAI.excerpt,
            content: dataAI.content,
            post_type: 'article',
            is_published: false, // Draft, perlu review manual sebelum publish
            created_at: new Date().toISOString()
        }]);

    if (error) {
        throw new Error("Supabase Error: " + error.message);
    }
}

async function main() {
    try {
        console.log("Mengambil tren terkini dari Google News...");
        const tren = await dapatkanTrenTerbaru();
        console.log("Tren ditemukan:", tren.substring(0, 80) + "...");

        console.log("Menghubungi Cloudflare AI...");
        const dataAI = await generateBerita(tren);
        console.log("Artikel dibuat:", dataAI.title);

        console.log("Menyimpan ke Supabase...");
        await simpanKeSupabase(dataAI);

        console.log(`✅ BERHASIL! Artikel '${dataAI.title}' tersimpan sebagai draft.`);
    } catch (err) {
        console.error("❌ Kegagalan:", err.message);
        process.exit(1);
    }
}

main();
