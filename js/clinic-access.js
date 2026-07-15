// ============================================
// Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - CLINIC ACCESS
// File terpisah, dipakai BERSAMA oleh 2 sistem auth yang berbeda:
//   - index.html/foto.html/suara.html -> pakai auth.js + app.js
//   - inventaris.html/history.html    -> pakai auth-check.js
// Dipisah ke file sendiri supaya tidak duplikasi kode dan tidak bentrok
// nama variabel/fungsi antara app.js dan auth-check.js (keduanya sama-sama
// punya const authContainer, CURRENT_CLINIC_ID, dst -- kalau logic ini
// ditaruh di salah satu file itu, gabung ke file lain akan error
// "Identifier has already been declared").
//
// Cara pakai: include <script src="js/clinic-access.js"></script> di
// SEMUA halaman (index.html, foto.html, suara.html, inventaris.html,
// history.html, ringkasan.html), lalu panggil
// checkClinicAccessAndRenderBanner() setelah CURRENT_CLINIC_ID terisi.
// ============================================

let CLINIC_LOCKED = false; // dicek oleh app.js/foto.js/suara.js sebelum submit
let LAST_KNOWN_CLINIC_ACCESS = null; // { locked, product_count, max_products, tier, status } - dipakai inventaris.js untuk badge total

async function checkClinicAccessAndRenderBanner() {
  if (!CURRENT_CLINIC_ID) {
    console.warn('checkClinicAccessAndRenderBanner dipanggil sebelum CURRENT_CLINIC_ID terisi.');
    return;
  }

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
