# Upload Summit Base ke GitHub

Project ini sudah disiapkan agar aman dimasukkan ke repository GitHub dan menggunakan MongoDB Atlas sebagai database cloud.

## Yang sengaja TIDAK di-upload

- `.env`
- password database MongoDB
- connection string `MONGODB_URI` asli
- `node_modules/`
- file database lokal legacy apa pun

## Yang harus dibuat setelah clone

1. Salin `.env.example` menjadi `.env`.
2. Isi `MONGODB_URI` dan `MONGODB_DB` untuk local development.
3. Isi `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `ADMIN_NAME`.
4. Jalankan:

```bash
npm install
npm start
```

## Deploy ke Vercel

Jangan menaruh rahasia database di GitHub. Masukkan `MONGODB_URI` langsung ke Vercel → Settings → Environment Variables. Project sudah memiliki `api/index.js` dan `vercel.json` untuk menangani deployment Node.js.

MongoDB Atlas juga menyediakan integrasi native Vercel yang dapat mengisi `MONGODB_URI` pada environment project.
