const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN = process.env.CF_AI_TOKEN;
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';

async function dapatkanTrenTerbaru() {
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items.slice(0, 3).map(item => item.title).join(' | ');
    } catch (e) {
        console.log('RSS gagal, menggunakan topik default.');
        return 'Teknologi dan Politik Indonesia';
    }
}

function paragraphsToHtml(paragraphs) {
    return paragraphs.map(p => {
        if (p.startsWith('## ')) return '<h2>' + p.slice(3) + '</h2>';
        return '<p>' + p + '</p>';
    }).join('\n');
}

// Perbaiki JSON yang terpotong sebelum parsing
function repairAndParse(text) {
    // Bersihkan backtick
    let clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();

    // Ambil dari { pertama
    const start = clean.indexOf('{');
    if (start === -1) throw new Error('Tidak ada blok JSON.');
    clean = clean.substring(start);

    // Hapus karakter kontrol
    clean = clean.replace(/[\x00-\x1F\x7F]/g, ' ');

    // Jika JSON lengkap, langsung parse
    if (clean.lastIndexOf('}') !== -1) {
        const end = clean.lastIndexOf('}');
        try {
            return JSON.parse(clean.substring(0, end + 1));
        } catch (e) {
            // lanjut ke repair
        }
    }

    // JSON terpotong — potong di elemen array terakhir yang lengkap
    // Cari koma+kutip terakhir yang menandai akhir elemen valid
    const lastComplete = clean.lastIndexOf('",');
    if (lastComplete !== -1) {
        // Potong di sana, tutup array dan objek
        clean = clean.substring(0, lastComplete + 1) + '"]}';
    } else {
        // Fallback: cari kutip penutup terakhir
        const lastQuote = clean.lastIndexOf('"');
        if (lastQuote !== -1) {
            clean = clean.substring(0, lastQuote + 1) + ']}';
        } else {
            throw new Error('JSON tidak dapat diperbaiki.');
        }
    }

    return JSON.parse(clean);
}

async function generateBerita(tren) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/ai/run/' + CF_MODEL;

    // Prompt sangat ringkas agar respons tidak melebihi token limit
    const systemMsg = 'Balas HANYA dengan JSON valid. Tanpa teks lain.';
    const userMsg = 'Buat 1 artikel berita Bahasa Indonesia tentang: ' + tren
        + '. Format: {"title":"...","slug":"...","excerpt":"maks 100 karakter","paragraphs":["## Judul Bagian","Paragraf isi.","Paragraf isi dua.","## Bagian Dua","Paragraf isi tiga."]}.'
        + ' Maksimal 3 paragraf isi saja. Jangan ada tanda kutip di dalam teks.';

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
            max_tokens: 800,
            temperature: 0.5
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
    console.log('Raw AI (200 char): ' + rawText.substring(0, 200));

    let data;
    try {
        data = repairAndParse(rawText);
    } catch (e) {
        throw new Error('Gagal parse JSON: ' + e.message);
    }

    if (!data.title || !data.slug || !data.excerpt) {
        throw new Error('Field wajib tidak ada: ' + JSON.stringify(data).substring(0, 200));
    }

    // Jika paragraphs ada, konversi ke HTML. Jika tidak, buat konten minimal.
    if (Array.isArray(data.paragraphs) && data.paragraphs.length > 0) {
        data.content = paragraphsToHtml(data.paragraphs);
    } else {
        data.content = '<p>' + data.excerpt + '</p>';
    }

    return data;
}

async function simpanKeSupabase(dataAI) {
    const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('slug', dataAI.slug)
        .single();

    if (existing) {
        dataAI.slug = dataAI.slug + '-' + Date.now();
        console.log('Slug duplikat, diubah: ' + dataAI.slug);
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
        console.log('Mengambil tren dari Google News...');
        const tren = await dapatkanTrenTerbaru();
        console.log('Tren: ' + tren.substring(0, 80) + '...');

        console.log('Menghubungi Cloudflare AI...');
        const dataAI = await generateBerita(tren);
        console.log('Artikel: ' + dataAI.title);

        console.log('Menyimpan ke Supabase...');
        await simpanKeSupabase(dataAI);

        console.log('BERHASIL! Draft tersimpan: ' + dataAI.title);
    } catch (err) {
        console.error('Kegagalan: ' + err.message);
        process.exit(1);
    }
}

main();
