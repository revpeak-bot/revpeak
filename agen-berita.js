const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN = process.env.CF_AI_TOKEN;
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// ─── Helper ───────────────────────────────────────────────────────────────────

async function dapatkanTrenTerbaru() {
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items[0].title;
    } catch (e) {
        return 'Politik dan Ekonomi Indonesia terkini';
    }
}

function bersihkan(teks) {
    return teks.replace(/\*\*/g, '').replace(/\*/g, '').replace(/^#+\s*/, '').trim();
}

function buatSlug(judul) {
    return judul
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 80)
        .replace(/-$/, '');
}

// Panggil Cloudflare AI dengan satu prompt
async function panggilAI(systemMsg, userMsg, maxTokens = 700) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/' + CF_ACCOUNT_ID + '/ai/run/' + CF_MODEL;

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
            max_tokens: maxTokens,
            temperature: 0.6
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error('Cloudflare AI Error (' + response.status + '): ' + errText);
    }

    const result = await response.json();
    if (!result.success) throw new Error('CF gagal: ' + JSON.stringify(result.errors));

    return result.result.response.trim();
}

// Jeda antar request agar tidak kena rate limit
function jeda(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Step 1: Buat outline artikel ─────────────────────────────────────────────

async function buatOutline(topik) {
    console.log('Step 1: Membuat outline...');

    const raw = await panggilAI(
        'Anda adalah editor berita senior Indonesia. Jawab singkat dan tepat.',
        'Topik berita: ' + topik + '\n\n'
        + 'Buat outline artikel dalam format berikut (tanpa teks lain):\n'
        + 'JUDUL: [judul artikel menarik]\n'
        + 'EXCERPT: [ringkasan 1 kalimat]\n'
        + 'SEKSI1: [judul seksi pertama]\n'
        + 'SEKSI2: [judul seksi kedua]\n'
        + 'SEKSI3: [judul seksi ketiga]\n'
        + 'SEKSI4: [judul seksi keempat]\n'
        + 'SEKSI5: [judul seksi kelima]\n'
        + 'SEKSI6: [judul seksi keenam]',
        400
    );

    console.log('Outline raw:\n' + raw.substring(0, 300));

    const ambil = (label) => {
        const match = raw.match(new RegExp(label + ':\\s*(.+)', 'i'));
        return match ? bersihkan(match[1]) : '';
    };

    const judul   = ambil('JUDUL') || bersihkan(raw.split('\n')[0]);
    const excerpt = ambil('EXCERPT') || '';
    const seksi   = [1,2,3,4,5,6].map(n => ambil('SEKSI' + n)).filter(s => s.length > 0);

    if (!judul) throw new Error('Gagal mendapat judul dari outline.');
    if (seksi.length < 4) throw new Error('Outline tidak lengkap, hanya ' + seksi.length + ' seksi.');

    return { judul, excerpt, seksi };
}

// ─── Step 2: Tulis konten tiap seksi ─────────────────────────────────────────

async function tulisSeksi(topik, judulArtikel, judulSeksi, nomorSeksi) {
    console.log('Step 2.' + nomorSeksi + ': Menulis seksi "' + judulSeksi + '"...');

    const raw = await panggilAI(
        'Anda adalah jurnalis Indonesia profesional. Tulis dengan bahasa formal dan informatif.',
        'Artikel berjudul: ' + judulArtikel + '\n'
        + 'Topik utama: ' + topik + '\n\n'
        + 'Tulis isi seksi berjudul "' + judulSeksi + '".\n'
        + 'Ketentuan:\n'
        + '- Minimal 4 paragraf\n'
        + '- Setiap paragraf minimal 4 kalimat\n'
        + '- Bahasa Indonesia formal\n'
        + '- Langsung tulis isinya tanpa mengulang judul seksi\n'
        + '- Jangan gunakan markdown (tanpa **, tanpa #)',
        700
    );

    return raw;
}

// ─── Step 3: Rakit HTML lengkap ───────────────────────────────────────────────

function rakitHTML(judulArtikel, excerpt, seksi, isiSeksi) {
    let html = '';

    // Intro paragraf dari excerpt
    html += '<p>' + excerpt + '</p>\n\n';

    // Gabungkan tiap seksi
    seksi.forEach((judulSeksi, i) => {
        html += '<h2>' + judulSeksi + '</h2>\n';

        const isi = isiSeksi[i] || '';
        const baris = isi.split('\n').filter(b => b.trim().length > 20);

        if (baris.length > 0) {
            baris.forEach(b => {
                const bersih = bersihkan(b);
                if (bersih.length > 20) {
                    html += '<p>' + bersih + '</p>\n';
                }
            });
        } else {
            // Fallback jika isi kosong
            html += '<p>' + bersihkan(isi || judulSeksi) + '</p>\n';
        }

        html += '\n';
    });

    return html.trim();
}

// ─── Main generator ───────────────────────────────────────────────────────────

async function generateArtikel(topik) {
    // Step 1: Outline
    const { judul, excerpt, seksi } = await buatOutline(topik);
    console.log('Judul: ' + judul);
    console.log('Seksi: ' + seksi.join(' | '));

    await jeda(1000);

    // Step 2: Tulis setiap seksi (6 seksi × ~400 kata = ~2400 kata)
    const isiSeksi = [];
    for (let i = 0; i < seksi.length; i++) {
        const isi = await tulisSeksi(topik, judul, seksi[i], i + 1);
        isiSeksi.push(isi);
        await jeda(1500); // jeda 1.5 detik antar request
    }

    // Step 3: Rakit HTML
    const html = rakitHTML(judul, excerpt, seksi, isiSeksi);
    const slug  = buatSlug(judul);

    // Hitung estimasi kata
    const jumlahKata = html.replace(/<[^>]+>/g, '').split(/\s+/).length;
    console.log('Estimasi kata: ' + jumlahKata);

    return {
        title:   judul.substring(0, 200),
        slug:    slug,
        excerpt: (excerpt || judul).substring(0, 160),
        content: html
    };
}

// ─── Simpan ke Supabase ───────────────────────────────────────────────────────

async function simpanKeSupabase(dataAI) {
    const { data: existing } = await supabase
        .from('reviews').select('id').eq('slug', dataAI.slug).single();

    if (existing) {
        dataAI.slug = dataAI.slug + '-' + Date.now();
        console.log('Slug duplikat, diubah: ' + dataAI.slug);
    }

    const { error } = await supabase.from('reviews').insert([{
        title:        dataAI.title,
        slug:         dataAI.slug,
        excerpt:      dataAI.excerpt,
        content:      dataAI.content,
        post_type:    'news',
        is_published: false,
        created_at:   new Date().toISOString()
    }]);

    if (error) throw new Error('Supabase Error: ' + error.message);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
    try {
        console.log('Mengambil tren dari Google News...');
        const topik = await dapatkanTrenTerbaru();
        console.log('Topik: ' + topik);

        const dataAI = await generateArtikel(topik);
        console.log('Artikel selesai: ' + dataAI.title);

        console.log('Menyimpan ke Supabase...');
        await simpanKeSupabase(dataAI);

        console.log('BERHASIL! Draft tersimpan: ' + dataAI.title);
    } catch (err) {
        console.error('Kegagalan: ' + err.message);
        process.exit(1);
    }
}

main();
