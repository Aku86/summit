# Tutorial MongoDB Atlas — Summit Base

Dokumen ini menjelaskan cara membuat database MongoDB Atlas, menghubungkannya ke Summit Base, menjalankan project di komputer, lalu memasangnya ke Vercel.

> **Keamanan:** jangan pernah kirim `MONGODB_URI`, password database MongoDB, atau credential Vercel ke chat/GitHub. Simpan rahasia hanya di `.env` lokal atau Vercel Environment Variables.

## 1. Buat akun dan Project MongoDB Atlas

1. Buka https://www.mongodb.com/atlas
2. Login atau buat akun.
3. Buat/ pilih satu **Project** untuk Summit Base.
4. Buat satu cluster/database deployment.

Atlas menyediakan alur pembuatan cluster lalu koneksi dari aplikasi melalui connection string. Detail menu dapat berubah mengikuti tampilan Atlas saat ini. Referensi resmi: https://www.mongodb.com/docs/atlas/create-connect-deployments/

## 2. Buat database user untuk Summit Base

Di Atlas buka menu **Security → Database & Network Access** lalu bagian **Database Users**.

Buat user khusus aplikasi, misalnya:

```text
Username: summitbase-app
Password: buat password acak yang kuat
```

Untuk production, gunakan hak akses sekecil mungkin yang cukup untuk database aplikasi. Atlas mendukung pembatasan akses user ke cluster/resource tertentu. Referensi resmi: https://www.mongodb.com/docs/atlas/security-add-mongodb-users/

Simpan password user tersebut secara aman. **Jangan tempel password asli di file yang akan di-commit.**

## 3. Atur Network Access

Untuk testing dari komputer sendiri, tambahkan IP publik komputer kamu melalui **Network Access → IP Access List → Add My Current IP Address**.

Untuk deployment Vercel yang terhubung langsung ke Atlas, Vercel menggunakan IP dinamis. Dokumentasi integrasi MongoDB Atlas menyatakan akses IP perlu mengizinkan koneksi dari semua alamat (`0.0.0.0/0`) untuk pola koneksi tersebut.

Referensi resmi:
https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/

> Catatan keamanan: `0.0.0.0/0` memperluas asal IP yang boleh mencoba koneksi. Karena itu gunakan database user khusus aplikasi, password kuat, dan hak akses terbatas. Untuk arsitektur production yang lebih ketat, pertimbangkan private networking/private endpoint yang didukung Atlas.

## 4. Ambil Connection String

Di cluster Atlas:

```text
Connect
  → Drivers
  → Node.js
```

Salin connection string yang disediakan Atlas.

Bentuknya kira-kira:

```text
mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
```

Itu **hanya contoh bentuk**. Jangan gunakan contoh di atas sebagai credential.

Jika username/password mengandung karakter khusus seperti `$ : / ? # [ ] @`, karakter tersebut perlu di-percent-encode dalam connection string. Referensi resmi: https://www.mongodb.com/docs/manual/reference/connection-string-formats/

## 5. Siapkan project Summit Base di komputer

Pastikan Node.js sesuai dengan project, yaitu versi 22.16 atau lebih baru.

Buka CMD/PowerShell pada folder project, misalnya:

```cmd
cd C:\Users\user\Downloads\Summit-Base-GitHub-READY
```

Install dependency:

```cmd
npm install
```

Project ini menggunakan official MongoDB Node.js Driver.

## 6. Buat file `.env`

Duplikasi `.env.example` menjadi `.env`.

Contoh PowerShell:

```powershell
Copy-Item .env.example .env
```

Contoh CMD:

```cmd
copy .env.example .env
```

Lalu buka `.env` dan isi **credential asli milik kamu**:

```env
NODE_ENV=development
PORT=3000

MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=summit_base

ADMIN_EMAIL=admin@summitbase.local
ADMIN_PASSWORD=Admin!ChangeMe123
ADMIN_NAME=Summit Base Admin
SESSION_TTL_DAYS=7
COOKIE_SECURE=false
TRUST_PROXY=false
```

Jangan upload `.env` ke GitHub. File `.gitignore` project sudah disiapkan untuk mengabaikannya.

## 7. Jalankan Summit Base secara lokal

```cmd
npm start
```

Setelah berhasil, buka:

```text
Website : http://localhost:3000/
Customer: http://localhost:3000/customer.html
Admin   : http://localhost:3000/admin.html
Health  : http://localhost:3000/api/health
```

Saat server pertama kali terhubung ke MongoDB, backend akan:

- melakukan `ping` ke MongoDB;
- membuat index yang dibutuhkan;
- membuat satu **default admin** bila collection admin masih kosong;
- memilih default admin sesuai `ADMIN_EMAIL`, atau admin pertama bila sudah ada;
- membuat katalog awal bila collection `catalog` masih kosong.

Jadi kamu **tidak perlu membuat tabel SQL manual**.

## 8. Collection yang dipakai Summit Base

Database default:

```text
summit_base
```

Collection:

```text
users
admin_users
sessions
catalog
rentals
rental_extensions
counters
```

Gambaran fungsinya:

| Collection | Fungsi |
|---|---|
| `users` | akun customer, status approval, nomor telepon |
| `admin_users` | akun admin, role, status aktif, password hash |
| `sessions` | session login yang disimpan sebagai token hash |
| `catalog` | daftar alat, harga, stok, foto |
| `rentals` | transaksi sewa dan item-item alat |
| `rental_extensions` | permintaan perpanjangan dan approval |
| `counters` | nomor ID incremental aplikasi |

## 9. Cara melihat data di MongoDB Atlas

Di Atlas buka cluster → **Browse Collections** / **Collections**.

Pilih database:

```text
summit_base
```

