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
        return feed.items[0].title;
    } catch (e) {
        return 'Politik dan Ekonomi Indonesia terkini';
    }
}

// Bersihkan teks dari markdown dan spasi berlebih
function bersihkan(teks) {
    return teks
        .replace(/\*\*/g, '')   // hapus bold **
        .replace(/\*/g, '')     // hapus italic *
        .replace(/^#+\s*/,'')   // hapus heading #
        .trim();
}

// Buat slug dari judul
function buatSlug(judul) {
    return judul
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80)
        .replace(/-$/, '');
}

// Parser fleksibel — menangani berbagai variasi output model
function parseResponsAI(raw) {
    const baris = raw.split('\n');
    let title = '', slug = '', excerpt = '', contentBaris = [];
    let modeContent = false;

    for (let i = 0; i < baris.length; i++) {
        const b = baris[i].trim();
        if (!b) continue;

        // Deteksi label dengan berbagai format (TITLE:, title:, **Title**, dll)
        const bUpper = b.toUpperCase();

        if (!modeContent && bUpper.startsWith('TITLE:')) {
            title = bersihkan(b.replace(/^TITLE:\s*/i, ''));
        } else if (!modeContent && bUpper.startsWith('SLUG:')) {
            slug = b.replace(/^SLUG:\s*/i, '').replace(/\s/g, '-').toLowerCase().substring(0, 80);
        } else if (!modeContent && bUpper.startsWith('EXCERPT:')) {
            excerpt = bersihkan(b.replace(/^EXCERPT:\s*/i, '')).substring(0, 160);
        } else if (!modeContent && bUpper.startsWith('CONTENT:')) {
            modeContent = true;
        } else if (modeContent) {
            contentBaris.push(b);
        } else if (!title && b.startsWith('**') && b.endsWith('**')) {
            // Model memakai **judul** tanpa label TITLE:
            title = bersihkan(b);
        } else if (!title && !slug && !excerpt && i === 0) {
            // Baris pertama sebagai judul fallback
            title = bersihkan(b);
        }
    }

    // Fallback: jika excerpt tidak ditemukan, cari baris non-heading pertama di content
    if (!excerpt && contentBaris.length > 0) {
        const firstPara = contentBaris.find(b => !b.startsWith('#'));
        if (firstPara) excerpt = bersihkan(firstPara).substring(0, 160);
    }

    // Fallback: jika title masih kosong, ambil baris pertama yang ada teks
    if (!title) {
        const firstLine = baris.find(b => b.trim().length > 5);
        if (firstLine) title = bersihkan(firstLine).substring(0, 200);
    }

    // Fallback: jika slug kosong, buat dari title
    if (!slug && title) slug = buatSlug(title);

    // Jika content kosong, coba semua baris sebagai content
    if (contentBaris.length === 0) {
        contentBaris = baris.filter(b => b.trim() && !b.toUpperCase().startsWith('TITLE:')
            && !b.toUpperCase().startsWith('SLUG:') && !b.toUpperCase().startsWith('EXCERPT:'));
    }

    if (!title) throw new Error('Judul tidak ditemukan. Raw: ' + raw.substring(0, 200));

    // Konversi ke HTML
    const html = contentBaris.map(b => {
        if (b.startsWith('## ') || b.startsWith('# ')) return '<h2>' + bersihkan(b) + '</h2>';
        return '<p>' + bersihkan(b) + '</p>';
    }).join('\n');

    return {
        title: title.substring(0, 200),
        slug: slug || buatSlug(title),
        excerpt: excerpt || title.substring(0, 160),
        content: html || '<p>' + excerpt + '</p>'
    };
}

async function generateBerita(tren) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/ai/run/' + CF_MODEL;

    const systemMsg = 'Anda adalah editor berita Indonesia yang profesional.';
    const userMsg = 'Tulis artikel berita Bahasa Indonesia tentang: ' + tren + '\n\n'
        + 'Gunakan format ini:\n'
        + 'TITLE: [judul singkat]\n'
        + 'SLUG: [judul-pakai-tanda-hubung]\n'
        + 'EXCERPT: [ringkasan 1 kalimat]\n'
        + 'CONTENT:\n'
        + '## [Subjudul]\n'
        + '[2-3 kalimat isi]\n'
        + '## [Subjudul 2]\n'
        + '[2-3 kalimat isi]';

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
            max_tokens: 600,
            temperature: 0.5
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error('Cloudflare AI Error (' + response.status + '): ' + errText);
    }

    const result = await response.json();
    if (!result.success) throw new Error('CF gagal: ' + JSON.stringify(result.errors));

    const rawText = result.result.response.trim();
    console.log('Raw AI:\n' + rawText.substring(0, 500));

    return parseResponsAI(rawText);
}

async function simpanKeSupabase(dataAI) {
    const { data: existing } = await supabase
        .from('reviews').select('id').eq('slug', dataAI.slug).single();

    if (existing) {
        dataAI.slug = dataAI.slug + '-' + Date.now();
        console.log('Slug duplikat, diubah: ' + dataAI.slug);
    }

    const { error } = await supabase.from('reviews').insert([{
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
        console.log('Judul: ' + dataAI.title);
        console.log('Slug: ' + dataAI.slug);

        console.log('Menyimpan ke Supabase...');
        await simpanKeSupabase(dataAI);

        console.log('BERHASIL! Draft tersimpan: ' + dataAI.title);
    } catch (err) {
        console.error('Kegagalan: ' + err.message);
        process.exit(1);
    }
}

main();
