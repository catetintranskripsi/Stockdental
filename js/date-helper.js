// ============================================
// Percakapan [Format Tanggal DDMMYYYY] - DATE HELPER
// Dipakai bareng oleh app.js, foto.js, suara.js untuk parse & validasi
// input tanggal kedaluwarsa yang diketik manual (DDMMYYYY), tanpa
// UI kalender bawaan browser (dirasa ribet oleh pengguna).
//
// Cara pakai:
//   parseDDMMYYYY('15082028') -> { valid: true, isoDate: '2028-08-15' }
//   parseDDMMYYYY('3182028')  -> { valid: false, error: 'Format tanggal harus 8 digit...' }
//   parseDDMMYYYY('')         -> { valid: true, isoDate: null } (kosong = opsional, boleh)
// ============================================

function parseDDMMYYYY(input) {
  const trimmed = (input || '').trim();

  // Kosong = valid (field ini opsional di semua form)
  if (trimmed === '') {
    return { valid: true, isoDate: null };
  }

  // Harus persis 8 digit angka
  if (!/^\d{8}$/.test(trimmed)) {
    return { valid: false, error: 'Format tanggal harus 8 digit: DDMMYYYY (contoh: 15082028).' };
  }

  const day = parseInt(trimmed.substring(0, 2), 10);
  const month = parseInt(trimmed.substring(2, 4), 10);
  const year = parseInt(trimmed.substring(4, 8), 10);

  if (month < 1 || month > 12) {
    return { valid: false, error: 'Bulan tidak valid (harus 01-12).' };
  }
  if (day < 1 || day > 31) {
    return { valid: false, error: 'Tanggal tidak valid (harus 01-31).' };
  }
  if (year < 2000 || year > 2100) {
    return { valid: false, error: 'Tahun tidak valid (contoh: 2028, 4 digit).' };
  }

  // Cek tanggal beneran ada (misal 31 Februari harus ditolak)
  const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dateObj = new Date(isoDate + 'T00:00:00');
  const isRealDate = dateObj.getFullYear() === year &&
                      dateObj.getMonth() + 1 === month &&
                      dateObj.getDate() === day;

  if (!isRealDate) {
    return { valid: false, error: 'Tanggal tidak ada di kalender (cek lagi tanggal/bulannya).' };
  }

  return { valid: true, isoDate: isoDate };
}

// Kebalikannya: dari ISO date (yang tersimpan di database / dikembalikan
// Supabase) jadi teks DDMMYYYY (untuk ditampilkan lagi ke input, misal
// saat foto.js/suara.js mengisi ulang field dari hasil ekstraksi AI).
function formatToDDMMYYYY(isoDate) {
  if (!isoDate) return '';
  const parts = isoDate.split('-'); // ['2028', '08', '15']
  if (parts.length !== 3) return '';
  return parts[2] + parts[1] + parts[0]; // '15082028'
}
