const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const crypto = require('crypto');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN   = process.env.CF_AI_TOKEN;
const CF_MODEL      = '@cf/meta/llama-3.1-8b-instruct';
const CF_IMG_MODEL  = '@cf/black-forest-labs/flux-1-schnell';

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
            'Content-Type':  'application/json'
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

// ─── Generate Gambar Sampul ───────────────────────────────────────────────────

async function generateGambar(judul, mode) {
    console.log('Membuat gambar sampul...');

    const prompt = mode === 'berita'
        ? 'professional news article cover photo, topic: ' + judul
          + ', modern clean design, high quality editorial photography, no text'
        : 'professional blog article cover illustration, topic: ' + judul
          + ', clean modern design, technology and lifestyle, vibrant colors, no text';

    const url = 'https://api.cloudflare.com/client/v4/accounts/'
        + CF_ACCOUNT_ID + '/ai/run/' + CF_IMG_MODEL;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + CF_AI_TOKEN,
            'Content-Type':  'application/json'
        },
        body: JSON.stringify({ prompt: prompt, steps: 4 })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error('Generate gambar gagal (' + response.status + '): ' + err);
    }

    // REST API mengembalikan JSON dengan field result.image berisi base64
    const json = await response.json();
    if (!json.success) {
        throw new Error('CF Image Error: ' + JSON.stringify(json.errors));
    }

    const base64 = json.result.image;
    if (!base64) {
        throw new Error('Field result.image kosong dari API');
    }

    const buffer = Buffer.from(base64, 'base64');
    console.log('Gambar berhasil di-generate (' + buffer.length + ' bytes)');
    return buffer;
}

// ─── Upload ke R2 (S3-compatible API) ────────────────────────────────────────

function _sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function _hmac(key, data) {
    return crypto.createHmac('sha256', key).update(data).digest();
}

async function uploadKeR2(buffer, filename) {
    const accessKey  = process.env.CF_R2_ACCESS_KEY_ID;
    const secretKey  = process.env.CF_R2_SECRET_ACCESS_KEY;
    const bucket     = process.env.CF_R2_BUCKET || 'image';
    const publicBase = process.env.CF_R2_PUBLIC_URL; // contoh: https://img.revpeak.web.id

    if (!accessKey || !secretKey || !publicBase) {
        throw new Error('Env R2 belum lengkap: CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY, CF_R2_PUBLIC_URL');
    }

    const host        = CF_ACCOUNT_ID + '.r2.cloudflarestorage.com';
    const region      = 'auto';
    const service     = 's3';
    const contentType = 'image/jpeg';
    const objectPath  = '/' + bucket + '/' + filename;

    const now         = new Date();
    const dateStr     = now.toISOString().slice(0, 10).replace(/-/g, '');          // YYYYMMDD
    const datetimeStr = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, ''); // YYYYMMDDTHHmmssZ

    const payloadHash = _sha256Hex(buffer);

    // Header yang akan di-sign — harus terurut secara alfabet
    const headersToSign = {
        'content-type':        contentType,
        'host':                host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date':          datetimeStr
    };

    const sortedKeys      = Object.keys(headersToSign).sort();
    const signedHeaders   = sortedKeys.join(';');
    const canonicalHeaders = sortedKeys.map(k => k + ':' + headersToSign[k]).join('\n') + '\n';

    const canonicalRequest = [
        'PUT',
        objectPath,
        '',
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join('\n');

    const credentialScope = dateStr + '/' + region + '/' + service + '/aws4_request';
    const stringToSign    = [
        'AWS4-HMAC-SHA256',
        datetimeStr,
        credentialScope,
        _sha256Hex(canonicalRequest)
    ].join('\n');

    const signingKey  = _hmac(
        _hmac(_hmac(_hmac('AWS4' + secretKey, dateStr), region), service),
        'aws4_request'
    );
    const signature   = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorization = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope
        + ', SignedHeaders=' + signedHeaders
        + ', Signature=' + signature;

    const uploadUrl = 'https://' + host + objectPath;

    console.log('Mengupload gambar ke R2...');
    const uploadResp = await fetch(uploadUrl, {
        method:  'PUT',
        headers: {
            ...headersToSign,
            'Authorization': authorization
        },
        body: buffer
    });

    if (!uploadResp.ok) {
        const errText = await uploadResp.text();
        throw new Error('Upload R2 gagal (' + uploadResp.status + '): ' + errText);
    }

    const imageUrl = publicBase.replace(/\/$/, '') + '/' + filename;
    console.log('Gambar tersimpan di R2: ' + imageUrl);
    return imageUrl;
}

// ─── Generate + Upload gambar sampul ─────────────────────────────────────────

async function buatGambarSampul(judul, slug, mode) {
    try {
        const buffer   = await generateGambar(judul, mode);
        const filename = 'cover-' + slug + '-' + Date.now() + '.jpg';
        const imageUrl = await uploadKeR2(buffer, filename);
        return imageUrl;
    } catch (err) {
        // Gambar gagal tidak menghentikan proses — konten tetap tersimpan tanpa gambar
        console.warn('Peringatan: Gambar sampul gagal dibuat — ' + err.message);
        if (err.stack) console.warn(err.stack);
        return null;
    }
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
    let seksi     = [1,2,3,4,5,6]
        .map(n => ambilLabel(outlineRaw, 'SEKSI' + n))
        .filter(s => s.length > 0);

    // Fallback jika AI tidak mengikuti format label — gunakan seksi default berdasarkan topik
    if (seksi.length < 4) {
        console.warn('Outline tidak lengkap (' + seksi.length + ' seksi), menggunakan seksi default.');
        seksi = [
            'Pengenalan: ' + topik,
            'Hal-hal Penting yang Perlu Diketahui',
            'Tips dan Panduan Praktis',
            'Faktor yang Perlu Dipertimbangkan',
            'Rekomendasi untuk Pemula',
            'Kesimpulan dan Saran'
        ];
    }

    await jeda(1500);

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

    const payload = {
        title:        dataAI.title,
        slug:         dataAI.slug,
        excerpt:      dataAI.excerpt,
        content:      dataAI.content,
        post_type:    'news',
        is_published: false,
        created_at:   new Date().toISOString()
    };

    // Simpan image_url hanya jika gambar berhasil di-generate
    if (dataAI.image_url) {
        payload.image_url = dataAI.image_url;
    }

    const { error } = await supabase.from('reviews').insert([payload]);
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

        // Generate dan upload gambar sampul
        dataAI.image_url = await buatGambarSampul(dataAI.title, dataAI.slug, MODE);

        console.log('Menyimpan ke Supabase...');
        await simpanKeSupabase(dataAI);

        const statusGambar = dataAI.image_url ? 'dengan gambar sampul' : 'tanpa gambar sampul';
        console.log('BERHASIL! Draft tersimpan ' + statusGambar + ': ' + dataAI.title);
    } catch (err) {
        console.error('Kegagalan: ' + err.message);
        process.exit(1);
    }
}

main();
