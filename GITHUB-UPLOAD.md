# Upload Summit Base ke GitHub

Project ini sudah disiapkan agar aman dimasukkan ke repository GitHub.

## Yang sengaja TIDAK di-upload
- `.env`
- database SQLite lokal (`data/*.sqlite`)
- `node_modules/`
- file runtime SQLite WAL/SHM

## Yang harus dibuat setelah clone
1. Salin `.env.example` menjadi `.env`.
2. Isi password/admin secret sesuai kebutuhan lokal.
3. Jalankan Node.js 22.16+.
4. Jalankan `npm start`.

## GitHub Desktop
1. Extract ZIP ini.
2. Buka GitHub Desktop.
3. `File -> Add local repository`.
4. Pilih folder `Summit-Base-GitHub-READY`.
5. Jika belum menjadi repository, pilih `Create a repository`.
6. Commit perubahan.
7. Klik `Publish repository`.

## Catatan deployment
Project saat ini menggunakan SQLite lokal. GitHub hanya menjadi tempat source code.
Untuk production di platform serverless seperti Vercel, database perlu dipindahkan ke database cloud/persistent.
