// ============================================
// AUTH CHECK - Dipakai di inventaris.html & history.html
// Cek status login, tampilkan/sembunyikan halaman sesuai
//
// Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - TAMBAH:
// panggil checkClinicAccessAndRenderBanner() setelah CURRENT_CLINIC_ID
// terisi. Fungsi itu (beserta variabel CLINIC_LOCKED,
// LAST_KNOWN_CLINIC_ACCESS, renderClinicLockedBanner) sekarang tinggal
// di file TERPISAH js/clinic-access.js -- supaya bisa dipakai bareng
// oleh app.js (index.html/foto.html/suara.html) tanpa duplikasi kode
// atau bentrok nama variabel. WAJIB tambahkan
// <script src="js/clinic-access.js"></script> SEBELUM script ini
// dimuat di HTML, atau checkClinicAccessAndRenderBanner tidak akan
// dikenali. Juga perbaiki onPageReady() yang sebelumnya dipanggil
// tanpa await (potensi race condition serupa P8).
// ============================================

let CURRENT_CLINIC_ID = null;
let CURRENT_USER_ID = null;

const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');
const bottomNav = document.getElementById('bottomNav');
const logoutBtn = document.getElementById('logoutBtn');

async function checkAuthAndInit() {
  const { data: { user } } = await supabaseClient.auth.getUser();

  if (!user) {
    // Belum login, tampilkan pesan & sembunyikan app
    authContainer.style.display = 'block';
    appContainer.style.display = 'none';
    bottomNav.style.display = 'none';
    return;
  }

  CURRENT_USER_ID = user.id;

  const { data: userRow, error } = await supabaseClient
    .from('users')
    .select('clinic_id')
    .eq('id', user.id)
    .single();

  if (error || !userRow) {
    console.error('Gagal ambil data klinik:', error);
    authContainer.style.display = 'block';
    appContainer.style.display = 'none';
    bottomNav.style.display = 'none';
    return;
  }

  CURRENT_CLINIC_ID = userRow.clinic_id;

  // Tampilkan app, sembunyikan pesan login
  authContainer.style.display = 'none';
  appContainer.style.display = 'block';
  bottomNav.style.display = 'flex';

  // Cek status akses klinik (locked kalau expired + jumlah barang > batas free)
  // Fungsi ini didefinisikan di js/clinic-access.js
  await checkClinicAccessAndRenderBanner();

  // Panggil fungsi init khusus halaman (didefinisikan di inventaris.js / history.js)
  if (typeof onPageReady === 'function') {
    await onPageReady();
  }
}

logoutBtn.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
});

// Jalankan saat halaman selesai load
checkAuthAndInit();
