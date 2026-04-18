const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

// Inisialisasi Database
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function dapatkanTrenTerbaru() {
    try {
        // Mengambil berita trending umum dari Google News Indonesia
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items.slice(0, 8).map(item => item.title).join(" | ");
    } catch (e) {
        console.error("Gagal ambil RSS:", e);
        return "Berita Teknologi Terbaru";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        Hari ini tren berita di Indonesia adalah: ${tren}.
        Tugas Anda sebagai Admin Website Revpeak:
        1. Pilih satu topik yang paling viral (politik, teknologi, gadget, atau event internasional).
        2. Tulis artikel berita yang akurat, tidak manipulatif, dan objektif.
        3. Gunakan data fakta terbaru hingga April 2026.
        4. Wajib hasilkan output dalam format JSON MURNI tanpa markdown:
        {
          "judul": "Judul Berita",
          "slug": "url-berita-seo",
          "excerpt": "Ringkasan berita maksimal 150 karakter",
          "html_content": "Isi berita minimal 4 paragraf dengan tag HTML <h2>, <p>, <ul>",
          "tags": "tag1, tag2, tag3"
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { temperature: 0.7 }
        })
    });

    const result = await response.json();
    let rawText = result.candidates[0].content.parts[0].text;
    
    // Pembersihan jika AI menyertakan format markdown
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(rawText);
}

async function main() {
    try {
        const berita = await generateBerita();
        const { data, error } = await supabase
            .from('konten') // Ganti dengan nama tabel database Anda
            .insert([{ 
                ...berita, 
                tipe: 'Berita', 
                is_published: false, // Disimpan sebagai DRAFT
                created_at: new Date()
            }]);

        if (error) throw error;
        console.log("✅ Berhasil: Draf '" + berita.judul + "' telah ditambahkan.");
    } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
    }
}

main();
