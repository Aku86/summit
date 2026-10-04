# Summit Base — Production Deployment (Vercel + MongoDB Atlas)

Versi ini menggunakan MongoDB Atlas sebagai database utama dan siap dipasang di Vercel.

## Arsitektur

```text
Domain / Browser
      ↓
    Vercel
      ↓
api/index.js → server.js
      ↓
MongoDB Atlas
```

## 1. MongoDB Atlas

Buat cluster MongoDB Atlas, buat database user khusus aplikasi, dan ambil connection string dari `Connect → Drivers → Node.js`.

Connection string asli bersifat rahasia. Jangan commit ke GitHub dan jangan kirim ke chat.

Database yang digunakan aplikasi default:

```text
summit_base
```

Collection dibuat otomatis oleh aplikasi:

- `users`
- `admin_users`
- `sessions`
- `catalog`
- `rentals`
- `rental_extensions`
- `counters`

## 2. Network Access Atlas

Deployment Vercel memakai IP dinamis. MongoDB mendokumentasikan bahwa koneksi deployment Vercel dapat membutuhkan allowlist `0.0.0.0/0`. Gunakan database user dengan hak akses minimum yang diperlukan dan password yang kuat.

## 3. Environment Variables Vercel

Masuk ke:

`Vercel → Project → Settings → Environment Variables`

Isi Production:

```text
MONGODB_URI=connection-string-rahasia
MONGODB_DB=summit_base
ADMIN_EMAIL=admin@domain-kamu.com
ADMIN_PASSWORD=password-admin-yang-kuat
ADMIN_NAME=Summit Base Admin
SESSION_TTL_DAYS=7
COOKIE_SECURE=true
TRUST_PROXY=true
```

Tidak perlu memasukkan nilai rahasia ke source code.

## 4. Deploy

Project sudah memiliki:

- `api/index.js` — entrypoint Vercel
- `vercel.json` — rewrite request ke entrypoint
- `server.js` — handler Node.js + MongoDB

Setelah environment variable selesai, lakukan **Redeploy**.

## 5. Seed pertama kali

Saat koneksi MongoDB pertama berhasil:

- index collection dibuat,
- satu DEFAULT ADMIN dibuat jika database belum berisi admin,
- katalog contoh dibuat jika catalog kosong.

Default admin mengikuti environment:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_NAME
```

## 6. Uji deployment

Buka:

```text
https://domain-kamu.vercel.app/api/health
```

Respons yang diharapkan:

```json
{
  "ok": true,
  "database": "mongodb"
}
```

Kemudian buka:

```text
https://domain-kamu.vercel.app/admin.html
```

Login menggunakan credential admin yang kamu masukkan ke Vercel.

## 7. Local development

Buat `.env` dari `.env.example` lalu isi URI MongoDB.

```bash
npm install
npm start
```

Buka:

```text
http://localhost:3000/
http://localhost:3000/admin.html
http://localhost:3000/customer.html
```

## 8. Backup MongoDB

Untuk deployment VPS, script `deploy/backup.sh` menggunakan `mongodump`. Pastikan MongoDB Database Tools tersedia dan `.env` hanya dibaca oleh server.

## 9. Keamanan

- Jangan commit `.env`.
- Jangan commit `MONGODB_URI` asli.
- Jangan kirim URI/password database ke chat.
- Gunakan database user khusus aplikasi.
- Gunakan HTTPS dan `COOKIE_SECURE=true` di production.
- Rotasi credential database bila pernah terpapar.
- Session menggunakan token acak yang hanya disimpan dalam bentuk hash.
- Session memiliki TTL index MongoDB.
