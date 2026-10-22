# Data Mess

Aplikasi sederhana untuk melihat jumlah dan daftar penghuni mess. Semua akun yang terdaftar memakai satu data bersama dan dapat mengunggah penggantinya. Masuk dengan akun Anda, unggah data mess dan manpower, cocokkan NIK, lalu saring perusahaan, departemen, subdepartemen, dan golongan. Form login langsung tampil saat belum masuk; data bersama terakhir dimuat otomatis setelah masuk.

## Penggunaan

1. Masuk dengan email dan kata sandi akun yang sudah dibuat. Jika sesi masih aktif, aplikasi langsung membuka data terakhir.
2. Pilih **Data mess** dan **Data manpower** (`.xlsx`, `.xls`, atau `.csv`).
3. Jika perlu, buka **Periksa sheet dan kolom**. Sistem mengenali judul kolom dan baris judul secara otomatis.
4. Klik **Tampilkan data**. Sistem mencocokkan NIK, mengklasifikasikan golongan, dan menyimpan kedua sumber secara otomatis. Data baru mengganti data bersama untuk seluruh pengguna. Jika penyimpanan atau penghapusan gagal, seluruh perubahan dibatalkan dan data lama tetap ada.
5. Pilih filter atau cari nama/NIK/jabatan. Total, jumlah per golongan, daftar, dan rekap semuanya mengikuti filter serta pencarian yang sama.
6. Buka **Lihat rekap perusahaan dan departemen** untuk melihat rekap silang golongan per perusahaan, departemen, atau subdepartemen.
7. Pilih **Unduh Excel** untuk mengekspor hasil yang sedang ditampilkan. Klik **Muat data terbaru** untuk mengambil pembaruan dari pengguna lain. Waktu pembaruan terakhir ditampilkan di atas filter. Menu **Penyimpanan** menampilkan impor terbaru.

Tidak ada grafik, navigasi halaman tambahan, atau data contoh yang otomatis dimuat. Template Excel tersedia melalui tombol **Unduh template Excel**.

## Aturan golongan otomatis

| Golongan | Kelompok jabatan |
| --- | --- |
| 1 | S1, P1 |
| 2 | S2, S3, P2, M1, M2 |
| 3 | S4, P3, P4, M3, M4 |
| 4 | P5, M5, M6, M7 |
| 5 | X1, X2, X3 |
| MT | Khusus P1 dengan jabatan Management Trainee |

Kode detail dibaca menurut kelompoknya, misalnya **S3.7 → S3 → golongan 2**. Angka setelah titik tidak menentukan golongan lama.

Aturan MT didahulukan. **P1.5 + Management Trainee, Production → MT**, sedangkan **P1.5 + Crawler Crane Operator → 1**. Huruf besar/kecil dan spasi berulang pada nama jabatan diabaikan. Nama dasar Management Trainee boleh diikuti koma, tanda pemisah, atau keterangan dalam kurung.

Kode yang tidak dikenal dan P1 tanpa nama jabatan tidak diklasifikasikan secara sembarang. Penghuni tetap masuk total, ditandai **Perlu diperiksa**, dan muncul dalam ekspor pemeriksaan. Nilai golongan lama yang sudah eksplisit berupa `1`–`5` atau `MT` juga diterima.

Kode asli, kelompok jabatan, nama jabatan, dan hasil klasifikasi disertakan dalam ekspor. Saat data tersimpan dibuka, sistem mengklasifikasikannya kembali dari kode asli dan nama jabatan menggunakan aturan ini. Data lama P1 tanpa jabatan akan memerlukan pemeriksaan.

## Format sumber dan hitungan

Data mess memerlukan **NIK**. Nama, lokasi mess, blok, serta kamar dapat dipetakan jika tersedia.

Manpower memerlukan **NIK, departemen, subdepartemen, kode golongan**, dan informasi perusahaan. Perusahaan dapat dipilih dari kolom atau diisi satu nama untuk seluruh file. Kolom **Jabatan** diperlukan untuk membedakan P1 biasa dan MT. Kolom seperti `GOL`, `Subdept`, `COST CENTER`, `JABATAN`, serta judul dengan spasi/baris baru dikenali. Bila Cost Center otomatis terpilih, pastikan nilainya memang perusahaan.

Satu sheet dipilih per sumber. Sheet bernama Data Mess dan Data Manpower otomatis dipilih sesuai jenis unggahan. Untuk beberapa perusahaan dalam satu impor, gabungkan referensi ke satu sheet dengan kolom perusahaan yang benar.

