// ============================================
// AI PHOTO EKSTRAKSI
// Percakapan 7 (revisi) - FOTO KE EDGE FUNCTION
// Percakapan [lanjutan P9] - REFACTOR: pakai RPC add_stock_lot & adjust_stock_opname
//   (konsisten dengan app.js, ikut arsitektur Lot/Batch Tracking + FEFO dari P9)
//   + tambah field Nomor Batch & Stok Minimum (manual input, tidak dari AI)
//
// API key Gemini sudah dipindah ke Supabase Edge Function (server-side).
// Browser TIDAK lagi menyimpan/mengirim API key apapun.
//
// CATATAN: CURRENT_CLINIC_ID, CURRENT_USER_ID, supabaseClient
// sudah didefinisikan di auth-check.js dan supabase-client.js.
// File ini TIDAK boleh redeclare variabel itu.
// ============================================

// Percakapan [BARU] - SUBSCRIPTION & QUOTA: EDGE_FUNCTION_URL dihapus dari sini,
// karena pemanggilan Edge Function sekarang dilakukan lewat
// submitAndWaitForAIResult() di ai-queue-helper.js (yang membangun
// URL-nya sendiri dari SUPABASE_URL di supabase-client.js)

let selectedPhotoBase64 = null;
let selectedPhotoMimeType = null;
let extractedItems = []; // array hasil ekstraksi yang sedang diedit user

// Elemen-elemen DOM (di-query sekali di top level, aman karena DOM sudah ada
// walau appContainer masih display:none saat ini)
const photoInput = document.getElementById('photoInput');
const photoPreview = document.getElementById('photoPreview');
const uploadLabel = document.getElementById('uploadLabel');
const analyzeBtn = document.getElementById('analyzeBtn');
const uploadStatus = document.getElementById('uploadStatus');

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
// Di sinilah semua event listener didaftarkan.
// ============================================
function onPageReady() {
  photoInput.addEventListener('change', handlePhotoSelected);
  analyzeBtn.addEventListener('click', handleAnalyzeClick);
  addManualRowBtn.addEventListener('click', handleAddManualRow);
  cancelResultBtn.addEventListener('click', resetFotoPage);
  saveAllBtn.addEventListener('click', handleSaveAllClick);
}

// ============================================
// Percakapan [BARU] - KOMPRESI FOTO SEBELUM UPLOAD
// Resize ke maksimal 1280px di sisi terpanjang + compress JPEG quality 0.75.
// Tujuan: hindari gagal upload karena file kamera terlalu besar (beberapa MB),
// tanpa perlu user turunkan kualitas kamera manual.
//
// Cara kerja: gambar dimuat ke <img> di memori, digambar ulang ke <canvas>
// dengan ukuran baru, lalu diekspor sebagai JPEG base64 lewat canvas.toDataURL().
// Semua terjadi di browser (client-side), tidak ada upload sementara ke server.
// ============================================
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.75;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Hitung ukuran baru, jaga aspect ratio, cuma perkecil (tidak perbesar foto kecil)
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width = MAX_DIMENSION;
        } else {
          width = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      // Selalu ekspor sebagai JPEG (lebih kecil dari PNG untuk foto kamera),
      // meski file asli formatnya lain (misal HEIC yang sudah didecode browser jadi bitmap).
      const compressedDataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

      resolve({
        dataUrl: compressedDataUrl,
        mimeType: 'image/jpeg'
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Gagal memuat foto untuk kompresi. Coba foto lain.'));
    };

    img.src = objectUrl;
  });
}

// ============================================
// STEP 1: User pilih foto → kompres → preview
// ============================================
async function handlePhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  showUploadStatus('Memproses foto...', 'info');
  uploadLabel.textContent = 'Memproses foto...';

  try {
    const { dataUrl, mimeType } = await compressImage(file);

    selectedPhotoMimeType = mimeType;
    selectedPhotoBase64 = dataUrl.split(',')[1];

    photoPreview.src = dataUrl;
    photoPreview.style.display = 'block';
    uploadLabel.textContent = 'Foto dipilih. Tap area ini untuk ganti foto.';
    analyzeBtn.style.display = 'block';
    analyzeBtn.disabled = false;
    uploadStatus.style.display = 'none';
  } catch (error) {
    console.error('Compress error:', error);
    showUploadStatus(error.message || 'Gagal memproses foto. Coba foto lain.', 'error');
    uploadLabel.textContent = 'Tap untuk ambil gambar dari galeri';
  }
}

