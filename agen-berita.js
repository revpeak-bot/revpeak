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
        // Ambil hanya judul pertama agar prompt lebih fokus
        return feed.items[0].title;
    } catch (e) {
        console.log('RSS gagal, menggunakan topik default.');
        return 'Politik dan Ekonomi Indonesia terkini';
    }
}

// Parse respons teks biasa dari AI menggunakan delimiter
function parseResponsAI(text) {
    const ambil = (label) => {
        const regex = new RegExp(label + ':\\s*(.+?)(?=\\n[A-Z]+:|$)', 's');
        const match = text.match(regex);
        return match ? match[1].trim() : '';
    };

    const title   = ambil('TITLE');
    const slug    = ambil('SLUG');
    const excerpt = ambil('EXCERPT');
    const konten  = ambil('CONTENT');

    if (!title || !slug || !excerpt || !konten) {
        throw new Error('Field tidak lengkap. Raw: ' + text.substring(0, 300));
    }

    // Konversi konten ke HTML: baris ## menjadi h2, baris lain menjadi p
    const baris = konten.split('\n').filter(b => b.trim() !== '');
    const html = baris.map(b => {
        if (b.startsWith('## ')) return '<h2>' + b.slice(3).trim() + '</h2>';
        return '<p>' + b.trim() + '</p>';
    }).join('\n');

    // Buat slug dari title jika slug kosong atau tidak valid
    const slugBersih = slug
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80);

    return {
        title: title.substring(0, 200),
        slug: slugBersih,
        excerpt: excerpt.substring(0, 160),
        content: html
    };
}

async function generateBerita(tren) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/ai/run/' + CF_MODEL;

    const systemMsg = 'Anda adalah editor berita Indonesia. Ikuti format output yang diminta dengan tepat.';

    const userMsg = 'Tulis artikel berita Bahasa Indonesia tentang topik ini: ' + tren + '\n\n'
        + 'Gunakan format berikut PERSIS, tanpa tambahan teks lain:\n\n'
        + 'TITLE: [judul artikel singkat dan menarik]\n'
        + 'SLUG: [judul-dalam-huruf-kecil-dipisah-tanda-hubung]\n'
        + 'EXCERPT: [ringkasan 1 kalimat maksimal 120 karakter]\n'
        + 'CONTENT:\n'
        + '## [Subjudul Bagian Pertama]\n'
        + '[Paragraf isi pertama, 2-3 kalimat.]\n'
        + '## [Subjudul Bagian Kedua]\n'
        + '[Paragraf isi kedua, 2-3 kalimat.]\n'
        + '[Paragraf penutup, 1-2 kalimat.]';

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
            max_tokens: 700,
            temperature: 0.6
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
    console.log('Raw AI:\n' + rawText.substring(0, 400));

    return parseResponsAI(rawText);
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
        console.log('Topik: ' + tren);

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
