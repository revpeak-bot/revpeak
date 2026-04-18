const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function dapatkanTrenTerbaru() {
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items.slice(0, 8).map(item => item.title).join(" | ");
    } catch (e) {
        return "Teknologi Terbaru 2026";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    // Menggunakan model Gemini 1.5 Pro yang sangat stabil untuk JSON
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        Tren: ${tren}. 
        Buat 1 berita viral/trending hari ini untuk Revpeak.
        Berikan hasil HANYA dalam format JSON murni:
        {
          "judul": "...",
          "slug": "...",
          "excerpt": "...",
          "html_content": "...",
          "tags": "..."
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { 
                temperature: 0.7,
                response_mime_type: "application/json" // Memaksa AI kirim JSON
            }
        })
    });

    const result = await response.json();
    
    // Pengecekan Keamanan: Jika AI tidak menjawab
    if (!result.candidates || !result.candidates[0]) {
        throw new Error("AI tidak memberikan respons. Cek API Key Anda.");
    }

    let rawText = result.candidates[0].content.parts[0].text;
    return JSON.parse(rawText);
}

async function main() {
    try {
        const berita = await generateBerita();
        const { error } = await supabase
            .from('konten')
            .insert([{ 
                ...berita, 
                tipe: 'Berita', 
                is_published: false,
                penulis: 'Agen AI',
                created_at: new Date()
            }]);

        if (error) throw error;
        console.log("✅ Sukses menambahkan draf.");
    } catch (err) {
        console.error("❌ Terjadi Kesalahan:", err.message);
        process.exit(1);
    }
}

main();
