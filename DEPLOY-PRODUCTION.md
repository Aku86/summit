# Summit Base — Panduan Deploy Produksi

Panduan ini ditujukan untuk paket **Summit Base Fullstack Release FINAL**.

Arsitektur yang direkomendasikan:

`Domain → HTTPS Caddy → Node.js 24 → SQLite`

Untuk proyek ini saya menyarankan **VPS Linux dengan persistent disk**, bukan hosting static-only. Aplikasi menyimpan database di `data/summit-base.sqlite`, sehingga filesystem yang persisten diperlukan.

## 1. Spesifikasi server minimal

Untuk awal:

- Ubuntu/Debian VPS
- 1 vCPU
- 1 GB RAM
- 10–20 GB storage
- IP publik
- Port 80 dan 443 dapat diakses dari internet

Gunakan Node.js **24 LTS**. Per Oktober 2026, Node 24 adalah cabang LTS dan Node 22 juga masih tercatat LTS di halaman release Node. Paket ini membutuhkan Node `>=22.16.0`, tetapi Node 24 LTS adalah pilihan yang lebih baru. `node:sqlite` tersedia mulai Node 22.5.0. citeturn697961search1turn615506search4turn697961search0

## 2. Upload project ke server

Contoh lokasi:

```bash
sudo mkdir -p /var/www/summit-base
sudo chown -R $USER:$USER /var/www/summit-base
```

Upload isi ZIP sehingga struktur akhirnya menjadi:

```text
/var/www/summit-base/
├── server.js
├── package.json
├── public/
├── data/
├── .env
└── deploy/
```

Jangan upload `.env.example` sebagai `.env` produksi tanpa mengubah isinya.

## 3. Install Node.js

Install Node.js 24 LTS dari sumber resmi Node. Salah satu cara yang didokumentasikan Node adalah menggunakan `nvm`.

Contoh:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
source ~/.nvm/nvm.sh

nvm install 24
nvm alias default 24

node -v
npm -v
```

Targetnya adalah Node 24.x LTS. Versi LTS 24.21.0 tercatat sebagai rilis Node 24 terbaru pada dokumentasi resmi yang saya cek. citeturn615506search2turn615506search4

### Catatan systemd

Jika Node dipasang melalui `nvm`, path Node biasanya bukan `/usr/bin/node`.

Cari path:

```bash
which node
```

Misalnya menghasilkan:

```text
/home/summit/.nvm/versions/node/v24.21.0/bin/node
```

Path tersebut harus dipakai pada `ExecStart` di service systemd. File contoh di `deploy/summit-base.service.example` menggunakan `/usr/bin/node` sebagai placeholder.

## 4. Buat environment variable produksi

Masuk ke folder:

```bash
cd /var/www/summit-base
cp .env.example .env
nano .env
```

Contoh:

```env
NODE_ENV=production
PORT=3000
DB_FILE=./data/summit-base.sqlite

