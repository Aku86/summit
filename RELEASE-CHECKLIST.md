# Summit Base — Release Checklist

## Wajib sebelum go-live

- [ ] Set `NODE_ENV=production`
- [ ] Set `ADMIN_EMAIL` ke email admin produksi
- [ ] Set `ADMIN_PASSWORD` minimal 12 karakter, unik
- [ ] Set `COOKIE_SECURE=true` dan gunakan HTTPS
- [ ] Backup `data/summit-base.sqlite`
- [ ] Uji register customer
- [ ] Uji multi-sewa dan stok
- [ ] Uji pengembalian barang
- [ ] Uji tambah/edit/nonaktif alat
- [ ] Uji cetak struk
- [ ] Uji login/logout admin
- [ ] Uji ganti password admin
- [ ] Pastikan `.env` tidak masuk Git
- [ ] Pasang reverse proxy + HTTPS
- [ ] Pasang process manager/service agar Node otomatis restart

## Catatan

Backend ini sengaja tanpa dependency npm runtime. Database menggunakan SQLite bawaan Node.js 22.16+.

Untuk skala besar atau multi-server, migrasikan database ke PostgreSQL dan foto ke object storage.


- [ ] Uji akun customer baru: status pending
- [ ] Uji login customer sebelum approval: ditolak
- [ ] Uji approve akun customer
- [ ] Uji approve pesanan
- [ ] Uji stok: berkurang hanya setelah approval pesanan
- [ ] Uji pesanan tambahan customer: pending
- [ ] Uji satu menu Keamanan saja


- [ ] Uji status akun pending/approved/rejected di customer
- [ ] Uji alasan penolakan akun tampil di customer
- [ ] Uji alasan penolakan pesanan tampil di customer
- [ ] Uji akun pending/rejected hanya mendapat halaman status


### Perpanjangan sewa
- Customer dapat mengajukan perpanjangan +1/+3/+7/+14 hari.
- Permintaan masuk sebagai pending dan tidak mengubah transaksi sebelum persetujuan.
- Admin dapat menyetujui atau menolak perpanjangan; penolakan wajib memakai alasan.
- Setelah disetujui, tanggal kembali, durasi, total, dan status transaksi diperbarui.
- Customer Area menampilkan status perpanjangan dengan layout mobile yang lebih rapih.

### Admin UI fix (4 Oct 2026)
- Password fields now have a persistent toggle button: **Tampilkan / Sembunyikan**.
- Added show/hide toggle to admin login, default-admin password change, and add-admin form.
- Admin **Refresh** now has a dedicated click handler, loading state, and visible error handling.
- If the admin session expires while refreshing, the UI returns to the login screen instead of failing silently.


## Latest UI Fix
- Customer Area mobile layout hardened for narrow/medium phone widths, including long email/name wrapping, cards, stats, history, modals, and buttons.
- Password show/hide controls are now present on customer registration and customer login, in addition to all existing admin password fields.
