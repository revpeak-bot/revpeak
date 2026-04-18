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
        return "Teknologi dan Politik Indonesia";
    }
}

async function generateBerita() {
    const tren = await dapatkanTrenTerbaru();
    
    // MENGGUNAKAN MODEL PRO (Versi 1.5 Pro paling stabil untuk automasi)
    const MODEL = "gemini-2.0-flash"; 
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const promptText = `
        Konteks Tren: ${tren}. 
        Tugas: Sebagai editor senior Revpeak, tuliskan 1 berita trending yang mendalam, akurat, dan netral.
        Hasilkan output HANYA dalam JSON murni:
        {
          "title": "Judul Berita Profesional",
          "slug": "url-slug-seo",
          "excerpt": "Ringkasan berita yang menarik (maks 150 karakter)",
          "content": "Isi berita mendalam (min 5 paragraf) dengan tag HTML <h2>, <p>, <ul>"
        }
    `;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { 
                temperature: 0.8, // Sedikit lebih kreatif untuk model Pro
                response_mime_type: "application/json" 
            }
        })
    });

    const result = await response.json();

    if (result.error) {
        throw new Error(`Google Pro Error (${result.error.code}): ${result.error.message}`);
    }

    if (!result.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error("Model Pro tidak memberikan respons. Kemungkinan limit kuota tercapai.");
    }

    return JSON.parse(result.candidates[0].content.parts[0].text);
}

async function main() {
    try {
        console.log("Menghubungi Agen AI Pro...");
        const dataAI = await generateBerita();
        
        console.log("Mengirim artikel berkualitas ke Supabase...");
        const { error } = await supabase
            .from('reviews') 
            .insert([{ 
                title: dataAI.title,
                slug: dataAI.slug,
                excerpt: dataAI.excerpt,
                content: dataAI.content,
                is_published: false, // Draft
                created_at: new Date()
            }]);

        if (error) throw new Error("Supabase Error: " + error.message);
        console.log("✅ BERHASIL! Artikel Pro '" + dataAI.title + "' telah masuk.");
    } catch (err) {
        console.error("❌ Kegagalan:", err.message);
        process.exit(1);
    }
}

main();
