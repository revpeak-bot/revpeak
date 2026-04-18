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
        return "Berita Teknologi Populer 2026";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    // Update 2026: Menggunakan Gemini 2.5 Flash (Model paling stabil untuk Free Tier)
    const MODEL = "gemini-2.5-flash"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        Konteks Hari Ini: ${tren}. 
        Tugas: Buat 1 artikel berita trending yang akurat untuk Revpeak. 
        PENTING: Berikan hasil HANYA dalam format JSON murni tanpa teks pembuka/penutup.
        Format JSON:
        {
          "title": "Judul Berita",
          "slug": "url-slug-seo",
          "excerpt": "Ringkasan maksimal 150 karakter",
          "content": "Isi berita lengkap (minimal 4 paragraf) dengan tag HTML <h2>, <p>, <ul>",
          "tags": "tag1, tag2",
          "alt_text": "Deskripsi gambar SEO"
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: {
                response_mime_type: "application/json" // Memaksa output JSON
            }
        })
    });

    const result = await response.json();
    
    if (result.error) {
        throw new Error(`Google API Error (${result.error.code}): ${result.error.message}`);
    }

    if (!result.candidates || !result.candidates[0]) {
        throw new Error("AI tidak memberikan jawaban. Periksa kuota API Free Tier Anda.");
    }

    const rawText = result.candidates[0].content.parts[0].text;
    return JSON.parse(rawText);
}

async function main() {
    try {
        console.log("Menghubungi Agen AI (Gemini 2.5 Flash)...");
        const dataAI = await generateBerita();
        
        console.log("Mengirim data ke tabel 'reviews'...");
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
                author: 'Admin AI',
                is_published: false, // Simpan sebagai draf
                created_at: new Date()
            }]);

        if (error) throw new Error("Supabase Error: " + error.message);
        console.log("✅ Berhasil! Artikel '" + dataAI.title + "' telah masuk ke dashboard.");
    } catch (err) {
        console.error("❌ Kegagalan:", err.message);
        process.exit(1);
    }
}

main();
