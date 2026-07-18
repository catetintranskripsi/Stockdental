// ============================================
// AI VOICE INPUT (INPUT SUARA)
// Percakapan [BARU] - REKAM PER-SEGMEN + REVIEW BATCH
//
// Pola directurunkan dari foto.js:
// - Field hasil ekstraksi (nama, jumlah, satuan, kategori, expiry,
//   lokasi, batch_number, minimum_stock, jenis_transaksi) SAMA PERSIS.
// - Fungsi render card, edit per-field, dan simpan ke Supabase
//   (via RPC add_stock_lot / adjust_stock_opname) di-COPY APA ADANYA
//   dari foto.js, tidak dimodifikasi logic-nya.
//
// Beda utama dari foto.js: sumber datanya BUKAN 1 foto, tapi BEBERAPA
// segmen rekaman audio (1 segmen = 1 barang). User rekam satu barang,
// tap Selesai, ulangi untuk barang berikutnya. Semua segmen dikirim
// SEKALIGUS dalam 1 API call saat user tap "Proses Semua".
//
// Kenapa per-segmen (bukan 1 file panjang dengan pause/resume)?
// MediaRecorder.pause()/resume() tidak konsisten perilakunya di
// beberapa versi Chrome Android (bisa menghasilkan file dengan gap
// aneh). Start/stop biasa per segmen jauh lebih stabil, dan user bisa
// hapus 1 segmen tertentu kalau salah ngomong tanpa ulang dari awal.
//
// CATATAN: CURRENT_CLINIC_ID, CURRENT_USER_ID, supabaseClient
// sudah didefinisikan di auth-check.js dan supabase-client.js.
// File ini TIDAK boleh redeclare variabel itu.
// ============================================

// Percakapan [BARU] - SUBSCRIPTION & QUOTA: EDGE_FUNCTION_URL dihapus dari sini,
// karena pemanggilan Edge Function sekarang dilakukan lewat
// submitAndWaitForAIResult() di ai-queue-helper.js

// Batas aman per segmen & total, supaya kuota AI terkendali
// (durasi audio dihitung per detik oleh Gemini, beda dari foto yang harganya tetap per gambar)
const MAX_SEGMENT_SECONDS = 30;   // 1 segmen (1 barang) maks 30 detik bicara
const MAX_TOTAL_SEGMENTS = 15;    // maks 15 barang per sesi rekam, cukup untuk 1 sesi restock wajar

let mediaRecorder = null;
let currentChunks = [];
let recordedSegments = []; // array of { id, blob, mimeType, durationSeconds }
let recordTimerInterval = null;
let recordStartTime = null;
let isRecording = false;

let extractedItems = []; // array hasil ekstraksi yang sedang diedit user — SAMA seperti foto.js

// Percakapan [Perbaikan Dropdown Foto/Suara/Edit Inventaris] - daftar
// untuk autocomplete field Nama/Kategori/Lokasi, sama sumbernya dengan
// app.js dan foto.js (histori dari tabel products, plus starter list kategori).
let ALL_PRODUCT_NAMES = [];
let ALL_CATEGORIES = [];
let ALL_LOCATIONS = [];
let ALL_UNITS = [];
const STARTER_CATEGORIES = ['APD', 'BMHP', 'Obat', 'Alat Kesehatan', 'Bahan Tambal/Restorasi', 'Lainnya'];
const STARTER_UNITS = ['pcs', 'box', 'botol', 'tube', 'dus', 'pack', 'set', 'lembar'];

async function loadAutocompleteOptionsSuara() {
  const { data: products, error } = await supabaseClient
    .from('products')
    .select('name, category, storage_location, unit')
    .eq('clinic_id', CURRENT_CLINIC_ID);

  if (error) {
    console.error('Gagal load histori nama/kategori/lokasi/satuan:', error);
    return;
  }

  if (products) {
    ALL_PRODUCT_NAMES = uniqueMerge([], products.map(function(p) { return p.name; }).filter(Boolean));
    ALL_CATEGORIES = uniqueMerge(STARTER_CATEGORIES, products.map(function(p) { return p.category; }).filter(Boolean));
    ALL_LOCATIONS = uniqueMerge([], products.map(function(p) { return p.storage_location; }).filter(Boolean));
    ALL_UNITS = uniqueMerge(STARTER_UNITS, products.map(function(p) { return p.unit; }).filter(Boolean));
  }
}

