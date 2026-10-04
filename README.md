# Summit Base — Fullstack Release

Versi ini mengubah Summit Base dari prototype `localStorage` menjadi website fullstack dengan backend Node.js dan database SQLite.

## Fitur utama

- Katalog alat dibaca dari database.
- Admin dapat menambah, mengedit, mengaktifkan/menonaktifkan alat.
- Stok tersimpan di database dan berkurang otomatis saat transaksi dibuat.
- Stok kembali otomatis saat transaksi diubah menjadi `Dikembalikan`.
- Customer membuat akun dengan nama, email, password, dan nomor telepon.
- Dari setiap produk, customer langsung masuk ke form pembuatan akun. Tidak ada sistem keranjang.
- Bisa menyewa beberapa jenis alat sekaligus.
- Tiap alat punya kontrol `− / jumlah / +`.
- Batas jumlah mengikuti stok.
- Total harga dan total unit diperbarui real-time.
- Customer bisa melihat riwayat sewanya.
- Admin melihat transaksi, statistik, status, dan dapat mencetak struk thermal 58 mm.
- Admin dapat mengelola akun admin.
- Password disimpan dengan `scrypt`, bukan plaintext.
- Session memakai cookie HttpOnly + token acak yang hanya disimpan dalam bentuk hash di database.
- State-changing request dilindungi pengecekan origin dan cookie SameSite.
- Security headers dan CSP aktif.
- Tidak memakai dependency runtime eksternal; backend memakai Node.js 22 + SQLite bawaan Node.

## Deploy production

Panduan lengkap VPS + domain + HTTPS + environment + systemd + Caddy ada di `DEPLOY-PRODUCTION.md`.

## Menjalankan lokal

Gunakan Node.js 22.16+.

```bash
copy .env.example .env
node server.js
```

Windows PowerShell:

```powershell
$env:ADMIN_EMAIL="admin@summitbase.local"
$env:ADMIN_PASSWORD="Admin!ChangeMe123"
$env:ADMIN_NAME="Summit Base Admin"
node server.js
```

Buka:

- Website: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin.html`

Akun admin lokal mengikuti environment `ADMIN_EMAIL` dan `ADMIN_PASSWORD`.

Untuk production, **wajib mengganti password admin** dengan password panjang dan unik.

## Database

Database otomatis dibuat di:

`data/summit-base.sqlite`

Tabel utama:

- `users`
- `admin_users`
- `sessions`
- `catalog`
- `rentals`
- `rental_items`

Backup paling sederhana adalah menyalin file SQLite tersebut saat server berhenti atau setelah membuat backup database yang konsisten.

## Deploy

### VPS / server biasa

1. Upload folder project.
2. Set environment:
   - `NODE_ENV=production`
   - `ADMIN_EMAIL=...`
   - `ADMIN_PASSWORD=...`
   - `COOKIE_SECURE=true`
3. Jalankan:
   `node server.js`
4. Gunakan reverse proxy seperti Nginx/Caddy untuk HTTPS.
5. Arahkan domain ke reverse proxy tersebut.
6. Pastikan folder `data/` dapat ditulis oleh proses Node.

### Docker

```bash
docker build -t summit-base .
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e ADMIN_EMAIL="admin@domainanda.com" \
  -e ADMIN_PASSWORD="PasswordProduksiYangKuat!" \
  -e COOKIE_SECURE=true \
  -v summit_base_data:/app/data \
  summit-base