// ============================================
// STEP 2: Kirim ke Edge Function (bukan langsung ke Gemini)
// ============================================
async function handleAnalyzeClick() {
  if (!selectedPhotoBase64) return;

  // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - tolak sebelum
  // buang kuota AI kalau klinik locked (expired + jenis barang > batas free).
  // CLINIC_LOCKED diisi checkClinicAccessAndRenderBanner() di clinic-access.js.
  if (CLINIC_LOCKED) {
    showUploadStatus('Langganan sudah berakhir dan jumlah barang melebihi batas gratis. Kurangi jumlah jenis barang di Inventaris atau perpanjang Premium untuk pakai fitur AI lagi.', 'error');
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Menganalisis foto...';
  showUploadStatus('AI sedang membaca foto, tunggu sebentar...', 'info');

  try {
    const items = await callGeminiExtraction(selectedPhotoBase64, selectedPhotoMimeType);

    if (items.length === 0) {
      showUploadStatus('AI tidak menemukan barang di foto ini. Coba foto yang lebih jelas, atau tambah manual.', 'error');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analisis dengan AI';
      return;
    }

    // CATATAN: batch_number & minimum_stock SENGAJA tidak diminta dari AI
    // (keputusan desain: AI tidak reliable membaca teks kecil/barcode batch,
    // jadi kedua field ini selalu manual input oleh user).
    extractedItems = items.map((item, index) => ({
      tempId: 'item_' + index,
      nama: item.nama || '',
      jumlah: item.jumlah || 0,
      satuan: item.satuan || 'pcs',
      kategori: item.kategori || '',
      expiry_date: item.expiry_date || '',
      lokasi_penyimpanan: item.lokasi_penyimpanan || '',
      batch_number: '', // manual, tidak dari AI
      minimum_stock: 0, // manual, tidak dari AI
      jenis_transaksi: 'in', // default: Barang Masuk. Bisa diubah ke 'opname' oleh user.
      included: true
    }));

    renderExtractedItems();
    uploadStatus.style.display = 'none';
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth' });

  } catch (error) {
    console.error('Edge Function error:', error);
    // Kalau kartu kuota habis/sedang ramai sudah ditampilkan oleh
    // callGeminiExtraction(), jangan tampilkan pesan error generik lagi
    if (error.message !== '__QUOTA_UI_SHOWN__') {
      showUploadStatus('Gagal menganalisis foto: ' + error.message, 'error');
    }
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analisis dengan AI';
  }
}

// ============================================
// FUNGSI: Panggil AI lewat antrian + kuota
// Percakapan [BARU] - SUBSCRIPTION & QUOTA
// Dulu: fetch() langsung ke Edge Function, tunggu, dapat hasil.
// Sekarang: submit ke antrian dulu (dicek kuota + jatah/menit),
// lalu polling sampai selesai. Key Gemini tetap TIDAK ada di sini.
// ============================================
async function callGeminiExtraction(base64Image, mimeType) {
  const outcome = await submitAndWaitForAIResult({
    clinicId: CURRENT_CLINIC_ID,
    inputType: 'image',
    mediaFields: {
      image_base64: base64Image,
      mime_type: mimeType
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
    // Tampilkan kartu kuota habis / sedang ramai, bukan error biasa
    renderQuotaBlockedCard(outcome);
    // Lempar error khusus supaya handleAnalyzeClick() tahu untuk
    // TIDAK menampilkan pesan error generik di uploadStatus lagi
    // (kartunya sudah cukup, tidak perlu dobel pesan)
    throw new Error('__QUOTA_UI_SHOWN__');
  }

  // outcome.status === 'error'
  throw new Error(outcome.message || 'Gagal menganalisis foto.');
}

// ============================================

// RENDER: Tampilkan hasil ekstraksi (editable)
// Field sekarang SAMA dengan form input manual di index.html:
// nama, jumlah, satuan, kategori, expiry, lokasi, batch_number, minimum_stock
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
        <div class="field-group">
          <label>Nama Barang</label>
          <input type="text" class="item-nama" value="${escapeHtml(item.nama)}" placeholder="Nama barang">
        </div>

        <div class="field-row">
          <div class="field-group">
            <label>Jumlah</label>
            <input type="number" class="item-jumlah" value="${item.jumlah}" min="0" step="0.01">
          </div>
          <div class="field-group">
            <label>Satuan</label>
            <select class="item-satuan">
              <option value="pcs" ${item.satuan === 'pcs' ? 'selected' : ''}>pcs</option>
              <option value="box" ${item.satuan === 'box' ? 'selected' : ''}>box</option>
              <option value="botol" ${item.satuan === 'botol' ? 'selected' : ''}>botol</option>
              <option value="tube" ${item.satuan === 'tube' ? 'selected' : ''}>tube</option>
              <option value="dus" ${item.satuan === 'dus' ? 'selected' : ''}>dus</option>
              <option value="lainnya" ${item.satuan === 'lainnya' ? 'selected' : ''}>lainnya</option>
            </select>
          </div>
        </div>

        <div class="field-group">
          <label>Kategori</label>
          <input type="text" class="item-kategori" value="${escapeHtml(item.kategori)}" placeholder="Misal: APD, Obat, Alat">
        </div>

        <div class="field-row">
          <div class="field-group">
            <label>Tanggal Kedaluwarsa</label>
            <input type="date" class="item-expiry">
          </div>
          <div class="field-group">
            <label>Lokasi Simpan</label>
            <input type="text" class="item-lokasi" value="${escapeHtml(item.lokasi_penyimpanan)}" placeholder="Misal: Lemari A">
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
    row.querySelector('.item-satuan').addEventListener('change', (e) => updateItemField(item.tempId, 'satuan', e.target.value));
    row.querySelector('.item-kategori').addEventListener('input', (e) => updateItemField(item.tempId, 'kategori', e.target.value));
    row.querySelector('.item-expiry').addEventListener('input', (e) => updateItemField(item.tempId, 'expiry_date', e.target.value));
    row.querySelector('.item-lokasi').addEventListener('input', (e) => updateItemField(item.tempId, 'lokasi_penyimpanan', e.target.value));
    row.querySelector('.item-batch').addEventListener('input', (e) => updateItemField(item.tempId, 'batch_number', e.target.value));
    row.querySelector('.item-minstock').addEventListener('input', (e) => updateItemField(item.tempId, 'minimum_stock', parseFloat(e.target.value) || 0));

    // Set value date terpisah setelah elemen ter-attach, untuk hindari bug WebView Android
    const expiryInput = row.querySelector('.item-expiry');
    if (item.expiry_date) {
      expiryInput.value = item.expiry_date;
    }

    extractedItemsList.appendChild(row);
  });
}