// Elemen-elemen DOM
const micPermissionNotice = document.getElementById('micPermissionNotice');
const recordToggleBtn = document.getElementById('recordToggleBtn');
const recordIcon = document.getElementById('recordIcon');
const recordLabel = document.getElementById('recordLabel');
const recordTimer = document.getElementById('recordTimer');
const segmentsList = document.getElementById('segmentsList');
const segmentsEmptyHint = document.getElementById('segmentsEmptyHint');
const processAllBtn = document.getElementById('processAllBtn');
const recordStatus = document.getElementById('recordStatus');

const resultSection = document.getElementById('resultSection');
const resultSummary = document.getElementById('resultSummary');
const extractedItemsList = document.getElementById('extractedItemsList');
const addManualRowBtn = document.getElementById('addManualRowBtn');
const cancelResultBtn = document.getElementById('cancelResultBtn');
const saveAllBtn = document.getElementById('saveAllBtn');
const saveStatus = document.getElementById('saveStatus');

// ============================================
// onPageReady() — dipanggil oleh auth-check.js
// SETELAH CURRENT_CLINIC_ID & CURRENT_USER_ID terisi.
// ============================================
function onPageReady() {
  recordToggleBtn.addEventListener('click', handleRecordToggle);
  processAllBtn.addEventListener('click', handleProcessAllClick);
  addManualRowBtn.addEventListener('click', handleAddManualRow);
  cancelResultBtn.addEventListener('click', resetSuaraPage);
  saveAllBtn.addEventListener('click', handleSaveAllClick);

  // Percakapan [Perbaikan Dropdown Foto/Suara/Edit Inventaris]
  loadAutocompleteOptionsSuara();
}

// ============================================
// TOGGLE REKAM: tap sekali mulai, tap lagi berhenti (bukan pause/resume)
// ============================================
async function handleRecordToggle() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  if (recordedSegments.length >= MAX_TOTAL_SEGMENTS) {
    showRecordStatus(`Maksimal ${MAX_TOTAL_SEGMENTS} barang per sesi. Proses dulu yang sudah ada.`, 'error');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micPermissionNotice.style.display = 'none';

    // Pilih mime type yang didukung browser (Chrome Android: audio/webm umumnya didukung)
    const mimeType = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');

    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    currentChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) currentChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      // Matikan track mic setelah selesai, supaya indikator mic browser hilang
      stream.getTracks().forEach((track) => track.stop());

      const durationSeconds = Math.round((Date.now() - recordStartTime) / 1000);
      const blob = new Blob(currentChunks, { type: mediaRecorder.mimeType || 'audio/webm' });

      if (durationSeconds < 1) {
        showRecordStatus('Rekaman terlalu singkat, coba lagi.', 'error');
        return;
      }

      recordedSegments.push({
        id: 'segment_' + Date.now(),
        blob: blob,
        mimeType: mediaRecorder.mimeType || 'audio/webm',
        durationSeconds: durationSeconds
      });

      renderSegmentsList();
    };

    mediaRecorder.start();
    isRecording = true;
    recordStartTime = Date.now();

    recordToggleBtn.className = 'record-btn-active';
    recordIcon.textContent = '⏹️';
    recordLabel.textContent = 'Tap untuk selesai';
    recordTimer.style.display = 'block';
    recordStatus.style.display = 'none';

    recordTimerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - recordStartTime) / 1000);
      updateRecordTimerDisplay(elapsed);

      if (elapsed >= MAX_SEGMENT_SECONDS) {
        showRecordStatus(`Batas ${MAX_SEGMENT_SECONDS} detik per barang tercapai, rekaman dihentikan otomatis.`, 'info');
        stopRecording();
      }
    }, 250);

  } catch (error) {
    console.error('Mic error:', error);
    micPermissionNotice.style.display = 'block';
    showRecordStatus('Tidak bisa akses mikrofon. Pastikan izin sudah diberikan di pengaturan browser.', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }

  isRecording = false;
  clearInterval(recordTimerInterval);

  recordToggleBtn.className = 'record-btn-idle';
  recordIcon.textContent = '🎤';
  recordLabel.textContent = 'Tap untuk rekam barang';
  recordTimer.style.display = 'none';
  recordTimer.textContent = '00:00';
}