- Satu NIK unik dalam data mess dihitung satu penghuni. Baris manpower tanpa penghuni mess tidak menambah total.
- NIK dibaca sebagai teks. Awalan huruf dan nol dipertahankan; spasi dan karakter zero-width dibuang, serta huruf diseragamkan menjadi kapital.
- Gunakan format Teks di Excel untuk NIK. Digit atau nol yang sudah hilang di sumber tidak dapat direkonstruksi. NIK yang ditulis dalam notasi ilmiah ditolak untuk diperbaiki.
- Duplikasi mess tetap dihitung satu orang; seluruh lokasi dan kamar yang tercatat disertakan.
- Referensi manpower ganda dengan klasifikasi yang konsisten dapat dicocokkan. Perbedaan perusahaan, departemen, subdepartemen, kode asli, atau hasil klasifikasi membuat referensi ambigu. Perbedaan MT dan P1 biasa tidak dipilih secara sembarang.
- NIK tidak ditemukan atau referensi ambigu tetap masuk total dan kelompok **Belum teridentifikasi**. Memilih perusahaan tertentu hanya menampilkan orang yang teridentifikasi pada perusahaan itu.
- Jumlah golongan 1–5 dan MT mungkin lebih kecil dari total jika ada penghuni yang belum dapat diklasifikasikan; jumlah tersebut ditampilkan dalam pemberitahuan pemeriksaan.
- Baris NIK kosong atau notasi ilmiah ditampilkan sebagai baris ditolak dan tidak dihitung sebagai penghuni. Header berulang dilewati.
- Data tersimpan otomatis setelah **Tampilkan data** berhasil. Memilih file saja belum mengganti data tersimpan. Aplikasi mengingatkan sebelum menutup halaman jika file belum diproses.
- Kegagalan membaca atau menyimpan impor baru tidak menghapus data sebelumnya. Data kosong tidak boleh mengganti impor yang sudah tersimpan.
- Maksimal 20 MB dan 50.000 baris valid per sumber.

## Supabase

Koneksi ke proyek `jajtnydqgsmenbsjpllu` sudah menjadi konfigurasi bawaan di `dist/cloud.js`. Pengguna tidak perlu mengisi Project URL atau key, termasuk saat berganti perangkat. Konfigurasi manual dari versi lama di browser tidak digunakan.

Mengaktifkan data bersama pada proyek yang sudah dipakai:

1. Unggah versi web terbaru ke GitHub terlebih dahulu.
2. Buka proyek Supabase tersebut, pilih **SQL Editor → New query**.
3. Salin seluruh isi `supabase/schema.sql`, lalu klik **Run**. Skrip ini memperbarui tabel, aturan akses, serta fungsi penyimpanan dan mendaftarkan semua akun yang sudah ada.
4. Muat ulang web atau klik **Muat data terbaru**. Semua akun yang terdaftar melihat unggahan terakhir yang sama, termasuk jika dibuat oleh akun berbeda.

Skrip tidak menghapus data ketika dijalankan. Bila sebelumnya ada beberapa impor per akun, aplikasi menampilkan impor paling baru dari seluruh akun; impor baru berikutnya mengganti dan menghapus semua impor sebelumnya dalam satu transaksi. Menjalankan skrip ulang tetap dapat dilakukan; akun dengan `enabled=false` tetap nonaktif.

Tanpa pembaruan SQL ini, aplikasi tetap mendukung database lama dengan data per akun dan menampilkan pemberitahuan **Data bersama belum aktif**. Koneksi frontend saja tidak dapat mengubah izin database. Akses admin diperlukan untuk menjalankan pembaruan SQL.

Menambah akun berikutnya:

1. Buat akun melalui **Authentication → Users** dan pastikan email sudah dikonfirmasi bila diwajibkan.
2. Daftarkan akun yang baru dibuat dengan menjalankan SQL berikut melalui SQL Editor:

```sql
insert into public.mess_members (user_id)
select id from auth.users where email is not null
on conflict (user_id) do nothing;
```

Semua anggota mempunyai hak yang sama untuk melihat, memfilter, mengekspor, dan mengganti data bersama. Pendaftaran publik baru tidak otomatis memberi akses ke data mess. Pengelola dapat menonaktifkan anggota melalui `mess_members.enabled`.

Penggunaan melalui web:

1. Form login tersedia pada halaman awal. Masuk dengan email serta kata sandi akun yang sudah dibuat. Sesi akan dipulihkan saat halaman dibuka lagi.
2. Data terakhir otomatis dimuat. Pilih kedua file baru dan klik **Tampilkan data** untuk menggantinya.
3. Kedua sumber disimpan otomatis, lalu menggantikan data lama untuk semua akun. Menu **Penyimpanan** menampilkan satu impor terbaru, tanpa daftar riwayat.

