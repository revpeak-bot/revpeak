const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN = process.env.CF_AI_TOKEN;
const CF_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Mode bergantian otomatis berdasarkan jam (genap=berita, ganjil=artikel)
// Bisa di-override via env variable MODE=berita atau MODE=artikel
const jamSekarang = new Date().getUTCHours();
const MODE = process.env.MODE || (jamSekarang % 2 === 0 ? 'berita' : 'artikel');

// Daftar topik artikel evergreen — tambah sesuai kebutuhan
const TOPIK_ARTIKEL = [
    'Tips Memilih Laptop untuk Pelajar dengan Budget Terbatas',
    'Cara Mengatur Keuangan Pribadi untuk Pemula Indonesia',
    'Panduan Memilih Smartphone Android Terbaik 2025',
    'Tips Meningkatkan Produktivitas Kerja dari Rumah',
    'Cara Memilih Investasi yang Aman untuk Pemula',
    'Panduan Lengkap Belanja Online Aman di Indonesia',
    'Tips Memilih Kamera untuk Konten Kreator Pemula',
    'Cara Menghemat Kuota Internet di Smartphone',
    'Panduan Memilih Router WiFi untuk Rumah',
    'Tips Merawat Baterai Smartphone agar Tahan Lama',
    'Cara Memilih Earphone dan Headphone yang Tepat',
    'Panduan Memilih Televisi untuk Ruang Keluarga',
    'Tips Belanja Elektronik Bekas yang Aman',
    'Cara Memilih Power Bank Berkualitas',
    'Panduan Memilih Aplikasi Keuangan Terbaik di Indonesia',
    'Tips Menjaga Keamanan Akun Media Sosial',
    'Cara Memilih Hosting Website untuk Pemula',
    'Panduan Memulai Bisnis Online di Indonesia',
    'Tips Memilih Printer untuk Kebutuhan Rumah dan Kantor',
    'Cara Memilih Aplikasi Edit Foto Terbaik di Android',
];

// Sumber RSS berita terpercaya Indonesia
const SUMBER_RSS = [
    { url: 'https://rss.kompas.com/mon/breakingnews', nama: 'Kompas' },
    { url: 'https://www.cnbcindonesia.com/rss',       nama: 'CNBC Indonesia' },
    { url: 'https://news.detik.com/rss',              nama: 'Detik News' },
    { url: 'https://www.antaranews.com/rss/terkini.rss', nama: 'Antara News' },
];

// ─── Helper ───────────────────────────────────────────────────────────────────

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

function jeda(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function topikAcak() {
    // Pilih topik berdasarkan menit sekarang agar tidak mengulang topik yang sama
    const menit = new Date().getUTCMinutes() + new Date().getUTCHours() * 60;
    return TOPIK_ARTIKEL[menit % TOPIK_ARTIKEL.length];
}

async function panggilAI(systemMsg, userMsg, maxTokens = 700) {
    const url = 'https://api.cloudflare.com/client/v4/accounts/'
        + CF_ACCOUNT_ID + '/ai/run/' + CF_MODEL;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + CF_AI_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemMsg },
                { role: 'user',   content: userMsg }
            ],
            max_tokens:  maxTokens,
            temperature: 0.5
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

function ambilLabel(raw, label) {
    const match = raw.match(new RegExp(label + ':\\s*(.+)', 'i'));
    return match ? bersihkan(match[1]) : '';
}

// ─── Rakit HTML ───────────────────────────────────────────────────────────────

function rakitHTML(excerpt, seksi, isiSeksi) {
    let html = '';
    if (excerpt) html += '<p><strong>' + bersihkan(excerpt) + '</strong></p>\n\n';

    seksi.forEach((judulSeksi, i) => {
        html += '<h2>' + bersihkan(judulSeksi) + '</h2>\n';
        const baris = (isiSeksi[i] || '').split('\n').filter(b => b.trim().length > 20);
        if (baris.length > 0) {
            baris.forEach(b => {
                const bersih = bersihkan(b);
                if (bersih.length > 20) html += '<p>' + bersih + '</p>\n';
            });
        } else {
            html += '<p>' + bersihkan(isiSeksi[i] || judulSeksi) + '</p>\n';
        }
        html += '\n';
    });

    return html.trim();
}