function updateRecordTimerDisplay(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  recordTimer.textContent = `${minutes}:${seconds}`;
}

// ============================================
// RENDER: daftar segmen yang sudah direkam (belum diproses AI)
// ============================================
function renderSegmentsList() {
  segmentsList.innerHTML = '';

  if (recordedSegments.length === 0) {
    segmentsEmptyHint.style.display = 'block';
    processAllBtn.style.display = 'none';
    processAllBtn.disabled = true;
    return;
  }

  segmentsEmptyHint.style.display = 'none';
  processAllBtn.style.display = 'block';
  processAllBtn.disabled = false;

  recordedSegments.forEach((segment, index) => {
    const row = document.createElement('div');
    row.className = 'segment-item';
    row.innerHTML = `
      <div class="segment-item-info">
        <span class="segment-item-icon">🎤</span>
        <span>Rekaman ${index + 1}</span>
        <span class="segment-item-duration">${segment.durationSeconds} detik</span>
      </div>
      <button type="button" class="segment-item-delete">🗑️ Hapus</button>
    `;

    row.querySelector('.segment-item-delete').addEventListener('click', () => {
      recordedSegments = recordedSegments.filter((s) => s.id !== segment.id);
      renderSegmentsList();
    });

    segmentsList.appendChild(row);
  });
}

// ============================================
// PROSES SEMUA: gabung semua segmen jadi 1 API call ke Edge Function
// ============================================
async function handleProcessAllClick() {
  if (recordedSegments.length === 0) return;

  // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - tolak sebelum
  // buang kuota AI kalau klinik locked (expired + jenis barang > batas free).
  // CLINIC_LOCKED diisi checkClinicAccessAndRenderBanner() di clinic-access.js.
  if (CLINIC_LOCKED) {
    showRecordStatus('Langganan sudah berakhir dan jumlah barang melebihi batas gratis. Kurangi jumlah jenis barang di Inventaris atau perpanjang Premium untuk pakai fitur AI lagi.', 'error');
    return;
  }

  processAllBtn.disabled = true;
  processAllBtn.textContent = 'Menganalisis suara...';
  showRecordStatus('AI sedang mendengarkan rekaman, tunggu sebentar...', 'info');

  try {
    const items = await callGeminiExtractionAudio(recordedSegments);

    if (items.length === 0) {
      showRecordStatus('AI tidak menemukan barang dari rekaman ini. Coba rekam ulang lebih jelas, atau tambah manual.', 'error');
      processAllBtn.disabled = false;
      processAllBtn.textContent = 'Proses Semua dengan AI';
      return;
    }

    // Struktur SAMA PERSIS dengan foto.js: batch_number & minimum_stock
    // selalu manual input, tidak pernah dari AI.
    extractedItems = items.map((item, index) => ({
      tempId: 'item_' + index,
      nama: item.nama || '',
      jumlah: item.jumlah || 0,
      satuan: item.satuan || 'pcs',
      kategori: item.kategori || '',
      expiry_date: item.expiry_date || '',
      lokasi_penyimpanan: item.lokasi_penyimpanan || '',
      batch_number: '',
      minimum_stock: 0,
      jenis_transaksi: 'in',
      included: true
    }));

    renderExtractedItems();
    recordStatus.style.display = 'none';
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth' });

  } catch (error) {
    console.error('Edge Function error:', error);
    // Kalau kartu kuota habis/sedang ramai sudah ditampilkan oleh
    // callGeminiExtractionAudio(), jangan tampilkan pesan error generik lagi
    if (error.message !== '__QUOTA_UI_SHOWN__') {
      showRecordStatus('Gagal menganalisis suara: ' + error.message, 'error');
    }
  } finally {
    processAllBtn.disabled = false;
    processAllBtn.textContent = 'Proses Semua dengan AI';
  }
}