ADMIN_EMAIL=admin@domainanda.com
ADMIN_PASSWORD=PasswordAdminProduksiYangSangatKuat!2026
ADMIN_NAME=Summit Base Admin
SESSION_TTL_DAYS=7
COOKIE_SECURE=true
```

### Aturan penting

`ADMIN_PASSWORD` harus password unik untuk produksi. Jangan menggunakan password demo.

`COOKIE_SECURE=true` digunakan ketika aplikasi diakses melalui HTTPS.

Jangan commit `.env` ke Git. Paket sudah memasukkan `.env` ke `.gitignore`.

## 5. Siapkan database

Tidak perlu membuat database secara manual.

Saat:

```bash
node server.js
```

server otomatis membuat:

```text
data/summit-base.sqlite
```

Tabel yang dibuat otomatis meliputi customer, admin, session, katalog, transaksi, dan item transaksi.

Pastikan folder database dapat ditulis proses Node:

```bash
sudo chown -R summit:summit /var/www/summit-base/data
sudo chmod 750 /var/www/summit-base/data
```

## 6. Tes server sebelum domain

Jalankan:

```bash
cd /var/www/summit-base
node server.js
```

Tes dari server:

```bash
curl http://127.0.0.1:3000/api/health
```

Hasil yang diharapkan:

```json
{"ok":true,...}
```

Lalu tes website:

```text
http://IP-SERVER:3000/
```

Kalau sudah tampil, hentikan:

```text
Ctrl + C
```

## 7. Buat user khusus aplikasi

Lebih aman menjalankan Node memakai user khusus, bukan root:

```bash
sudo adduser --system --group --home /var/www/summit-base summit
sudo chown -R summit:summit /var/www/summit-base
```

Jika folder sudah dibuat sebelumnya, pastikan user `summit` bisa membaca source dan menulis `data/`.

## 8. Jalankan Node sebagai service systemd

Salin template:

```bash
sudo cp deploy/summit-base.service.example /etc/systemd/system/summit-base.service
sudo nano /etc/systemd/system/summit-base.service
```

Pastikan:

```ini
WorkingDirectory=/var/www/summit-base
EnvironmentFile=/var/www/summit-base/.env
ExecStart=/PATH/KE/NODE server.js
```

Contoh:

```ini
ExecStart=/home/summit/.nvm/versions/node/v24.21.0/bin/node server.js
```

Kemudian:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now summit-base
```

Cek:

```bash
sudo systemctl status summit-base
```

Log:

```bash
sudo journalctl -u summit-base -f
```

Kalau statusnya:

```text
active (running)
```

backend sudah berjalan.

## 9. Konfigurasi firewall

Jika menggunakan UFW:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Port `3000` **tidak perlu dibuka ke internet** karena hanya Caddy yang akan meneruskan request ke `127.0.0.1:3000`.

## 10. Hubungkan domain

Misalnya domain:

```text
summitbase.id
```

dan IP VPS:

```text
203.0.113.10
```

Di DNS provider buat:

| Type | Name | Value |
|---|---|---|
| A | @ | 203.0.113.10 |
| A | www | 203.0.113.10 |

Jika VPS punya IPv6, tambahkan AAAA sesuai IPv6 server.

Tunggu DNS tersebar, lalu cek:

```bash
dig +short summitbase.id
dig +short www.summitbase.id
```

Keduanya harus mengarah ke IP VPS.

Caddy membutuhkan domain publik yang diarahkan ke server dan akses internet ke port 80/443 untuk automatic HTTPS. citeturn697961search2

## 11. Install Caddy

Dokumentasi resmi Caddy menyediakan paket untuk Debian/Ubuntu dan merekomendasikan service systemd untuk deployment production. citeturn615506search1

Contoh instalasi resmi:

```bash
sudo apt install --yes debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list

sudo apt update
sudo apt install caddy
```

Caddy otomatis dijalankan sebagai service setelah pemasangan paket Debian/Ubuntu. citeturn615506search1

## 12. Konfigurasi reverse proxy + HTTPS

Salin:

```bash
sudo cp deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Ubah menjadi:

```text
summitbase.id, www.summitbase.id {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3000
}
```

Validasi:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

Reload:

```bash
sudo systemctl reload caddy
```

Caddy menggunakan HTTPS otomatis ketika hostname publik diberikan; reverse proxy cukup diarahkan ke backend lokal seperti `127.0.0.1:3000`. citeturn697961search2turn697961search3

## 13. Hasil akhirnya

Setelah selesai:

```text
https://summitbase.id
```

Customer mengakses:

```text
https://summitbase.id/
```

Admin:

```text
https://summitbase.id/admin.html
```

Backend:

```text
127.0.0.1:3000
```

Backend tidak perlu diekspos langsung ke publik.

## 14. Backup database

Database produksi berada di:

```text
/var/www/summit-base/data/summit-base.sqlite
```

Paket menyediakan:

```text
deploy/backup.sh
```

Contoh:

```bash
sudo mkdir -p /var/backups/summit-base
sudo chown summit:summit /var/backups/summit-base

sudo -u summit APP_DIR=/var/www/summit-base BACKUP_DIR=/var/backups/summit-base \
  /var/www/summit-base/deploy/backup.sh
