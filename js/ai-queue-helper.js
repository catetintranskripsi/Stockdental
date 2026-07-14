// Percakapan [BARU] - SUBSCRIPTION & QUOTA: Helper polling antrian
// Copy-paste ini ke: js/ai-queue-helper.js (file baru)
// Lalu di foto.html dan suara.html, tambahkan sebelum foto.js/suara.js:
//   <script src="js/ai-queue-helper.js"></script>
//
// PENTING: file ini mengasumsikan variabel global `supabaseClient`
// sudah ada (dari supabase-client.js yang sudah dipakai di seluruh
// project — sama seperti yang dipakai smooth-responder untuk
// auth.getUser()). Kalau nama variabelnya beda di project Anda,
// sesuaikan referensinya di bawah.
//
// Cara pakai dari foto.js atau suara.html, GANTI pemanggilan lama
// yang langsung fetch ke smooth-responder, dengan ini:
//
//   const outcome = await submitAndWaitForAIResult({
//     clinicId: CURRENT_CLINIC_ID,
//     inputType: 'image',                 // atau 'audio'
//     mediaFields: {                      // field sesuai jenis input,
//       image_base64: '...',              // persis seperti body yang
//       mime_type: 'image/jpeg'           // dulu dikirim langsung
//     }
//   });
//
//   if (outcome.status === 'done') {
//     const items = outcome.result.items;  // array hasil ekstraksi,
//                                           // format SAMA seperti dulu
//     // lanjut render review card seperti biasa
//   } else if (outcome.status === 'quota_exceeded') {
//     renderQuotaBlockedCard(outcome);      // lihat 05_quota_ui.js
//   } else if (outcome.status === 'busy') {
//     renderQuotaBlockedCard(outcome);
//   } else if (outcome.status === 'error') {
//     renderQuotaBlockedCard(outcome);
//   }

const POLL_INTERVAL_MS = 2500;      // nanya tiap 2.5 detik
const MAX_WAIT_MS = 45000;          // nyerah setelah 45 detik