// ============================================
// FUNGSI: Panggil AI lewat antrian + kuota (semua segmen sekaligus)
// Percakapan [BARU] - SUBSCRIPTION & QUOTA
// Dulu: fetch() langsung ke Edge Function dengan audio_parts.
// Sekarang: submit ke antrian dulu (dicek kuota + jatah/menit),
// lalu polling sampai selesai. Konversi blob->base64 (blobToBase64)
// TIDAK berubah — tetap dilakukan di sini sebelum submit.
// ============================================
async function callGeminiExtractionAudio(segments) {
  const audioParts = await Promise.all(
    segments.map(async (segment) => ({
      audio_base64: await blobToBase64(segment.blob),
      mime_type: segment.mimeType
    }))
  );

  const outcome = await submitAndWaitForAIResult({
    clinicId: CURRENT_CLINIC_ID,
    inputType: 'audio',
    mediaFields: {
      audio_parts: audioParts
    }
  });

  if (outcome.status === 'done') {
    const items = outcome.result.items;
    if (!Array.isArray(items)) {
      throw new Error('Format hasil dari server tidak sesuai.');
    }
    return items;
  }

  if (outcome.status === 'quota_exceeded' || outcome.status === 'busy') {
    renderQuotaBlockedCard(outcome);
    // Sinyal khusus supaya handleProcessAllClick() tidak menampilkan
    // pesan error generik dobel di atas kartu yang sudah ditampilkan
    throw new Error('__QUOTA_UI_SHOWN__');
  }

  // outcome.status === 'error'
  throw new Error(outcome.message || 'Gagal menganalisis suara.');
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ============================================
// RENDER, EDIT, SIMPAN — SEMUA DI BAWAH INI DI-COPY APA ADANYA DARI foto.js
// Tidak ada perubahan logic sama sekali, karena struktur extractedItems
// dan field-nya identik.
// ============================================
function renderExtractedItems() {
  resultSummary.textContent = `Ditemukan ${extractedItems.length} barang. Periksa dan koreksi sebelum simpan.`;
  extractedItemsList.innerHTML = '';

  extractedItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'extracted-item-row';
    row.id = item.tempId;

    row.innerHTML = `
      <div class="item-row-header">
        <label class="checkbox-label">
          <input type="checkbox" class="item-include" ${item.included ? 'checked' : ''}>
          <span>Simpan barang ini</span>
        </label>
        <button type="button" class="btn-delete-row">🗑️ Hapus</button>
      </div>

      <div class="field-group jenis-transaksi-group">
        <label>Jenis Transaksi</label>
        <div class="radio-row">
          <label class="radio-label">
            <input type="radio" name="jenis_${item.tempId}" class="item-jenis-in" value="in" ${item.jenis_transaksi === 'in' ? 'checked' : ''}>
            <span>Barang Masuk</span>
          </label>
          <label class="radio-label">
            <input type="radio" name="jenis_${item.tempId}" class="item-jenis-opname" value="opname" ${item.jenis_transaksi === 'opname' ? 'checked' : ''}>
            <span>Stok Fisik Saat Ini</span>
          </label>
        </div>
      </div>

      <div class="item-fields">
        <div class="field-group" style="position:relative;">
          <label>Nama Barang</label>
          <input type="text" class="item-nama" value="${escapeHtml(item.nama)}" placeholder="Nama barang" autocomplete="off">
          <div class="item-nama-results product-search-results" style="display:none;"></div>
        </div>

        <div class="field-row">
          <div class="field-group">
            <label>Jumlah</label>
            <input type="number" class="item-jumlah" value="${item.jumlah}" min="0" step="0.01">
          </div>
          <div class="field-group" style="position:relative;">
            <label>Satuan</label>
            <input type="text" class="item-satuan" value="${escapeHtml(item.satuan || 'pcs')}" placeholder="pcs / box / botol" autocomplete="off">
            <div class="item-satuan-results product-search-results" style="display:none;"></div>
          </div>
        </div>

        <div class="field-group" style="position:relative;">
          <label>Kategori</label>
          <input type="text" class="item-kategori" value="${escapeHtml(item.kategori)}" placeholder="Misal: APD, Obat, Alat" autocomplete="off">
          <div class="item-kategori-results product-search-results" style="display:none;"></div>
        </div>

        <div class="field-row">
          <div class="field-group">
            <label>Tanggal Kedaluwarsa</label>
            <input type="text" class="item-expiry" inputmode="numeric" placeholder="DDMMYYYY" maxlength="8">
          </div>
          <div class="field-group" style="position:relative;">
            <label>Lokasi Simpan</label>
            <input type="text" class="item-lokasi" value="${escapeHtml(item.lokasi_penyimpanan)}" placeholder="Misal: Lemari A" autocomplete="off">
            <div class="item-lokasi-results product-search-results" style="display:none;"></div>
          </div>
        </div>

        <div class="field-row">
          <div class="field-group">
            <label>Nomor Batch (manual)</label>
            <input type="text" class="item-batch" value="${escapeHtml(item.batch_number)}" placeholder="Contoh: BTC-2026-001">
          </div>
          <div class="field-group">
            <label>Stok Minimum (barang baru)</label>
            <input type="number" class="item-minstock" value="${item.minimum_stock}" min="0" step="0.01">
          </div>
        </div>
      </div>
    `;

    row.querySelector('.item-include').addEventListener('change', (e) => {
      updateItemField(item.tempId, 'included', e.target.checked);
      row.classList.toggle('item-excluded', !e.target.checked);
    });

    row.querySelector('.item-jenis-in').addEventListener('change', (e) => {
      if (e.target.checked) updateItemField(item.tempId, 'jenis_transaksi', 'in');
    });
    row.querySelector('.item-jenis-opname').addEventListener('change', (e) => {
      if (e.target.checked) updateItemField(item.tempId, 'jenis_transaksi', 'opname');
    });

    row.querySelector('.btn-delete-row').addEventListener('click', () => {
      extractedItems = extractedItems.filter(i => i.tempId !== item.tempId);
      row.remove();
      updateResultSummary();
    });

    row.querySelector('.item-nama').addEventListener('input', (e) => updateItemField(item.tempId, 'nama', e.target.value));
    row.querySelector('.item-jumlah').addEventListener('input', (e) => updateItemField(item.tempId, 'jumlah', parseFloat(e.target.value) || 0));
    row.querySelector('.item-satuan').addEventListener('input', (e) => updateItemField(item.tempId, 'satuan', e.target.value));
    row.querySelector('.item-kategori').addEventListener('input', (e) => updateItemField(item.tempId, 'kategori', e.target.value));
    row.querySelector('.item-expiry').addEventListener('input', (e) => {
      const parsed = parseDDMMYYYY(e.target.value);
      updateItemField(item.tempId, 'expiry_date', parsed.valid ? parsed.isoDate : null);
      updateItemField(item.tempId, 'expiry_date_invalid_input', (!parsed.valid && e.target.value.trim() !== ''));
    });
    row.querySelector('.item-lokasi').addEventListener('input', (e) => updateItemField(item.tempId, 'lokasi_penyimpanan', e.target.value));
    row.querySelector('.item-batch').addEventListener('input', (e) => updateItemField(item.tempId, 'batch_number', e.target.value));
    row.querySelector('.item-minstock').addEventListener('input', (e) => updateItemField(item.tempId, 'minimum_stock', parseFloat(e.target.value) || 0));

    const expiryInput = row.querySelector('.item-expiry');
    if (item.expiry_date) {
      expiryInput.value = formatToDDMMYYYY(item.expiry_date);
    }

    extractedItemsList.appendChild(row);

    // Percakapan [Perbaikan Dropdown Foto/Suara/Edit Inventaris] - pasang
    // autocomplete SETELAH row di-attach ke DOM (elemen baru lahir tiap
    // kali renderExtractedItems() jalan).
    setupSimpleAutocompleteOnElement(
      row.querySelector('.item-nama'),
      row.querySelector('.item-nama-results'),
      function() { return ALL_PRODUCT_NAMES; }
    );
    setupSimpleAutocompleteOnElement(
      row.querySelector('.item-kategori'),
      row.querySelector('.item-kategori-results'),
      function() { return ALL_CATEGORIES; }
    );
    setupSimpleAutocompleteOnElement(
      row.querySelector('.item-lokasi'),
      row.querySelector('.item-lokasi-results'),
      function() { return ALL_LOCATIONS; }
    );
    setupSimpleAutocompleteOnElement(
      row.querySelector('.item-satuan'),
      row.querySelector('.item-satuan-results'),
      function() { return ALL_UNITS; }
    );
  });
}

