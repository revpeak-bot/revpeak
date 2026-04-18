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
        return "Berita Teknologi dan Viral Terkini";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    // Menggunakan nama model 'gemini-pro' (paling stabil)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        Tren: ${tren}. 
        Buatlah 1 artikel berita trending yang akurat untuk Revpeak.
        Hasilkan output HANYA dalam format JSON murni:
        {
          "title": "Judul Berita",
          "slug": "url-slug-berita",
          "excerpt": "Ringkasan maksimal 150 karakter",
          "content": "Isi berita lengkap dengan tag HTML <h2>, <p>, <ul>",
          "tags": "tag1, tag2",
          "alt_text": "Deskripsi gambar"
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

    // Membersihkan respons dari kemungkinan teks tambahan AI
    let rawText = result.candidates[0].content.parts[0].text;
    rawText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
    
    return JSON.parse(rawText);
}

async function main() {
    try {
        console.log("Agen AI mulai bekerja...");
        const dataAI = await generateBerita();
        
        const { error } = await supabase
            .from('reviews') 
            .insert([{ 
                title: dataAI.title,
                slug: dataAI.slug,
                excerpt: dataAI.excerpt,
                content: dataAI.content,
                tags: dataAI.tags,
                alt_text: dataAI.alt_text,
                type: 'Berita', // Mengatur Tipe Konten
                category: 'Berita', // Mengatur Kategori agar tidak kosong
                author: 'Admin',
                is_published: false,
                created_at: new Date()
            }]);

        if (error) throw new Error("Supabase Error: " + error.message);
        console.log("✅ Berhasil! Draf '" + dataAI.title + "' sudah masuk.");
    } catch (err) {
        console.error("❌ Terjadi Kesalahan:", err.message);
        process.exit(1);
    }
}

main();