// ─── MODE BERITA ──────────────────────────────────────────────────────────────

async function ambilBeritaNyata() {
    for (const sumber of SUMBER_RSS) {
        try {
            const feed  = await parser.parseURL(sumber.url);
            const items = feed.items.filter(item =>
                item.title && (item.contentSnippet || item.content || item.summary)
            );
            if (items.length === 0) continue;

            // Pilih berita berdasarkan menit agar variatif setiap run
            const idx  = new Date().getUTCMinutes() % items.length;
            const item = items[idx];

            console.log('Sumber: ' + sumber.nama);
            console.log('Judul asli: ' + item.title);

            return {
                judulAsli:  item.title || '',
                kontenAsli: item.contentSnippet || item.content || item.summary || '',
                urlAsli:    item.link || '',
                sumber:     sumber.nama
            };
        } catch (e) {
            console.log('RSS gagal (' + sumber.nama + '): ' + e.message);
        }
    }
    throw new Error('Semua sumber RSS tidak dapat diakses.');
}

async function prosesBerita(berita) {
    // Step 1: Outline
    console.log('Membuat outline berita...');
    const outlineRaw = await panggilAI(
        'Anda adalah editor berita senior. Tulis dalam Bahasa Indonesia formal.',
        'Berita asli dari ' + berita.sumber + ':\n'
        + 'Judul: ' + berita.judulAsli + '\n'
        + 'Isi: ' + berita.kontenAsli.substring(0, 800) + '\n\n'
        + 'Buat outline berdasarkan berita di atas:\n'
        + 'JUDUL: [judul menarik Bahasa Indonesia]\n'
        + 'EXCERPT: [ringkasan 1 kalimat]\n'
        + 'SEKSI1: [aspek utama berita]\n'
        + 'SEKSI2: [kronologi atau detail]\n'
        + 'SEKSI3: [konteks dan latar belakang]\n'
        + 'SEKSI4: [dampak dan kesimpulan]',
        350
    );

    const judul   = ambilLabel(outlineRaw, 'JUDUL') || bersihkan(berita.judulAsli);
    const excerpt = ambilLabel(outlineRaw, 'EXCERPT');
    const seksi   = [1,2,3,4]
        .map(n => ambilLabel(outlineRaw, 'SEKSI' + n))
        .filter(s => s.length > 0);

    if (seksi.length < 2) {
        seksi.push(...['Kronologi Kejadian','Konteks Peristiwa','Dampak dan Analisis','Kesimpulan']
            .slice(0, 4 - seksi.length));
    }

    await jeda(1500);

    // Step 2: Tulis tiap seksi
    const isiSeksi = [];
    for (let i = 0; i < seksi.length; i++) {
        console.log('Seksi ' + (i+1) + '/' + seksi.length + ': ' + seksi[i]);
        const isi = await panggilAI(
            'Anda adalah jurnalis Indonesia. Hanya tulis berdasarkan fakta dari berita yang diberikan.',
            'Berita asli:\nJudul: ' + berita.judulAsli + '\n'
            + 'Isi: ' + berita.kontenAsli.substring(0, 600) + '\n\n'
            + 'Tulis seksi "' + seksi[i] + '" untuk artikel "' + judul + '".\n'
            + 'Minimal 4 paragraf (3-4 kalimat per paragraf).\n'
            + 'HANYA berdasarkan fakta berita di atas. Jangan mengarang.',
            700
        );
        isiSeksi.push(isi);
        await jeda(1500);
    }

    const html = rakitHTML(excerpt, seksi, isiSeksi)
        + '\n\n<p><em>Sumber: <a href="' + berita.urlAsli + '" target="_blank">'
        + berita.sumber + '</a></em></p>';

    const jumlahKata = html.replace(/<[^>]+>/g, '').split(/\s+/).length;
    console.log('Jumlah kata berita: ~' + jumlahKata);

    return {
        title:   judul.substring(0, 200),
        slug:    buatSlug(judul),
        excerpt: (excerpt || judul).substring(0, 160),
        content: html
    };
}

