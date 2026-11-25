# Cloudflare Workers Revpeak

Folder ini hanya **cadangan kode**. Worker tidak ter-deploy otomatis dari GitHub.
Perubahan harus ditempel manual di: Cloudflare → Workers & Pages → (nama worker) → Edit code → Deploy.

## revpeak-api  (route: revpeak.web.id/*)
Mengatur seluruh domain: API (/api/*), URL bersih /{slug} dan /buku/{slug},
sitemap.xml (artikel, berita, buku, kategori, penulis; cache 1 jam; pagination), robots.txt,
dan meneruskan file statis ke GITHUB_ORIGIN.
Versi 2026-11-25: GET /api/admin/books wajib login, JSON-LD aman dari </script>,
canonical/sitemap memakai alamat tetap revpeak.web.id, logo ke /img/.

Binding / variabel yang dibutuhkan (NAMA saja, nilai jangan disimpan di repo):
- SUPABASE_URL, SUPABASE_KEY, GITHUB_ORIGIN, WORKER_SECRET  (Secrets)
- BOOKS_DB   (D1 database: revpeak-books)
- R2_BUCKET  (R2 bucket binding), R2_PUBLIC_URL

## revpeak-sitemap  (route: revpeak.web.id/sitemap.xml) — DIGANTIKAN oleh revpeak-api
Kode: workers/revpeak-sitemap/worker.js (salinan apa adanya dari dashboard).
Hanya melayani /sitemap.xml. Memakai kunci `anon` Supabase yang tertulis langsung di kode
(kunci anon memang publik, aman selama RLS benar).
Catatan: Route ini lebih spesifik daripada revpeak.web.id/*, jadi dialah yang melayani sitemap,
bukan fungsi handleSitemap di revpeak-api (kode itu tidak terpakai).
Belum memuat halaman Perpustakaan dan buku (/buku/{slug}).

Catatan: setelah sitemap di revpeak-api terverifikasi, route /sitemap.xml di revpeak-sitemap dihapus
(Worker ini boleh dihapus kemudian). Rollback: pasang kembali route tersebut.
