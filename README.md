# Data Mess

Aplikasi satu halaman untuk melihat jumlah dan daftar penghuni mess. Unggah data mess dan manpower, cocokkan NIK, lalu saring perusahaan, departemen, subdepartemen, dan golongan. Halaman awal kosong sampai file diproses.

## Penggunaan

1. Pilih **Data mess** dan **Data manpower** (`.xlsx`, `.xls`, atau `.csv`).
2. Jika perlu, buka **Periksa sheet dan kolom**. Sistem mengenali judul kolom dan baris judul secara otomatis.
3. Klik **Tampilkan data**. Penghuni langsung mendapat golongan hasil klasifikasi.
4. Pilih filter atau cari nama/NIK/jabatan. Total, jumlah per golongan, daftar, dan rekap semuanya mengikuti filter serta pencarian yang sama.
5. Buka **Lihat rekap perusahaan dan departemen** untuk melihat rekap silang golongan per perusahaan, departemen, atau subdepartemen.
6. Pilih **Unduh Excel** untuk mengekspor hasil yang sedang ditampilkan.
7. Melalui **Penyimpanan**, hasil impor dapat disimpan ke Supabase dan dibuka kembali.

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
- Data lokal berada dalam memori halaman. Simpan ke Supabase sebelum memuat ulang atau menutup halaman. Aplikasi mengingatkan bila ada hasil impor yang belum disimpan.
- Maksimal 20 MB dan 50.000 baris valid per sumber.

## Supabase

1. Pilih proyek Supabase milik Anda.
2. Jalankan `supabase/schema.sql` melalui SQL Editor. Skema yang sudah digunakan versi sebelumnya tetap kompatibel; tidak perlu menghapus data.
3. Buat akun pengguna melalui Authentication → Users.
4. Buka **Penyimpanan → Pengaturan koneksi Supabase** pada aplikasi, isi Project URL dan publishable key/anon key, lalu simpan koneksi.
5. Masuk memakai akun Supabase tersebut. Setelah file diproses, isi nama data dan pilih **Simpan data aktif**.
6. Buka kembali melalui daftar **Data tersimpan**. Riwayat menampilkan 30 data terbaru.

Kedua sumber disimpan bersama sebagai satu snapshot JSONB dalam satu insert. File Excel asli tidak diunggah; isi baris hasil pembacaan yang disimpan. Pencocokan dan statistik dihitung di browser.

RLS membatasi snapshot kepada `auth.uid()` pemilik. Pengguna anonim tidak memiliki akses. Snapshot tidak diperbarui; simpan impor berikutnya sebagai data baru. Pengguna berbeda tidak saling berbagi snapshot. Pendaftaran publik tidak disediakan oleh antarmuka.

Public key disimpan di browser. Secret key dan service_role ditolak. Kata sandi tidak disimpan oleh aplikasi; Supabase SDK mengelola sesi. Saat keluar dari akun, data yang dibuka dari Supabase dibersihkan dari tampilan.

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

Source tidak berisi kredensial atau file karyawan. `.gitignore` mengecualikan Excel, CSV, dan file env. Proyek Supabase dan repository GitHub memerlukan koneksi ke akun pemilik untuk pemasangan langsung.

## Source dan pemeriksaan

| Berkas | Kegunaan |
| --- | --- |
| `dist/core.js` | Aturan jabatan, NIK, pencocokan, filter, dan rekap |
| `dist/workbook.js` | Pembacaan serta ekspor Excel dan template |
| `dist/cloud.js` | Supabase Auth dan penyimpanan data |
| `dist/app.js`, `index.html`, `styles.css` | Antarmuka satu halaman |
| `supabase/schema.sql` | Tabel, indeks, hak akses, dan RLS |
| `tests/` | Pengujian klasifikasi, Excel, DOM, klien Supabase, dan kebijakan database |

Pengujian mencakup semua kelompok jabatan yang disepakati, contoh S3.7/M1.5/S1.1/P1.4/S4.9, pengecualian MT, jabatan kosong, kode tidak dikenal, konflik referensi, hitungan duplikat, filter bertingkat, rekap, ekspor, dan antarmuka kosong. Pengujian database memakai PostgreSQL melalui PGlite; pengujian klien Supabase memakai SDK asli dengan respons API tiruan. Koneksi Supabase langsung memerlukan proyek dan akun nyata.

Lisensi pustaka dan font tercantum dalam `THIRD_PARTY_NOTICES.md`.