// ─── MODE ARTIKEL ─────────────────────────────────────────────────────────────

async function prosesArtikel() {
    const topik = topikAcak();
    console.log('Topik artikel: ' + topik);

    // Step 1: Outline
    console.log('Membuat outline artikel...');
    const outlineRaw = await panggilAI(
        'Anda adalah penulis konten Indonesia profesional.',
        'Buat outline artikel informatif tentang: ' + topik + '\n\n'
        + 'JUDUL: [judul menarik dan SEO-friendly]\n'
        + 'EXCERPT: [manfaat membaca artikel ini]\n'
        + 'SEKSI1: [pengenalan topik]\n'
        + 'SEKSI2: [poin penting pertama]\n'
        + 'SEKSI3: [poin penting kedua]\n'
        + 'SEKSI4: [poin penting ketiga]\n'
        + 'SEKSI5: [tips praktis]\n'
        + 'SEKSI6: [kesimpulan dan rekomendasi]',
        400
    );

    const judul   = ambilLabel(outlineRaw, 'JUDUL') || topik;
    const excerpt = ambilLabel(outlineRaw, 'EXCERPT');
    const seksi   = [1,2,3,4,5,6]
        .map(n => ambilLabel(outlineRaw, 'SEKSI' + n))
        .filter(s => s.length > 0);

    if (seksi.length < 4) throw new Error('Outline artikel tidak lengkap: ' + seksi.length + ' seksi.');

    await jeda(1500);

    // Step 2: Tulis tiap seksi
    const isiSeksi = [];
    for (let i = 0; i < seksi.length; i++) {
        console.log('Seksi ' + (i+1) + '/' + seksi.length + ': ' + seksi[i]);
        const isi = await panggilAI(
            'Anda adalah penulis konten Indonesia yang informatif dan terpercaya.',
            'Artikel: ' + judul + '\n\n'
            + 'Tulis seksi "' + seksi[i] + '".\n'
            + 'Minimal 4 paragraf (3-4 kalimat per paragraf).\n'
            + 'Bahasa Indonesia formal, informatif, berikan contoh konkret.\n'
            + 'Jangan gunakan markdown atau tanda bintang.',
            700
        );
        isiSeksi.push(isi);
        await jeda(1500);
    }

    const html = rakitHTML(excerpt, seksi, isiSeksi);
    const jumlahKata = html.replace(/<[^>]+>/g, '').split(/\s+/).length;
    console.log('Jumlah kata artikel: ~' + jumlahKata);

    return {
        title:   judul.substring(0, 200),
        slug:    buatSlug(judul),
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
        console.log('=== Revpeak AI Agent ===');
        console.log('Mode: ' + MODE + ' | Jam UTC: ' + jamSekarang);

        let dataAI;
        if (MODE === 'artikel') {
            dataAI = await prosesArtikel();
        } else {
            console.log('Mengambil berita dari RSS...');
            const berita = await ambilBeritaNyata();
            dataAI = await prosesBerita(berita);
        }

        console.log('Judul: ' + dataAI.title);
        console.log('Slug: '  + dataAI.slug);

        console.log('Menyimpan ke Supabase...');
        await simpanKeSupabase(dataAI);

        console.log('BERHASIL! Draft tersimpan: ' + dataAI.title);
    } catch (err) {
        console.error('Kegagalan: ' + err.message);
        process.exit(1);
    }
}

main();