```

Script membuat backup SQLite dan menghapus backup lebih lama dari 14 hari.

Untuk production sebaiknya backup disalin juga ke storage/server lain. Backup hanya di VPS yang sama tidak cukup jika VPS rusak.

## 15. Jadwalkan backup otomatis

Edit cron:

```bash
sudo crontab -u summit -e
```

Contoh backup setiap hari jam 02:00:

```cron
0 2 * * * APP_DIR=/var/www/summit-base BACKUP_DIR=/var/backups/summit-base /var/www/summit-base/deploy/backup.sh >> /var/log/summit-base-backup.log 2>&1
```

## 16. Update aplikasi

Sebelum update:

```bash
sudo systemctl stop summit-base
sudo -u summit APP_DIR=/var/www/summit-base BACKUP_DIR=/var/backups/summit-base /var/www/summit-base/deploy/backup.sh
```

Upload versi aplikasi baru, lalu:

```bash
sudo chown -R summit:summit /var/www/summit-base
sudo systemctl start summit-base
sudo systemctl status summit-base
```

Cek:

```bash
curl https://summitbase.id/api/health
```

## 17. Checklist sebelum go-live

```text
[ ] Domain A record sudah menuju IP VPS
[ ] HTTPS aktif
[ ] Node 24 LTS terpasang
[ ] .env production sudah diisi
[ ] ADMIN_PASSWORD sudah diganti
[ ] COOKIE_SECURE=true
[ ] Database berhasil dibuat
[ ] systemd aktif
[ ] Caddy aktif
[ ] Port 3000 tidak terbuka publik
[ ] Register customer berhasil
[ ] Login customer berhasil
[ ] Multi-sewa berhasil
[ ] Tombol +/- jumlah unit bekerja
[ ] Total harga berubah sesuai jumlah dan hari
[ ] Stok berkurang saat transaksi
[ ] Stok kembali saat pengembalian
[ ] Tambah/edit/nonaktif alat berhasil
[ ] Foto alat berhasil
[ ] Login admin berhasil
[ ] Ganti password admin berhasil
[ ] Cetak struk berhasil
[ ] Backup database berhasil
[ ] Restore backup sudah pernah diuji
```

## 18. Catatan arsitektur dan batasan

Versi ini cocok untuk **satu aplikasi pada satu VPS** dengan trafik kecil sampai menengah.

SQLite menyederhanakan deployment karena tidak membutuhkan server database terpisah. Namun untuk multi-server, trafik tinggi, atau kebutuhan HA, sebaiknya database dimigrasikan ke PostgreSQL dan foto dipindahkan ke object storage.

Node `node:sqlite` tersedia pada Node 22.5+ dan pada dokumentasi Node 24.21.0 status API tersebut tercatat sebagai release candidate. Untuk deployment jangka panjang, pantau status API ini saat melakukan upgrade Node. citeturn697961search0

---

### Ringkasan cepat

Setelah DNS siap:

```bash
# 1. Jalankan aplikasi
sudo systemctl enable --now summit-base

# 2. Cek
sudo systemctl status summit-base

# 3. Install / aktifkan Caddy
sudo systemctl enable --now caddy

# 4. Validasi Caddy
sudo caddy validate --config /etc/caddy/Caddyfile

# 5. Reload
sudo systemctl reload caddy
```

Lalu buka:

```text
https://DOMAIN-ANDA
https://DOMAIN-ANDA/admin.html
```



## Customer page production

Pastikan file berikut ikut ter-deploy di folder `public/`:

```text
customer.html
customer.css
customer.js
```

Customer yang sudah memiliki session akan diarahkan ke `customer.html`. Jangan hanya meng-upload `index.html`; ketiga file customer tersebut diperlukan untuk halaman akun, tambah sewa, dan perpanjangan durasi.


## Google Maps di halaman utama

CSP backend sudah mengizinkan iframe Google Maps melalui `frame-src`. Tidak diperlukan Google Maps API key untuk konfigurasi embed berbasis query yang dipakai halaman utama.
