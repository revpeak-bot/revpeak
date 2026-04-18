const { createClient } = require('@supabase/supabase-js');
const Parser = require('rss-parser');
const parser = new Parser();

// Inisialisasi Supabase & Gemini
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function dapatkanTrenTerbaru() {
    try {
        const feed = await parser.parseURL('https://news.google.com/rss?hl=id&gl=ID&ceid=ID:id');
        return feed.items.slice(0, 8).map(item => item.title).join(" | ");
    } catch (e) {
        return "Berita Teknologi dan Tren Viral Terbaru";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    // Menggunakan model Flash agar stabil dan cepat untuk pengujian
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        Tren saat ini: ${tren}. 
        Buatlah 1 artikel berita trending yang akurat, tidak manipulatif, dan objektif untuk website Revpeak.
        Berikan hasil HANYA dalam format JSON murni:
        {
          "title": "Judul Berita yang Menarik",
          "slug": "url-slug-berita-seo",
          "excerpt": "Ringkasan berita maksimal 150 karakter",
          "content": "Isi berita lengkap minimal 4 paragraf menggunakan tag HTML <h2>, <p>, <ul>",
          "tags": "tag1, tag2",
          "alt_text": "Deskripsi gambar untuk SEO"
        }
    `;

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
    if (result.error) throw new Error("Google AI Error: " + result.error.message);
    
    return JSON.parse(result.candidates[0].content.parts[0].text);
}

async function main() {
    try {
        console.log("Agen AI mulai bekerja mencari berita...");
        const dataAI = await generateBerita();
        
        // Memasukkan data ke tabel 'reviews' dengan nama kolom yang sudah Anda berikan
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
                is_published: false, // Disimpan sebagai Draft
                created_at: new Date()
            }]);

        if (error) throw new Error("Supabase Error: " + error.message);
        console.log("✅ Berhasil! Draf '" + dataAI.title + "' sudah masuk ke tabel reviews.");
    } catch (err) {
        console.error("❌ Terjadi Kesalahan:", err.message);
        process.exit(1);
    }
}

main();
