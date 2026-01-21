FG2026 - Family Gathering (REAL)
================================

Isi paket ZIP ini:
- index.html -> Aplikasi Peserta (absensi + rundown + pemenang doorprize)
- admin.html -> Admin Panel (role ADMIN)
- doorprize.html -> Aplikasi Doorprize (role OPERATOR/ADMIN)
- rundown.html -> Aplikasi Rundown (role OPERATOR/ADMIN)
- backend/Code.gs + backend/appsscript.json -> Google Apps Script backend

KONSEP DATABASE (1 Google Sheet)
--------------------------------
Semua data ada di 1 file spreadsheet dengan tab:
- participants
- attendance
- events
- current_event
- doorprize_items
- doorprize_draws
- panel_users
- panel_sessions
- logs

LANGKAH SETUP CEPAT
-------------------
1) Buat Google Spreadsheet baru -> copy Spreadsheet ID
2) Buat Google Apps Script project baru (standalone)
3) Paste backend/Code.gs ke Code.gs di GAS
4) Paste backend/appsscript.json menjadi manifest project (Project Settings -> Show appsscript.json)
5) Di Code.gs ganti:
   const SPREADSHEET_ID = 'PASTE_SPREADSHEET_ID_HERE';
6) Jalankan fungsi setup() sekali (Authorize). Ini akan:
   - membuat semua sheet + header
   - mengisi contoh data peserta, rundown, dan doorprize
   - membuat user panel default

USER DEFAULT
------------
Admin:
- username: admin
- password: admin123

Operator:
- username: operator
- password: operator123

(Disarankan langsung ganti password via Admin Panel tab "User Panel")

7) Deploy -> New deployment -> Web app
   - Execute as: Me
   - Who has access: Anyone
   Salin URL Web App (akhirnya /exec)

8) Buka file config.js (frontend) lalu isi:
   AppConfig.api.url = 'PASTE_YOUR_GAS_WEBAPP_URL_HERE'

9) Host frontend:
   - Bisa pakai GitHub Pages / Netlify / Hosting internal
   - Jika tes lokal, gunakan http:// (XAMPP/Live Server). Jangan buka via file:/// karena fetch bisa diblok.

CATATAN DOORPRIZE
-----------------
- Yang diundi hanya peserta dengan position = "Staff" (case-insensitive mengandung kata "staff")
- Pemenang yang pernah muncul (meskipun dihapus) tidak akan ikut undian doorprize berikutnya.
- Tombol "Hapus & Acak" akan:
  (1) mengubah status pemenang menjadi NO_SHOW
  (2) otomatis membuat pengganti (jika stok prize masih ada dan peserta masih tersedia)
- Pemenang yang "Diambil" akan status TAKEN.

CATATAN RUNDOWN
---------------
- Operator memilih event -> otomatis tampil di aplikasi user (polling 5 detik)

TROUBLESHOOT
------------
- Jika error CORS/405: pastikan fetch memakai POST form-urlencoded (sudah), dan URL web app benar.
- Jika "API URL belum diisi": pastikan config.js sudah diisi.
- Jika "Access denied": pastikan user role sesuai.

