# Trip Tracker (Frontend + GAS Backend)

Aplikasi web untuk memantau perjalanan (rombongan besar/individu) yang bisa dipakai ulang untuk:
- Family Gathering
- Kedatangan peserta Magang/Training/KLP1
- Perjalanan karyawan antar lokasi (A -> B)

## 1) Setup Backend (Google Apps Script)
1. Buat project GAS baru.
2. Salin seluruh isi `Code.gs` ke editor GAS.
3. Pastikan `CONFIG.SHEET_ID` mengarah ke Spreadsheet Anda.
4. Jalankan fungsi `initializeSheets()` sekali dari editor untuk membuat header sheet.
5. Deploy: **Deploy > New deployment > Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Catat URL Web App.

> Penting: untuk frontend, gunakan URL **script.googleusercontent.com** (bukan script.google.com) agar tidak kena CORS.

## 2) Setup Frontend
1. Buka file `js/core/api.js`
2. Isi:
   ```js
   export const API = { url: 'PASTE_YOUR_GAS_WEBAPP_URL_HERE' };
   ```
3. Hosting:
   - Bisa via GitHub Pages / hosting internal / file server.

## 3) Akun awal
Jika sheet `Users` masih kosong, backend otomatis membuat 1 akun admin:
- NIK: `ADM001`
- Password: `user123`

Segera ubah password via **Admin Panel > Ganti Password**.

## 4) Konsep Data
- `Settings`: judul aplikasi, nama kegiatan, subtitle, activeTripId.
- `Trips`: daftar kegiatan (TripId) agar bisa dipakai ulang.
- `Participants`: peserta (kategori/relasi bebas: staff/istri/anak/peserta/karyawan/...).
- `Vehicles`: kendaraan (TripId, kapasitas, barcode opsional).
- `Arrivals`: log konfirmasi kedatangan.

## 5) Tips
- Untuk tracking lokasi kendaraan, driver/petugas cukup login, scan / input kode kendaraan, lalu aplikasi bisa update lokasi menggunakan GPS (fitur tambahan dapat ditambahkan).

