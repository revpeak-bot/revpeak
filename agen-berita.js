const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function dapatkanTrenTerbaru() {
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items.slice(0, 5).map(item => item.title).join(" | ");
    } catch (e) {
        return "Berita Teknologi Populer";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    // Menggunakan Gemini 2.0 Flash - Model standar paling stabil di 2026
    const MODEL = "gemini-1.5-flash"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `Tren: ${tren}. Buat 1 berita viral untuk Revpeak. Output HARUS JSON murni:
    {
      "title": "Judul Berita",
      "slug": "url-slug",
      "excerpt": "Ringkasan",
      "content": "Isi berita HTML"
    }`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { 
                temperature: 0.7,
                response_mime_type: "application/json" 
            }
        })
    });

    const result = await response.json();

    // Pengecekan Error dari Google
    if (result.error) throw new Error("Google AI Error: " + result.error.message);
    if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error("Format respons AI tidak dikenali. Cek kuota API Anda.");
    }

    return JSON.parse(result.candidates[0].content.parts[0].text);
}

async function main() {
    try {
        console.log("Menghubungi Agen AI...");
        const dataAI = await generateBerita();
        
        console.log("Mengirim ke Supabase (Tabel: reviews)...");
        const { error } = await supabase
            .from('reviews') 
            .insert([{ 
                title: dataAI.title,
                slug: dataAI.slug,
                excerpt: dataAI.excerpt,
                content: dataAI.content,
                is_published: false, // Status Draft
                created_at: new Date()
            }]);

        if (error) throw new Error("Supabase Error: " + error.message);
        console.log("✅ BERHASIL! Draf berita '" + dataAI.title + "' sudah masuk.");
    } catch (err) {
        console.error("❌ Kegagalan:", err.message);
        process.exit(1);
    }
}

main();