Kemudian kamu dapat membuka collection seperti:

```text
users
admin_users
catalog
rentals
rental_extensions
sessions
```

Contoh data `catalog` yang dibuat otomatis terlihat secara konsep seperti:

```json
{
  "id": 1,
  "name": "Tenda 2–3 Orang",
  "category": "Camping",
  "icon": "⛺",
  "price": 25000,
  "stock": 5,
  "active": true,
  "photo": ""
}
```

Nilai aktual dapat berbeda karena data berubah lewat dashboard admin.

## 10. Cara kerja database saat customer menyewa

Alur di Summit Base:

```text
Customer daftar
      ↓
users dibuat dengan approvalStatus = pending
      ↓
Rental dibuat dengan approvalStatus = pending
      ↓
Admin menyetujui akun customer
      ↓
Admin menyetujui rental
      ↓
Stok catalog berkurang
      ↓
Rental aktif
      ↓
Saat dikembalikan → stok kembali
```

Permintaan perpanjangan masuk ke `rental_extensions` dan **tanggal/total rental baru berubah setelah admin menyetujui permintaan**.

## 11. Cara kerja admin default

Akun admin pertama mengikuti:

```env
ADMIN_EMAIL=...
ADMIN_PASSWORD=...
ADMIN_NAME=...
```

Backend menyimpan password dalam bentuk hash `scrypt`, bukan plaintext.

Default admin mempunyai hak untuk mengelola akun admin lainnya. Admin biasa tidak dapat membuat admin baru.

## 12. Deploy ke Vercel

Setelah local test berhasil:

1. Push project ke GitHub.
2. Hubungkan repository ke Vercel.
3. Buka **Vercel → Project → Settings → Environment Variables**.
4. Tambahkan variable berikut untuk Production:

```text
MONGODB_URI
MONGODB_DB
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_NAME
SESSION_TTL_DAYS
COOKIE_SECURE=true
TRUST_PROXY=true
```

Untuk `MONGODB_URI` isi connection string asli dari Atlas.
Untuk `ADMIN_PASSWORD` isi password admin production yang kuat.

Jangan masukkan credential itu ke source code.

Vercel menyimpan nilai environment variable di project environment dan inject ke function saat deployment. MongoDB juga menyediakan integrasi native Atlas ↔ Vercel yang dapat mengatur credential/environment secara otomatis. Referensi:
https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/

## 13. Redeploy setelah Environment Variable berubah

Setelah variable disimpan, lakukan deployment baru dari Vercel.

Jangan mengharapkan perubahan secret muncul pada deployment lama tanpa redeploy.

## 14. Tes setelah deploy

Buka domain Vercel dan coba:

```text
https://DOMAIN-KAMU.vercel.app/
```

Cek endpoint health:

```text
https://DOMAIN-KAMU.vercel.app/api/health
```

Kemudian test:

```text
1. Login admin
2. Buka katalog
3. Tambah/edit alat
4. Buat akun customer
5. Approve customer dari admin
6. Approve rental dari admin
7. Pastikan stok berkurang
8. Kembalikan rental
9. Pastikan stok kembali
10. Ajukan perpanjangan
11. Approve/reject perpanjangan
```

Jika `/api/health` gagal dan log Vercel menunjukkan `MongoServerSelectionError`, biasanya masalahnya ada pada `MONGODB_URI`, database user, password, atau Network Access Atlas.

## 15. Jangan lakukan ini

Jangan commit file:

```text
.env
```

Jangan memasukkan connection string asli ke:

```text
server.js
README.md
GitHub
frontend JavaScript
screenshot chat
```

Jangan menaruh `MONGODB_URI` di kode frontend karena frontend dapat dilihat pengunjung.

## 16. Jika password MongoDB berisi karakter khusus

Misalnya password database berisi:

```text
@ # $ / ?
```

Connection string dapat rusak bila karakter tersebut ditempel mentah. Gunakan percent-encoding pada username/password sesuai format connection string MongoDB.

## 17. Backup dan migrasi

Database MongoDB Atlas dapat dikelola dan dibackup sesuai tier/fitur Atlas yang kamu gunakan. Untuk migrasi atau backup manual, gunakan tool MongoDB seperti `mongodump`/`mongorestore` atau metode export/import yang sesuai environment.

Untuk project Summit Base, **session lama tidak perlu dipindahkan** saat migrasi database produksi; user dapat login kembali setelah deployment.

## 18. Checklist siap production

- [ ] MongoDB Atlas cluster sudah dibuat
- [ ] Database user aplikasi sudah dibuat
- [ ] Network Access sudah benar
- [ ] `MONGODB_URI` tidak ada di GitHub
- [ ] `MONGODB_URI` di Vercel sudah benar
- [ ] `MONGODB_DB=summit_base`
- [ ] `ADMIN_PASSWORD` production kuat dan minimal 12 karakter
- [ ] `COOKIE_SECURE=true`
- [ ] `TRUST_PROXY=true`
- [ ] `/api/health` berhasil
- [ ] Login admin berhasil
- [ ] Register customer berhasil
- [ ] Approval customer berhasil
- [ ] Approval rental berhasil
- [ ] Stok berkurang/kembali dengan benar
- [ ] Perpanjangan menunggu approval admin
- [ ] Password dan token rahasia tidak pernah dikirim ke chat

## Referensi resmi

- Atlas create/connect: https://www.mongodb.com/docs/atlas/create-connect-deployments/
- Atlas database users: https://www.mongodb.com/docs/atlas/security-add-mongodb-users/
- Atlas connection: https://www.mongodb.com/docs/atlas/connect-to-database-deployment/
- Atlas + Vercel: https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/
- MongoDB Node.js Driver: https://www.mongodb.com/docs/drivers/node/current/
