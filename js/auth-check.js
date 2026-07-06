// ============================================
// AUTH CHECK - Dipakai di inventaris.html & history.html
// Cek status login, tampilkan/sembunyikan halaman sesuai
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

  // Panggil fungsi init khusus halaman (didefinisikan di inventaris.js / history.js)
  if (typeof onPageReady === 'function') {
    onPageReady();
  }
}

logoutBtn.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
});

// Jalankan saat halaman selesai load
checkAuthAndInit();
