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
        return "Berita Teknologi Viral";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    // Menggunakan model 1.5-pro-latest yang paling didukung saat ini
    const MODEL = "gemini-1.5-pro-latest"; 
    const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        Hari ini trennya: ${tren}. Buat 1 berita trending akurat untuk Revpeak. 
        Hasilkan output HANYA JSON murni:
        {
          "title": "...",
          "slug": "...",
          "excerpt": "...",
          "content": "...",
          "tags": "...",
          "alt_text": "..."
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }]
        })
    });

    const result = await response.json();
    
    if (result.error) {
        throw new Error("Google AI Error: " + result.error.message);
    }

    let rawText = result.candidates[0].content.parts[0].text;
    // Bersihkan karakter markdown jika ada
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return JSON.parse(rawText);
}

async function main() {
    try {
        console.log("Menghubungi Google AI...");
        const dataAI = await generateBerita();
        
        console.log("Mengirim ke Supabase...");
        const { error } = await supabase
            .from('reviews') 
            .insert([{ 
                title: dataAI.title,
                slug: dataAI.slug,
                excerpt: dataAI.excerpt,
                content: dataAI.content,
                tags: dataAI.tags,
                alt_text: dataAI.alt_text,
                type: 'Berita',
                author: 'Admin',
                is_published: false,
                created_at: new Date()
            }]);

        if (error) throw new Error("Supabase Error: " + error.message);
        console.log("✅ Berhasil! Cek dashboard Anda sekarang.");
    } catch (err) {
        console.error("❌ Terjadi Kesalahan:", err.message);
        process.exit(1);
    }
}

main();