function updateItemField(tempId, field, value) {
  const item = extractedItems.find(i => i.tempId === tempId);
  if (item) item[field] = value;
}

function updateResultSummary() {
  resultSummary.textContent = `${extractedItems.length} barang dalam daftar.`;
}

function handleAddManualRow() {
  const newItem = {
    tempId: 'item_manual_' + Date.now(),
    nama: '',
    jumlah: 0,
    satuan: 'pcs',
    kategori: '',
    expiry_date: '',
    lokasi_penyimpanan: '',
    batch_number: '',
    minimum_stock: 0,
    jenis_transaksi: 'in',
    included: true
  };
  extractedItems.push(newItem);
  renderExtractedItems();
}

async function handleSaveAllClick() {
  const itemsToSave = extractedItems.filter(i => i.included);

  if (itemsToSave.length === 0) {
    showSaveStatus('Tidak ada barang yang dicentang untuk disimpan.', 'error');
    return;
  }

  // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - jaga-jaga kalau
  // klinik jadi locked di antara waktu proses suara & klik simpan.
  if (CLINIC_LOCKED) {
    showSaveStatus('Langganan sudah berakhir dan jumlah barang melebihi batas gratis. Kurangi jumlah jenis barang di Inventaris atau perpanjang Premium untuk lanjut.', 'error');
    return;
  }

  for (const item of itemsToSave) {
    if (!item.nama.trim() || !item.jumlah || item.jumlah <= 0) {
      showSaveStatus(`Barang "${item.nama || '(tanpa nama)'}" harus punya nama dan jumlah > 0.`, 'error');
      return;
    }
  }

  saveAllBtn.disabled = true;
  saveAllBtn.textContent = 'Menyimpan...';

  let successCount = 0;
  let failedItems = [];

  for (const item of itemsToSave) {
    try {
      await saveExtractedItemToSupabase(item);
      successCount++;
    } catch (error) {
      console.error('Gagal simpan item:', item.nama, error);
      failedItems.push(item.nama);
    }
  }

  saveAllBtn.disabled = false;
  saveAllBtn.textContent = 'Simpan Semua';

  if (failedItems.length === 0) {
    showSaveStatus(`Berhasil! ${successCount} barang tersimpan.`, 'success');
    setTimeout(() => {
      resetSuaraPage();
    }, 1500);
  } else {
    showSaveStatus(`${successCount} berhasil, ${failedItems.length} gagal (${failedItems.join(', ')}). Cek koneksi dan coba lagi untuk yang gagal.`, 'error');
  }
}