Kedua sumber disimpan bersama sebagai satu snapshot JSONB melalui `replace_mess_data`. Fungsi database memeriksa keanggotaan, mengunci antrean unggahan, menyimpan impor baru, lalu menghapus impor sebelumnya. Semuanya berada dalam satu transaksi. Identitas pengunggah diambil dari sesi Supabase, sehingga tidak dapat dipalsukan melalui payload frontend. File Excel asli tidak diunggah; isi baris hasil pembacaan yang disimpan. Pencocokan dan statistik dihitung di browser.

Penggantian data bersama dari beberapa pengguna diurutkan oleh lock database; setelah berhasil, hanya tersisa satu impor. Jika salah satu langkah gagal, insert baru dan penghapusan sama-sama dibatalkan. Database lama sebelum migrasi masih menggunakan insert dan penghapusan terpisah, dengan tombol coba lagi bila penghapusan gagal.

RLS membatasi pembacaan data bersama kepada akun yang tercatat aktif di `mess_members`. Pengguna anonim dan akun tanpa akses tidak dapat membaca atau mengganti data. Penulisan langsung dari frontend ke tabel tidak diizinkan; penggantian wajib melalui fungsi transaksi. Kolom `user_id` hanya mencatat pengunggah. Menghapus akun pengunggah tidak menghapus data bersama. Pendaftaran publik tidak disediakan oleh antarmuka.

Publishable key tersedia di source frontend; akses data tetap dilindungi Auth dan RLS. Secret key dan service_role ditolak oleh validasi konfigurasi. Kata sandi tidak disimpan oleh aplikasi; Supabase SDK mengelola sesi. Saat keluar dari akun, data yang dibuka dari Supabase dibersihkan dari tampilan. Koneksi bawaan tetap tersedia sehingga pengguna berikutnya langsung mendapat formulir login.

## Menjalankan dan mengunggah ke GitHub

```sh
npm ci
npm run check
npm test
npm run build
python -m http.server 8080 --directory dist
```

Buka `http://localhost:8080`. Node.js 20+ diperlukan untuk pemeriksaan dan pengujian. Produksi menggunakan folder statis `dist/` tanpa server Node.js. Jalankan aplikasi melalui HTTP, karena aplikasi memakai JavaScript modules.

Unggah source ke repository GitHub milik Anda. Untuk GitHub Pages, aktifkan Settings → Pages → Source → **GitHub Actions**. Workflow `.github/workflows/pages.yml` memeriksa kode, menjalankan pengujian, dan menerbitkan `dist/` saat branch `main` diperbarui. Sesuaikan nama branch bila berbeda. Seluruh aset memakai path relatif untuk mendukung URL repository Pages.

Untuk unggah manual melalui halaman GitHub, unggah isi folder proyek sehingga `index.html` dan `dist/` berada di root repository. Aktifkan Settings → Pages → Source → **Deploy from a branch** → `main` → `/(root)`. Berkas `index.html` pada root mengarahkan pengunjung ke aplikasi di `dist/`.

Source berisi URL proyek dan publishable key Supabase, tanpa kata sandi, secret key, service_role, atau file karyawan. `.gitignore` mengecualikan Excel, CSV, dan file env. Perubahan skema Supabase dan pemasangan langsung ke repository GitHub memerlukan akses ke akun pemilik.

## Source dan pemeriksaan

| Berkas | Kegunaan |
| --- | --- |
| `dist/core.js` | Aturan jabatan, NIK, pencocokan, filter, dan rekap |
| `dist/workbook.js` | Pembacaan serta ekspor Excel dan template |
| `dist/cloud.js` | Supabase Auth dan penyimpanan data |
| `dist/app.js`, `index.html`, `styles.css` | Antarmuka satu halaman |
| `supabase/schema.sql` | Tabel, indeks, hak akses, dan RLS |
| `tests/` | Pengujian klasifikasi, Excel, DOM, klien Supabase, dan kebijakan database |

Pengujian mencakup semua kelompok jabatan yang disepakati, contoh S3.7/M1.5/S1.1/P1.4/S4.9, pengecualian MT, jabatan kosong, kode tidak dikenal, konflik referensi, hitungan duplikat, filter bertingkat, rekap, ekspor, login, pemulihan data bersama lintas akun, penggantian impor, rollback insert saat penghapusan gagal, larangan penulisan langsung, penolakan akun tanpa akses, dan kompatibilitas database lama. Pengujian database memakai PostgreSQL melalui PGlite; pengujian klien Supabase memakai SDK asli dengan respons API tiruan. Koneksi Supabase langsung memerlukan proyek dan akun nyata.

Lisensi pustaka dan font tercantum dalam `THIRD_PARTY_NOTICES.md`.