```

## Catatan produksi

SQLite cocok untuk aplikasi rental skala kecil-menengah pada satu server. Untuk trafik besar atau multi-server, database sebaiknya dipindahkan ke PostgreSQL dan penyimpanan foto ke object storage.

Sebelum rilis publik:
- aktifkan HTTPS,
- gunakan password admin unik,
- backup database berkala,
- batasi akses server hanya ke port web,
- jangan commit `.env` ke Git,
- lakukan uji transaksi dan pengembalian sebelum go-live.


## Perbaikan Admin Modal
Modal Tambah Admin dan Tambah/Edit Alat sekarang dapat ditutup lewat tombol X/Batal, klik area luar modal, atau tombol Escape. Tombol tutup diberi `type="button"` agar tidak memicu submit form.


## Model akun admin

Ada **1 akun DEFAULT ADMIN** saat instalasi pertama. Kredensialnya berasal dari `ADMIN_EMAIL` dan `ADMIN_PASSWORD` di `.env`.

Hanya DEFAULT ADMIN yang boleh:
- membuat akun admin baru,
- menonaktifkan/mengaktifkan admin lain,
- melihat daftar akun admin.

Akun admin baru otomatis menjadi admin biasa dan tidak dapat membuat akun admin berikutnya. DEFAULT ADMIN dilindungi dan tidak dapat dinonaktifkan melalui menu tersebut.


## Default Admin

Instalasi pertama membuat **1 akun DEFAULT ADMIN** dari `.env`:

```text
Email: ADMIN_EMAIL
Password: ADMIN_PASSWORD
```

Dengan konfigurasi contoh:

```text
admin@summitbase.local
Admin!ChangeMe123
```

Hanya DEFAULT ADMIN yang dapat membuka menu **Admin**, membuat akun admin baru, dan mengaktifkan/menonaktifkan admin lain. Admin baru otomatis menjadi `admin` biasa dan tidak dapat membuat admin berikutnya.

DEFAULT ADMIN dilindungi dari penonaktifan melalui menu admin.

Untuk database lama, aplikasi melakukan migrasi `is_default` otomatis dan menetapkan satu akun sebagai DEFAULT ADMIN.


## Ganti Password DEFAULT ADMIN

Di panel admin, tab **Keamanan** hanya terlihat untuk DEFAULT ADMIN.

Alurnya:
1. Masukkan **password lama**.
2. Masukkan password baru minimal 8 karakter.
3. Ulangi password baru.
4. Server memverifikasi password lama menggunakan hash yang tersimpan.
5. Jika benar, password baru disimpan sebagai hash baru.
6. Jika password lama salah, perubahan ditolak dan password tidak berubah.
7. Password baru harus berbeda dari password lama.
8. Session admin lain untuk akun tersebut dicabut; session saat ini diterbitkan ulang.

Endpoint backend juga memaksa akses hanya dari DEFAULT ADMIN, jadi verifikasi tidak hanya bergantung pada JavaScript di browser.


## Admin initial view fix

Modal Tambah Admin dan modal katalog tidak lagi tampil otomatis ketika `admin.html` dibuka. Semua elemen `[hidden]` dipaksa tetap tersembunyi sehingga dashboard/login/modal tidak saling menimpa aturan CSS.


## Halaman Customer Khusus

Customer yang sudah login otomatis diarahkan ke `customer.html`, sehingga area customer tidak lagi memakai tampilan landing page utama.

Di halaman customer tersedia:
- Pesanan aktif dan riwayat.
- Tombol **Tambah alat sewa** untuk membuat pesanan baru tanpa kembali ke landing page.
- Pemilihan beberapa jenis alat sekaligus.
- Kontrol jumlah unit `− / jumlah / +` dengan batas stok.
- Tombol **Perpanjang durasi** pada sewaan aktif.
- Pilihan perpanjangan 1, 3, 7, atau 14 hari.
- Server menghitung biaya tambahan dan tanggal kembali baru.
- Pesanan yang sudah `Dikembalikan` tidak dapat diperpanjang.


## Alur persetujuan admin

- Customer baru tidak langsung mendapatkan session setelah mendaftar.
- Akun baru berstatus `pending`.
- Pesanan pertama juga berstatus `pending`.
- Admin harus menyetujui akun terlebih dahulu.
- Admin kemudian menyetujui pesanan.
- Stok baru berkurang saat pesanan disetujui.
- Sebelum akun disetujui, login customer ditolak.
- Customer yang sudah disetujui dapat membuat pesanan tambahan, tetapi pesanan baru tetap menunggu persetujuan admin.
- Perpanjangan hanya dapat dilakukan pada pesanan yang sudah disetujui.


## Persetujuan sebelum akun/customer aktif

Setiap pendaftaran customer baru dan setiap permintaan sewa baru masuk sebagai `Menunggu persetujuan`.

Proses:
1. Customer mengisi pendaftaran dan permintaan sewa.
2. Server membuat akun + pesanan berstatus `pending`, tanpa membuat session customer.
3. Customer tidak diarahkan ke halaman `customer.html`.
4. Admin menyetujui akun.
5. Admin menyetujui pesanan.
6. Saat pesanan disetujui, stok dikurangi secara atomik.
7. Customer baru dapat login setelah akun disetujui.
8. Pesanan tambahan dari customer yang sudah aktif tetap menunggu persetujuan admin.


## Status approval di dashboard customer

Dashboard customer menampilkan status akun secara jelas:
- Menunggu persetujuan
- Disetujui
- Ditolak

Untuk penolakan akun, alasan admin disimpan di database dan ditampilkan pada halaman status customer.

Setiap pesanan juga menampilkan status persetujuan dan alasan penolakan admin bila ada. Akun pending/rejected dapat login untuk melihat halaman status tanpa mendapatkan fitur sewa. Akun approved mendapatkan dashboard customer penuh.


## Lokasi & Rating

Halaman utama sekarang memiliki menu **Lokasi** dengan:
- Google Maps Summit Base yang ditampilkan langsung dalam halaman.
- Tombol **Buka Google Maps** menggunakan link lokasi yang diberikan.
- Rating **5.0 / 5** dari **18 ulasan**.
- Alamat dan nomor telepon lokasi.
- Tampilan responsive untuk mobile.


## Cara Sewa — Modern & Responsive

Bagian Cara Sewa di halaman utama telah diperbarui menjadi panduan 6 langkah yang menjelaskan alur dari pemilihan alat, pengaturan jumlah/tanggal, pembuatan akun, persetujuan admin, pengelolaan sewaan, hingga persiapan sebelum berangkat.

Layout:
- Desktop: 2 kolom
- Tablet/mobile: 1 kolom
- Kartu langkah, tip, dan catatan persetujuan dibuat responsive.

## Perpanjangan sewa

Perpanjangan sewa sekarang menjadi **permintaan yang wajib disetujui admin**. Saat customer memilih +1/+3/+7/+14 hari, sistem hanya membuat permintaan perpanjangan dan tidak mengubah tanggal kembali maupun total transaksi sampai admin menekan **Setujui perpanjangan**. Penolakan wajib memakai alasan dan alasan tersebut ditampilkan di Customer Area.

Alur: Customer ajukan perpanjangan → status menunggu → Admin setujui/tolak → jika disetujui tanggal kembali, durasi, dan total diperbarui.

## Admin UI FIX terbaru
- Semua field password di area admin memiliki tombol **Tampilkan / Sembunyikan**.
- Tombol **Refresh** admin sudah diperbaiki dengan state loading dan penanganan error.
- Jika sesi admin sudah kedaluwarsa saat refresh, dashboard kembali ke halaman login dengan pesan yang jelas.