async function saveExtractedItemToSupabase(item) {
  const productName = item.nama.trim();
  const quantity = parseInt(item.jumlah, 10);
  const unit = item.satuan || 'pcs';
  const category = item.kategori.trim() || null;

  // Percakapan [Format Tanggal DDMMYYYY] - state item.expiry_date sudah
  // pasti ISO valid atau null (dijaga sejak listener input). Tolak kalau
  // user meninggalkan field dalam kondisi "sedang ketik tapi belum valid".
  if (item.expiry_date_invalid_input) {
    throw new Error(`${productName}: Tanggal kedaluwarsa belum lengkap/salah. Format: DDMMYYYY.`);
  }
  const expiryDate = item.expiry_date || null;

  const storageLocation = item.lokasi_penyimpanan.trim() || null;
  const batchNumber = item.batch_number.trim() || null;
  const minimumStock = parseFloat(item.minimum_stock) || 0;

  let { data: existingProduct, error: findError } = await supabaseClient
    .from('products')
    .select('id')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('name', productName)
    .maybeSingle();

  if (findError) throw findError;

  let productId;
  const isNewProduct = !existingProduct;

  if (existingProduct) {
    productId = existingProduct.id;
  } else {
    // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - cek limit
    // HANYA untuk produk baru (bukan restock produk lama).
    const limitCheck = await supabaseClient.rpc('check_product_limit', {
      p_clinic_id: CURRENT_CLINIC_ID
    });

    if (limitCheck.error) throw limitCheck.error;

    if (limitCheck.data.allowed === false) {
      throw new Error(
        `Batas jenis barang tercapai (${limitCheck.data.product_count}/${limitCheck.data.max_products}). ` +
        `Upgrade ke Premium atau hapus barang lama di Inventaris.`
      );
    }

    const { data: newProduct, error: insertProductError } = await supabaseClient
      .from('products')
      .insert({
        clinic_id: CURRENT_CLINIC_ID,
        name: productName,
        category: category,
        unit: unit,
        storage_location: storageLocation,
        minimum_stock: minimumStock,
        current_stock: 0
      })
      .select('id')
      .single();

    if (insertProductError) throw insertProductError;
    productId = newProduct.id;
  }

  const jenisTransaksi = isNewProduct ? 'in' : item.jenis_transaksi;

  if (jenisTransaksi === 'opname') {
    const { error: rpcError } = await supabaseClient.rpc('adjust_stock_opname', {
      p_clinic_id: CURRENT_CLINIC_ID,
      p_product_id: productId,
      p_jumlah_fisik: quantity,
      p_user_id: CURRENT_USER_ID,
      p_opname_note: 'Input via suara AI'
    });

    if (rpcError) throw rpcError;
  } else {
    const { error: rpcError } = await supabaseClient.rpc('add_stock_lot', {
      p_clinic_id: CURRENT_CLINIC_ID,
      p_product_id: productId,
      p_quantity: quantity,
      p_batch_number: batchNumber,
      p_expiry_date: expiryDate,
      p_user_id: CURRENT_USER_ID
    });

    if (rpcError) throw rpcError;
  }
}

// ============================================
// RESET halaman ke kondisi awal
// ============================================
function resetSuaraPage() {
  recordedSegments = [];
  extractedItems = [];

  renderSegmentsList();
  recordStatus.style.display = 'none';

  resultSection.style.display = 'none';
  extractedItemsList.innerHTML = '';
  saveStatus.style.display = 'none';
}

// ============================================
// HELPER: Status messages
// ============================================
function showRecordStatus(message, type) {
  recordStatus.textContent = message;
  recordStatus.className = 'status-message status-' + type;
  recordStatus.style.display = 'block';
  // Percakapan [Perbaikan Pesan Status] - auto-scroll ke pesan error saja
  if (type === 'error') {
    recordStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function showSaveStatus(message, type) {
  saveStatus.textContent = message;
  saveStatus.className = 'status-message status-' + type;
  saveStatus.style.display = 'block';
  // Percakapan [Perbaikan Pesan Status] - auto-scroll ke pesan error saja
  if (type === 'error') {
    saveStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