function updateItemField(tempId, field, value) {
  const item = extractedItems.find(i => i.tempId === tempId);
  if (item) item[field] = value;
}

function updateResultSummary() {
  resultSummary.textContent = `${extractedItems.length} barang dalam daftar.`;
}

// ============================================
// Tambah baris manual
// ============================================
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

// ============================================
// SIMPAN SEMUA
// ============================================
async function handleSaveAllClick() {
  const itemsToSave = extractedItems.filter(i => i.included);

  if (itemsToSave.length === 0) {
    showSaveStatus('Tidak ada barang yang dicentang untuk disimpan.', 'error');
    return;
  }

  // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - jaga-jaga kalau
  // klinik jadi locked di antara waktu analisis foto & klik simpan.
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
      resetFotoPage();
    }, 1500);
  } else {
    showSaveStatus(`${successCount} berhasil, ${failedItems.length} gagal (${failedItems.join(', ')}). Cek koneksi dan coba lagi untuk yang gagal.`, 'error');
  }
}

// ============================================


// Simpan 1 item — SEKARANG LEWAT RPC (add_stock_lot / adjust_stock_opname)
// Konsisten dengan handleStockIn() & handleOpname() di app.js.
// Tidak lagi insert manual ke stock_movements / hitung stockAfter di JS —
// semua itu sekarang jadi tanggung jawab RPC & trigger di database.
// ============================================
async function saveExtractedItemToSupabase(item) {
  const productName = item.nama.trim();
  const quantity = parseInt(item.jumlah, 10);
  const unit = item.satuan || 'pcs';
  const category = item.kategori.trim() || null;
  const expiryDate = item.expiry_date || null;
  const storageLocation = item.lokasi_penyimpanan.trim() || null;
  const batchNumber = item.batch_number.trim() || null;
  const minimumStock = parseFloat(item.minimum_stock) || 0;

  // Cari produk existing, atau buat baru kalau belum ada
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
        minimum_stock: minimumStock, // hanya dipakai untuk produk baru
        current_stock: 0
      })
      .select('id')
      .single();

    if (insertProductError) throw insertProductError;
    productId = newProduct.id;
  }

  // Produk baru (belum ada histori stok) selalu diperlakukan sebagai "in",
  // karena opname tidak bermakna tanpa baseline stok sebelumnya
  // (aturan yang sama seperti versi lama, tetap dipertahankan).
  const jenisTransaksi = isNewProduct ? 'in' : item.jenis_transaksi;

  if (jenisTransaksi === 'opname') {
    const { error: rpcError } = await supabaseClient.rpc('adjust_stock_opname', {
      p_clinic_id: CURRENT_CLINIC_ID,
      p_product_id: productId,
      p_jumlah_fisik: quantity,
      p_user_id: CURRENT_USER_ID,
      p_opname_note: 'Input via foto AI'
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
function resetFotoPage() {
  selectedPhotoBase64 = null;
  selectedPhotoMimeType = null;
  extractedItems = [];

  photoInput.value = '';
  photoPreview.style.display = 'none';
  photoPreview.src = '';
  uploadLabel.textContent = 'Tap untuk ambil gambar dari galeri';
  analyzeBtn.style.display = 'none';
  uploadStatus.style.display = 'none';

  resultSection.style.display = 'none';
  extractedItemsList.innerHTML = '';
  saveStatus.style.display = 'none';
}

// ============================================
// HELPER: Status messages
// ============================================
function showUploadStatus(message, type) {
  uploadStatus.textContent = message;
  uploadStatus.className = 'status-message status-' + type;
  uploadStatus.style.display = 'block';
  // Percakapan [Perbaikan Pesan Status] - auto-scroll ke pesan error saja
  if (type === 'error') {
    uploadStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

// ============================================
// HELPER: Escape HTML
// ============================================
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


