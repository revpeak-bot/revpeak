const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase    = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const CF_ACCOUNT_ID  = process.env.CF_ACCOUNT_ID;
const CF_AI_TOKEN    = process.env.CF_AI_TOKEN;
const CF_MODEL       = '@cf/meta/llama-3.1-8b-instruct';
const CF_IMG_MODEL   = '@cf/black-forest-labs/flux-1-schnell';

// ─── Daftar Topik Sains ───────────────────────────────────────────────────────
// Topik ilmiah: luar angkasa, astronomi, geologi, fenomena bumi, oseanografi, dsb.

const TOPIK_ARTIKEL = [
    // Luar angkasa & astronomi
    'Mengenal Black Hole: Fenomena Misterius di Alam Semesta',
    'Bagaimana Bintang Terbentuk dan Mati di Galaksi',
    'Mengenal Planet-Planet di Tata Surya Kita',
    'Apa Itu Lubang Cacing dan Apakah Benar-Benar Ada?',
    'Misteri Materi Gelap yang Menyusun Sebagian Besar Alam Semesta',
    'Mengapa Bulan Bisa Mempengaruhi Pasang Surut Laut di Bumi',
    'Seberapa Jauh Batas Alam Semesta yang Dapat Kita Amati?',
    'Mengenal Nebula: Tempat Lahirnya Bintang-Bintang Baru',
    'Perjalanan Cahaya: Mengapa Langit Malam Gelap Meski Penuh Bintang?',
    'Apakah Ada Kehidupan di Planet Lain? Pencarian Eksoplanet Berpotensi Huni',
    'Fenomena Gerhana Matahari dan Gerhana Bulan: Penjelasan Ilmiah',
    'Komet dan Asteroid: Benda Langit Pengembara di Tata Surya',
    'Supernova: Ledakan Bintang Terdahsyat di Alam Semesta',
    'Misi Manusia ke Mars: Tantangan Ilmiah yang Harus Diatasi',
    'Bagaimana Satelit Buatan Bekerja di Orbit Bumi?',

    // Geologi & interior bumi
    'Bagaimana Gunung Berapi Terbentuk dan Mengapa Meletus?',
    'Mengapa Bumi Masih Memiliki Inti yang Sangat Panas hingga Sekarang?',
    'Lempeng Tektonik: Kekuatan di Balik Gempa Bumi dan Pembentukan Benua',
    'Mengenal Lapisan-Lapisan Bumi dari Kerak hingga Inti',
    'Bagaimana Berlian Terbentuk Jauh di Dalam Perut Bumi?',
    'Fenomena Geyser: Air Panas yang Menyembur dari Dalam Bumi',
    'Apa Itu Gempa Bumi dan Bagaimana Para Ilmuwan Mengukurnya?',
    'Batuan dan Mineral: Sejarah Bumi yang Tersimpan dalam Batu',
    'Magma dan Lava: Perbedaan dan Proses Terbentuknya',
    'Bagaimana Stalaktit dan Stalakmit Terbentuk di Dalam Gua?',

    // Atmosfer & fenomena cuaca
    'Mengapa Langit Berwarna Biru dan Matahari Terbenam Berwarna Merah?',
    'Aurora Borealis: Fenomena Cahaya Indah di Langit Kutub',
    'Badai Petir: Proses Ilmiah di Balik Kilat dan Guntur',
    'Mengapa Terjadi Angin Topan dan Bagaimana Cara Ilmuwan Memprediksinya?',
    'Lapisan Ozon: Perisai Bumi dari Radiasi Ultraviolet',

    // Oseanografi & air
    'Arus Laut Dalam: Sistem Sirkulasi Global yang Mengatur Iklim Bumi',
    'Mengapa Air Laut Asin? Penjelasan Ilmiah yang Menarik',
    'Palung Mariana: Titik Terdalam di Lautan yang Masih Penuh Misteri',
    'Bagaimana Terumbu Karang Terbentuk dan Mengapa Penting bagi Ekosistem Laut',
    'Tsunami: Penyebab, Proses, dan Sistem Peringatan Dini',

    // Ilmu bumi umum
    'Fosil: Cara Ilmuwan Membaca Sejarah Kehidupan Purba di Bumi',
    'Mengapa Bumi Berputar pada Porosnya? Penjelasan Ilmiah',
    'Perubahan Iklim: Bukti Ilmiah dan Dampaknya bagi Bumi',
    'Zaman Es: Kapan Bumi Pernah Tertutup Salju Sepenuhnya?',
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

// ─── Generate Prompt Gambar via AI ───────────────────────────────────────────
// Tahap ini yang mencegah gambar "ngawur":
// AI terlebih dahulu menghasilkan deskripsi visual spesifik berdasarkan judul artikel,
// baru kemudian deskripsi itu dikirim ke model gambar Flux.

async function buatPromptVisual(judulArtikel) {
    console.log('Membuat prompt visual untuk gambar...');

    const raw = await panggilAI(
        'You are an expert at writing precise image generation prompts for scientific articles. '
        + 'Respond ONLY with a single image prompt in English. '
        + 'No explanation, no preamble, no quotes. Just the prompt text.',

        'Write a detailed, specific image generation prompt for a scientific article titled: '
        + '"' + judulArtikel + '"\n\n'
        + 'Requirements:\n'
        + '- Describe the main visual subject clearly and specifically (e.g. a detailed cross-section of Earth layers, '
        + 'a photorealistic view of a black hole with accretion disk, a vivid erupting volcano at night)\n'
        + '- Specify art style: photorealistic OR cinematic digital art OR scientific illustration\n'
        + '- Include lighting and atmosphere descriptors\n'
        + '- End with: high detail, 4K quality, no text, no watermark, no logo\n'
        + '- Maximum 60 words\n'
        + '- Write in English only',
        120
    );

    // Bersihkan output — pastikan tidak ada tanda kutip atau label
    const prompt = raw
        .replace(/^["']|["']$/g, '')
        .replace(/^prompt:\s*/i, '')
        .trim();

    console.log('Prompt visual: ' + prompt);
    return prompt;
}

// ─── Generate Gambar Sampul ───────────────────────────────────────────────────

async function generateGambar(promptVisual) {
    console.log('Membuat gambar sampul...');

    const url = 'https://api.cloudflare.com/client/v4/accounts/'
        + CF_ACCOUNT_ID + '/ai/run/' + CF_IMG_MODEL;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + CF_AI_TOKEN,
            'Content-Type':  'application/json'
        },
        body: JSON.stringify({
            prompt: promptVisual,
            steps:  8   // Flux Schnell maksimum 8 langkah — kualitas tertinggi
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error('Generate gambar gagal (' + response.status + '): ' + err);
    }

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
    const publicBase = process.env.CF_R2_PUBLIC_URL;

    if (!accessKey || !secretKey || !publicBase) {
        throw new Error('Env R2 belum lengkap: CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY, CF_R2_PUBLIC_URL');
    }

    const host        = CF_ACCOUNT_ID + '.r2.cloudflarestorage.com';
    const region      = 'auto';
    const service     = 's3';
    const contentType = 'image/jpeg';
    const objectPath  = '/' + bucket + '/' + filename;

    const now         = new Date();
    const dateStr     = now.toISOString().slice(0, 10).replace(/-/g, '');
    const datetimeStr = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

    const payloadHash = _sha256Hex(buffer);

    const headersToSign = {
        'content-type':         contentType,
        'host':                 host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date':           datetimeStr
    };

    const sortedKeys       = Object.keys(headersToSign).sort();
    const signedHeaders    = sortedKeys.join(';');
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
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        datetimeStr,
        credentialScope,
        _sha256Hex(canonicalRequest)
    ].join('\n');

    const kDate    = _hmac(Buffer.from('AWS4' + secretKey), dateStr);
    const kRegion  = _hmac(kDate, region);
    const kService = _hmac(kRegion, service);
    const kSigning = _hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authorization = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope
        + ', SignedHeaders=' + signedHeaders
        + ', Signature=' + signature;

    const uploadUrl = 'https://' + host + objectPath;

    const uploadResponse = await fetch(uploadUrl, {
        method:  'PUT',
        headers: {
            'Authorization':         authorization,
            'Content-Type':          contentType,
            'x-amz-content-sha256':  payloadHash,
            'x-amz-date':            datetimeStr,
            'Content-Length':        buffer.length.toString()
        },
        body: buffer
    });

    if (!uploadResponse.ok) {
        const errBody = await uploadResponse.text();
        throw new Error('Upload R2 gagal (' + uploadResponse.status + '): ' + errBody);
    }

    const publicUrl = publicBase.replace(/\/$/, '') + '/' + filename;
    console.log('Upload R2 berhasil: ' + publicUrl);
    return publicUrl;
}

async function buatGambarSampul(judul, slug) {
    try {
        // Langkah 1: Buat prompt visual yang akurat via AI
        const promptVisual = await buatPromptVisual(judul);
        await jeda(1000);

        // Langkah 2: Generate gambar dengan prompt yang sudah spesifik
        const buffer   = await generateGambar(promptVisual);
        const filename = slug + '-' + Date.now() + '.jpg';

        // Langkah 3: Upload ke R2
        return await uploadKeR2(buffer, filename);
    } catch (e) {
        console.warn('Gambar sampul gagal, artikel tetap disimpan tanpa gambar. Error: ' + e.message);
        return null;
    }
}

// ─── Proses Artikel Sains ─────────────────────────────────────────────────────

async function prosesArtikel() {
    const topik = topikAcak();
    console.log('Topik artikel sains: ' + topik);

    console.log('Membuat outline artikel...');
    const outlineRaw = await panggilAI(
        'Anda adalah ilmuwan sekaligus penulis sains populer Indonesia yang ahli menjelaskan konsep ilmiah '
        + 'dengan bahasa yang mudah dipahami oleh masyarakat umum. '
        + 'Anda menulis dalam Bahasa Indonesia formal dan informatif.',

        'Buat outline artikel sains populer tentang: ' + topik + '\n\n'
        + 'JUDUL: [judul menarik, informatif, dan SEO-friendly]\n'
        + 'EXCERPT: [deskripsi singkat 1 kalimat mengapa artikel ini menarik]\n'
        + 'SEKSI1: [pengenalan fenomena/konsep ilmiah]\n'
        + 'SEKSI2: [penjelasan ilmiah mendalam]\n'
        + 'SEKSI3: [proses atau mekanisme yang terjadi]\n'
        + 'SEKSI4: [fakta menarik dan penemuan terbaru ilmuwan]\n'
        + 'SEKSI5: [dampak atau relevansi bagi kehidupan dan ilmu pengetahuan]\n'
        + 'SEKSI6: [kesimpulan dan prospek penelitian di masa depan]',
        400
    );

    const judul   = ambilLabel(outlineRaw, 'JUDUL') || topik;
    const excerpt = ambilLabel(outlineRaw, 'EXCERPT');
    let seksi     = [1,2,3,4,5,6]
        .map(n => ambilLabel(outlineRaw, 'SEKSI' + n))
        .filter(s => s.length > 0);

    if (seksi.length < 4) {
        console.warn('Outline tidak lengkap (' + seksi.length + ' seksi), menggunakan seksi default.');
        seksi = [
            'Mengenal Fenomena: ' + topik,
            'Penjelasan Ilmiah',
            'Proses dan Mekanisme',
            'Fakta Menarik dari Para Ilmuwan',
            'Dampak dan Relevansi',
            'Kesimpulan dan Masa Depan Penelitian'
        ];
    }

    await jeda(1500);

    const isiSeksi = [];
    for (let i = 0; i < seksi.length; i++) {
        console.log('Seksi ' + (i+1) + '/' + seksi.length + ': ' + seksi[i]);
        const isi = await panggilAI(
            'Anda adalah ilmuwan dan penulis sains populer Indonesia. '
            + 'Tulis dengan akurat secara ilmiah namun tetap mudah dipahami masyarakat umum. '
            + 'Gunakan analogi jika perlu. Bahasa Indonesia formal. Jangan gunakan markdown atau tanda bintang.',

            'Artikel sains: ' + judul + '\n\n'
            + 'Tulis seksi "' + seksi[i] + '".\n'
            + 'Minimal 4 paragraf (3-4 kalimat per paragraf).\n'
            + 'Sertakan fakta ilmiah konkret, angka, atau contoh nyata bila relevan.\n'
            + 'Jangan gunakan tanda bintang atau markdown apapun.',
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
        post_type:    'article',       // ← selalu article, bukan news
        is_published: false,
        created_at:   new Date().toISOString()
    };

    if (dataAI.image_url) {
        payload.image_url = dataAI.image_url;
    }

    const { error } = await supabase.from('reviews').insert([payload]);
    if (error) throw new Error('Supabase Error: ' + error.message);
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main() {
    try {
        console.log('=== Revpeak AI Agent — Mode Sains ===');

        const dataAI = await prosesArtikel();

        console.log('Judul: ' + dataAI.title);
        console.log('Slug: '  + dataAI.slug);

        // Generate gambar sampul dengan prompt visual yang dihasilkan AI (tidak ngawur)
        dataAI.image_url = await buatGambarSampul(dataAI.title, dataAI.slug);

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
