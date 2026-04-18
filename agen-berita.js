const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN = process.env.CF_AI_TOKEN;
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Ambil tren terkini dari Google News RSS
async function dapatkanTrenTerbaru() {
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items.slice(0, 5).map(item => item.title).join(' | ');
    } catch (e) {
        console.log('RSS gagal, menggunakan topik default.');
        return 'Teknologi, Politik, dan Ekonomi Indonesia';
    }
}

// Konversi array paragraf menjadi HTML
function paragraphsToHtml(paragraphs) {
    return paragraphs.map(p => {
        if (p.startsWith('## ')) {
            return '<h2>' + p.replace('## ', '') + '</h2>';
        }
        return '<p>' + p + '</p>';
    }).join('\n');
}

// Ekstrak JSON dari teks respons AI secara aman
function extractJson(text) {
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('Tidak ditemukan blok JSON dalam respons.');
    clean = clean.substring(start, end + 1);

    // Hapus semua karakter kontrol — aman karena konten tidak lagi mengandung HTML
    clean = clean.replace(/[\x00-\x1F\x7F]/g, ' ');

    return JSON.parse(clean);
}

async function generateBerita(tren) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/ai/run/' + CF_MODEL;

    const systemMsg = 'Anda adalah editor senior Revpeak. Balas HANYA dengan JSON valid tanpa teks lain.';
    const userMsg = 'Tren: ' + tren + '. Tulis 1 artikel berita dalam Bahasa Indonesia. '
        + 'Gunakan format JSON ini persis (tanpa newline di dalam nilai string): '
        + '{"title":"judul","slug":"slug-url","excerpt":"ringkasan maks 150 karakter",'
        + '"paragraphs":["## Subjudul Satu","Isi paragraf satu.","## Subjudul Dua","Isi paragraf dua.","Isi paragraf tiga."]}. '
        + 'Tulis minimal 5 elemen di paragraphs. Jangan gunakan tanda kutip ganda di dalam nilai teks.';

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + CF_AI_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user', content: userMsg }
            ],
            max_tokens: 2048,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error('Cloudflare AI Error (' + response.status + '): ' + errText);
    }

    const result = await response.json();
    if (!result.success) {
        throw new Error('Cloudflare AI gagal: ' + JSON.stringify(result.errors));
    }

    const rawText = result.result.response.trim();
    let data;
    try {
        data = extractJson(rawText);
    } catch (e) {
        throw new Error('Gagal parse JSON: ' + e.message + ' | Raw: ' + rawText.substring(0, 400));
    }

    if (!data.title || !data.slug || !data.excerpt || !Array.isArray(data.paragraphs)) {
        throw new Error('JSON tidak lengkap: ' + JSON.stringify(data).substring(0, 200));
    }

    // Konversi array paragraf ke HTML
    data.content = paragraphsToHtml(data.paragraphs);
    return data;
}

async function simpanKeSupabase(dataAI) {
    // Cek duplikat slug
    const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('slug', dataAI.slug)
        .single();

    if (existing) {
        dataAI.slug = dataAI.slug + '-' + Date.now();
        console.log('Slug duplikat, diubah menjadi: ' + dataAI.slug);
    }

    const { error } = await supabase
        .from('reviews')
        .insert([{
            title: dataAI.title,
            slug: dataAI.slug,
            excerpt: dataAI.excerpt,
            content: dataAI.content,
            post_type: 'article',
            is_published: false,
            created_at: new Date().toISOString()
        }]);

    if (error) throw new Error('Supabase Error: ' + error.message);
}

async function main() {
    try {
        console.log('Mengambil tren terkini dari Google News...');
        const tren = await dapatkanTrenTerbaru();
        console.log('Tren: ' + tren.substring(0, 80) + '...');

        console.log('Menghubungi Cloudflare AI...');
        const dataAI = await generateBerita(tren);
        console.log('Artikel dibuat: ' + dataAI.title);

        console.log('Menyimpan ke Supabase...');
        await simpanKeSupabase(dataAI);

        console.log('BERHASIL! Artikel tersimpan sebagai draft: ' + dataAI.title);
    } catch (err) {
        console.error('Kegagalan: ' + err.message);
        process.exit(1);
    }
}

main();