async function submitAndWaitForAIResult({ clinicId, inputType, mediaFields }) {
  // Ambil URL Edge Function & access token dari sesi yang sedang aktif
  // (pola yang sama seperti pemanggilan smooth-responder yang sudah ada)
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    return { status: 'error', message: 'Sesi login tidak ditemukan, silakan login ulang.' };
  }

  const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/smooth-responder`;
  // [SUPABASE_URL diasumsikan sudah jadi konstanta yang ada di
  //  supabase-client.js — samakan namanya kalau berbeda]

  // Langkah 1: submit ke Edge Function, masuk antrian
  let submitRes;
  try {
    submitRes = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        action: 'submit',
        clinic_id: clinicId,
        input_type: inputType,
        ...mediaFields
      })
    });
  } catch (networkErr) {
    return { status: 'error', message: 'Tidak bisa menghubungi server. Cek koneksi internet.' };
  }

  if (submitRes.status === 429) {
    const body = await submitRes.json();
    // reason: 'clinic_quota_exceeded' atau 'global_ceiling_reached'
    return { status: 'quota_exceeded', reason: body.reason, used: body.used, limit: body.limit };
  }

  if (!submitRes.ok) {
    const body = await submitRes.json().catch(() => ({}));
    return { status: 'error', message: body.error || 'Gagal menghubungi server AI.' };
  }

  const { queue_id } = await submitRes.json();

  // Langkah 2: polling status sampai selesai atau timeout
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);

    // Ikut "colek" penjaga pintu tiap polling, jaga-jaga baris ini
    // belum sempat diproses saat submit tadi (kasus antrian ramai)
    fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action: 'process_queue' })
    }).catch(() => {}); // fire-and-forget, tidak perlu tunggu

    const { data: statusData, error } = await supabaseClient
      .rpc('get_queue_status', { p_queue_id: queue_id });

    if (error) continue; // coba lagi di putaran berikutnya

    if (statusData.status === 'done') {
      return { status: 'done', result: statusData.result };
    }
    if (statusData.status === 'failed') {
      return { status: 'error', message: statusData.error_message || 'AI gagal memproses.' };
    }
    if (statusData.status === 'timeout') {
      return { status: 'busy' };
    }
    if (statusData.status === 'waiting' && typeof updateQueuePositionUI === 'function') {
      // opsional: tampilkan posisi antrian ke user kalau function ini ada
      updateQueuePositionUI(statusData.position);
    }
    // kalau 'processing', lanjut nunggu putaran berikutnya
  }

  // Sudah 45 detik, masih belum selesai juga dari sisi client
  return { status: 'busy' };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// Percakapan [X] - SUBSCRIPTION & QUOTA: UI kartu kuota habis / sedang ramai
// Copy-paste ini ke: js/ai-queue-helper.js (lanjutan file 04_polling.js),
// atau file terpisah js/quota-ui.js sesuai preferensi struktur folder Anda
//
// Dipanggil dari foto.js / suara.html setelah submitAndWaitForAIResult()
// mengembalikan status selain 'done'

function renderQuotaBlockedCard(outcome) {
  // outcome.status: 'quota_exceeded' | 'busy' | 'error'
  const container = document.getElementById('ai-result-area'); // [sesuaikan id container yang sudah ada]
  const isOwnerOrAdmin = CURRENT_USER_ROLE === 'owner' || CURRENT_USER_ROLE === 'admin';
  // [CURRENT_USER_ROLE diasumsikan sudah tersedia dari auth.js, sesuai
  //  struktur role-based access yang sudah ada]

  let title, message, showUpgradeButton;

  if (outcome.status === 'quota_exceeded' && outcome.reason === 'clinic_quota_exceeded') {
    title = 'Kuota AI Hari Ini Sudah Habis';
    message = `Klinik ini sudah pakai ${outcome.used}/${outcome.limit} kuota AI hari ini. Kuota baru lagi besok jam 00:00. Sementara itu, kamu tetap bisa catat lewat Input Manual — tidak pakai kuota sama sekali.`;
    showUpgradeButton = true;
  } else if (outcome.status === 'quota_exceeded' && outcome.reason === 'global_ceiling_reached') {
    title = 'AI Sedang Sangat Sibuk Hari Ini';
    message = 'Banyak klinik sedang pakai AI bersamaan hari ini. Coba lagi nanti, atau catat lewat Input Manual dulu.';
    showUpgradeButton = false;
  } else if (outcome.status === 'busy') {
    title = 'Penggunaan AI Sedang Ramai';
    message = 'Lagi banyak yang pakai AI barengan saat ini. Coba lagi sebentar lagi, atau catat lewat Input Manual dulu.';
    showUpgradeButton = false;
  } else {
    title = 'AI Sedang Bermasalah';
    message = outcome.message || 'Terjadi kesalahan saat memproses. Coba lagi, atau catat lewat Input Manual.';
    showUpgradeButton = false;
  }

  container.innerHTML = `
    <div class="quota-blocked-card">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="quota-blocked-actions">
        <button onclick="goToManualInput()" class="btn-primary">Input Manual</button>
        ${showUpgradeButton ? renderUpgradeButton(isOwnerOrAdmin) : ''}
      </div>
    </div>
  `;
}

function renderUpgradeButton(isOwnerOrAdmin) {
  if (isOwnerOrAdmin) {
    return `<button onclick="goToUpgradePage()" class="btn-secondary">Lihat Paket Premium</button>`;
  }
  return `<p class="quota-staff-note">Hubungi admin/owner klinik untuk upgrade ke Premium.</p>`;
}

function goToManualInput() {
  // [sesuaikan dengan navigasi sub-tab Manual | Foto | Suara yang sudah ada]
  switchInputTab('manual');
}

function goToUpgradePage() {
  // [sesuaikan dengan halaman upgrade/pembayaran — akan dibuat
  //  di sesi Payment Gateway Integration]
  window.location.href = 'upgrade.html';
}
