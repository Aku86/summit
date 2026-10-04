# Summit Base — Fullstack MongoDB Release

Versi ini menggunakan **Node.js + MongoDB Atlas** sebagai backend database sehingga dapat dipakai di Vercel tanpa bergantung pada file SQLite lokal.

## Fitur utama

- Katalog alat dibaca dari MongoDB.
- Admin dapat menambah, mengedit, mengaktifkan/menonaktifkan alat.
- Stok tersimpan di MongoDB dan berkurang saat rental disetujui.
- Stok kembali saat rental diubah menjadi `Dikembalikan`.
- Customer membuat akun dengan nama, email, password, dan nomor telepon.
- Dari setiap produk, customer langsung masuk ke alur sewa. Tidak ada sistem keranjang.
- Bisa menyewa beberapa jenis alat sekaligus.
- Tiap alat punya kontrol `− / jumlah / +` dan mengikuti stok.
- Total harga dan unit diperbarui real-time di frontend.
- Customer melihat sewaan aktif dan riwayat.
- Admin melihat transaksi, statistik, approval, status, dan dapat mencetak struk thermal 58 mm.
- Admin dapat mengelola akun admin.
- Password disimpan dengan `scrypt`, bukan plaintext.
- Session memakai cookie HttpOnly + token acak yang hanya disimpan dalam bentuk hash di MongoDB.
- State-changing request dilindungi pengecekan origin dan cookie SameSite.
- Security headers dan CSP aktif.
- Foto alat tetap dapat disimpan sebagai data URL di MongoDB dengan batas payload yang aman.

## Struktur database MongoDB

Database default: `summit_base`

Collection utama:

- `users`
- `admin_users`
- `sessions`
- `catalog`
- `rentals`
- `rental_extensions`
- `counters`

Item rental disimpan sebagai array `items` di dalam dokumen `rentals`.

## Tutorial MongoDB

Panduan lengkap membuat MongoDB Atlas, menghubungkan `.env`, melihat collection, testing lokal, dan deploy ke Vercel tersedia di **[MONGODB-SETUP.md](./MONGODB-SETUP.md)**.

## Menjalankan lokal

Gunakan Node.js 22.16+.

1. Buat MongoDB Atlas cluster atau gunakan MongoDB lokal.
2. Salin `.env.example` menjadi `.env`.
3. Isi `MONGODB_URI` dan `MONGODB_DB`.
4. Install dependency:

```bash
npm install
```

5. Jalankan:

```bash
npm start
```

Buka:

- Website: `http://localhost:3000/`
- Customer: `http://localhost:3000/customer.html`
- Admin: `http://localhost:3000/admin.html`
- Health: `http://localhost:3000/api/health`

Akun admin pertama mengikuti `ADMIN_EMAIL` dan `ADMIN_PASSWORD` dari `.env`.

## Environment Variables

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb+srv://...
MONGODB_DB=summit_base
ADMIN_EMAIL=admin@summitbase.local
ADMIN_PASSWORD=...
ADMIN_NAME=Summit Base Admin
SESSION_TTL_DAYS=7
COOKIE_SECURE=false
TRUST_PROXY=false
```

Untuk production/Vercel, simpan semua nilai rahasia melalui Environment Variables Vercel. **Jangan commit `.env` dan jangan memasukkan `MONGODB_URI` asli ke GitHub.**

## Deploy Vercel + MongoDB Atlas

Project sudah dilengkapi `api/index.js` dan `vercel.json`. Semua request diteruskan ke handler Node sehingga URL website, API, customer, dan admin tetap memakai project yang sama.

Langkah ringkas:

1. Buat MongoDB Atlas cluster.
2. Buat database user untuk aplikasi.
3. Atur Network Access Atlas sesuai deployment. Untuk koneksi langsung dari deployment Vercel, Atlas mendokumentasikan penggunaan allowlist `0.0.0.0/0` karena Vercel memakai IP dinamis; terapkan kredensial database dengan least privilege. 
4. Di Vercel → Project → Settings → Environment Variables tambahkan:
   - `MONGODB_URI`
   - `MONGODB_DB`
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `ADMIN_NAME`
   - `SESSION_TTL_DAYS`
   - `COOKIE_SECURE=true`
   - `TRUST_PROXY=true`
5. Redeploy setelah environment variable diperbarui.

MongoDB Atlas mempunyai integrasi native dengan Vercel yang dapat mengisi `MONGODB_URI` secara otomatis. Lihat panduan resmi MongoDB: https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/

## Migrasi dari SQLite lama

Versi ini memulai database MongoDB baru dan melakukan seed admin + katalog saat pertama kali terhubung. File SQLite lama tidak otomatis dibaca.

Bila project sebelumnya sudah berisi transaksi penting di SQLite, lakukan migrasi data terencana sebelum production agar ID, user, rental, stok, dan session dapat dipetakan dengan benar. Session lama sebaiknya tidak dimigrasikan demi keamanan.

## Security notes

- Gunakan password admin production minimal 12 karakter dan unik.
- Jangan pernah mengirim `MONGODB_URI`, password database, atau token rahasia ke chat.
- Batasi hak database user ke database aplikasi yang diperlukan.
- Gunakan HTTPS di production.
- Rotasi kredensial database bila pernah terpapar.
- Session otomatis kedaluwarsa dengan TTL index MongoDB.
