// ============================================
// AUTH CHECK - Dipakai di inventaris.html & history.html
// Cek status login, tampilkan/sembunyikan halaman sesuai
//
// Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - TAMBAH:
// panggil check_clinic_access() setelah CURRENT_CLINIC_ID terisi.
// Kalau locked=true, tampilkan banner tetap di atas semua halaman
// dan set CLINIC_LOCKED=true supaya index.js/foto.js/suara.js bisa
// cek sebelum submit. Juga perbaiki onPageReady() yang sebelumnya
// dipanggil tanpa await (potensi race condition serupa P8).
// ============================================

let CURRENT_CLINIC_ID = null;
let CURRENT_USER_ID = null;
let CLINIC_LOCKED = false; // dicek oleh index.js/foto.js/suara.js sebelum submit
let LAST_KNOWN_CLINIC_ACCESS = null; // { locked, product_count, max_products, tier, status } - dipakai inventaris.js untuk badge total

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
  await checkClinicAccessAndRenderBanner();

  // Panggil fungsi init khusus halaman (didefinisikan di inventaris.js / history.js)
  if (typeof onPageReady === 'function') {
    await onPageReady();
  }
}

// ============================================
// Cek check_clinic_access() dan tampilkan/sembunyikan banner global.
// Dipanggil sekali tiap halaman load. Halaman Inventaris memanggil ulang
// fungsi ini sendiri setelah hapus produk (lihat inventaris.js).
// ============================================
async function checkClinicAccessAndRenderBanner() {
  const { data, error } = await supabaseClient.rpc('check_clinic_access', {
    p_clinic_id: CURRENT_CLINIC_ID
  });

  if (error) {
    console.error('Gagal cek status akses klinik:', error);
    CLINIC_LOCKED = false; // jangan sampai error jaringan mengunci app secara tidak sengaja
    return;
  }

  CLINIC_LOCKED = data.locked === true;
  LAST_KNOWN_CLINIC_ACCESS = data;
  renderClinicLockedBanner(data);
}

function renderClinicLockedBanner(accessData) {
  let banner = document.getElementById('clinicLockedBanner');

  if (!accessData.locked) {
    if (banner) banner.remove();
    return;
  }

  const kelebihan = accessData.product_count - accessData.max_products;

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'clinicLockedBanner';
    banner.style.cssText = 'position:sticky;top:0;z-index:999;background:#c62828;color:#fff;padding:12px 16px;font-size:14px;line-height:1.4;';
    document.body.prepend(banner);
  }

  banner.innerHTML = `
    <strong>Langganan Premium sudah berakhir.</strong>
    Klinik ini punya ${accessData.product_count} jenis barang, sedangkan batas gratis
    ${accessData.max_products}. Kurangi ${kelebihan} jenis barang di Inventaris,
    atau perpanjang Premium untuk pakai semua fitur lagi.
    <div style="margin-top:8px;">
      <button onclick="window.location.href='upgrade.html'" style="padding:6px 12px;border-radius:6px;border:none;background:#fff;color:#c62828;font-weight:600;margin-right:8px;">Lihat Paket Premium</button>
      <button onclick="window.location.href='inventaris.html'" style="padding:6px 12px;border-radius:6px;border:1px solid #fff;background:transparent;color:#fff;">Kurangi Barang</button>
    </div>
  `;
}

logoutBtn.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
});

// Jalankan saat halaman selesai load
checkAuthAndInit();
