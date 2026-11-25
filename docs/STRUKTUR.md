# Struktur Folder Revpeak

```
revpeak/
├── index.html, artikel.html, article.html, berita.html, buku.html,
│   kategori.html, kategori-detail.html, penulis.html, penulis-detail.html,
│   perpustakaan.html, search.html, tentang.html, kontak.html,
│   kebijakan.html, disclaimer.html, admin.html
│        → Halaman website. SENGAJA tetap di root agar alamat URL tidak berubah.
├── css/        → style.css, pages.css, perpustakaan.css, admin.css
├── js/         → app.js, article.js, buku.js, perpustakaan.js, seo.js, admin.js
├── img/        → logo-revpeak.webp, icon-192.png, icon-512.png
├── agents/     → agen-konten.js, agen-berita.js, agen-perpustakaan.js (dijalankan GitHub Actions)
├── .github/
│   ├── workflows/  → agen-konten.yml, otomasi-berita.yml, sync-ai-search.yml
│   └── scripts/    → sync-ai-search.js
├── _archive/   → file lama yang tidak dipakai (tidak dipublikasikan GitHub Pages)
├── docs/       → dokumentasi
├── CNAME, robots.txt, llms.txt, manifest.json, sw.js, package.json   (wajib di root)
```

## Aturan untuk pengembangan
- Halaman baru: taruh di root. CSS di `css/`, JS di `js/`, gambar di `img/`.
- Skrip otomatis baru: taruh di `agents/` lalu buat workflow di `.github/workflows/`.
- Jangan simpan password/token di file mana pun. Pakai GitHub Secrets.

## Catatan temuan (belum diperbaiki)
- `sitemap.xml` belum ada, padahal dipanggil `robots.txt` dan footer (FASE 6).
- `sw.js` memuat daftar file yang salah (`/style.css`, `/app.js`) sehingga Service Worker gagal install (FASE 7).
- `agents/agen-perpustakaan.js` tidak dipanggil workflow mana pun dan butuh paket `pdfkit` (belum ada di package.json).
- `_archive/wrangler-agen.toml`: konfigurasi Worker Cloudflare lama; file `agen-konten-worker.js` yang dirujuknya tidak ada.
