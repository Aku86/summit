# Summit Base — Release Checklist (MongoDB)

## Environment

- [ ] `NODE_ENV=production`
- [ ] `MONGODB_URI` sudah diisi di Vercel Environment Variables
- [ ] `MONGODB_DB=summit_base`
- [ ] `ADMIN_EMAIL` production sudah benar
- [ ] `ADMIN_PASSWORD` minimal 12 karakter dan unik
- [ ] `ADMIN_NAME` sudah benar
- [ ] `SESSION_TTL_DAYS` sudah sesuai
- [ ] `COOKIE_SECURE=true`
- [ ] `TRUST_PROXY=true`
- [ ] `.env` tidak masuk GitHub

## MongoDB Atlas

- [ ] Cluster tersedia
- [ ] Database user khusus aplikasi sudah dibuat
- [ ] Password database kuat dan tidak dikirim ke chat
- [ ] Network Access mengizinkan deployment Vercel
- [ ] Hak akses database user dibatasi sesuai kebutuhan
- [ ] Collection/index dapat dibuat oleh aplikasi saat pertama connect

## Application

- [ ] `npm install` berhasil
- [ ] `node server.js` berhasil pada local environment
- [ ] `/api/health` mengembalikan `database: mongodb`
- [ ] Katalog tampil
- [ ] Registrasi customer masuk sebagai pending
- [ ] Admin login berhasil
- [ ] Approval akun berhasil
- [ ] Approval rental mengurangi stok
- [ ] Pengembalian menambah stok
- [ ] Perpanjangan masuk sebagai pending dan berubah setelah approval admin
- [ ] Password default admin dapat diganti dengan verifikasi password lama
- [ ] Logout/re-login berhasil

## Vercel

- [ ] Repository GitHub sudah berisi versi MongoDB
- [ ] Environment Variables Production sudah tersimpan
- [ ] Redeploy dilakukan setelah environment variable berubah
- [ ] URL `/api/health` dapat diakses
- [ ] `/admin.html` dapat dibuka
- [ ] `/customer.html` dapat dibuka
- [ ] Asset CSS/JS tampil normal di production

## Backup

- [ ] Backup MongoDB terjadwal untuk deployment non-Vercel/VPS
- [ ] `mongodump`/prosedur backup diuji
- [ ] Session lama tidak dimigrasikan saat pemulihan credential
