// ============================================
// AI PHOTO EKSTRAKSI
// Percakapan 7 (revisi) - FOTO KE EDGE FUNCTION
// API key Gemini sudah dipindah ke Supabase Edge Function (server-side).
// Browser TIDAK lagi menyimpan/mengirim API key apapun.
//
// CATATAN: CURRENT_CLINIC_ID, CURRENT_USER_ID, supabaseClient
// sudah didefinisikan di auth-check.js dan supabase-client.js.
// File ini TIDAK boleh redeclare variabel itu.
// ============================================

const EDGE_FUNCTION_URL = 'https://redocvsmqvjocbenlicw.supabase.co/functions/v1/smooth-responder';

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
// STEP 1: User pilih foto → preview
// ============================================
async function handlePhotoSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  selectedPhotoMimeType = file.type;

  const reader = new FileReader();
  reader.onload = (event) => {
    const fullDataUrl = event.target.result;
    selectedPhotoBase64 = fullDataUrl.split(',')[1];

    photoPreview.src = fullDataUrl;
    photoPreview.style.display = 'block';
    uploadLabel.textContent = 'Foto dipilih. Tap area ini untuk ganti foto.';
    analyzeBtn.style.display = 'block';
    analyzeBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

// ============================================
// STEP 2: Kirim ke Edge Function (bukan langsung ke Gemini)
// ============================================
async function handleAnalyzeClick() {
  if (!selectedPhotoBase64) return;

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

    extractedItems = items.map((item, index) => ({
      tempId: 'item_' + index,
      nama: item.nama || '',
      jumlah: item.jumlah || 0,
      satuan: item.satuan || 'pcs',
      kategori: item.kategori || '',
      expiry_date: item.expiry_date || '',
      lokasi_penyimpanan: item.lokasi_penyimpanan || '',
      included: true
    }));

    renderExtractedItems();
    uploadStatus.style.display = 'none';
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth' });

  } catch (error) {
    console.error('Edge Function error:', error);
    showUploadStatus('Gagal menganalisis foto: ' + error.message, 'error');
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analisis dengan AI';
  }
}

// ============================================
// FUNGSI: Panggil Edge Function (proxy Gemini di server)
// Key Gemini TIDAK ada di sini sama sekali — aman.
// ============================================
async function callGeminiExtraction(base64Image, mimeType) {
  // Ambil token login user saat ini, dikirim ke Edge Function untuk auth check
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (!session) {
    throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');
  }

  const response = await fetch(EDGE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({
      image_base64: base64Image,
      mime_type: mimeType
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Server error (${response.status})`);
  }

  if (!Array.isArray(data.items)) {
    throw new Error('Format hasil dari server tidak sesuai.');
  }

  return data.items;
}

// ============================================
// RENDER: Tampilkan hasil ekstraksi (editable)
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
      </div>
    `;

    row.querySelector('.item-include').addEventListener('change', (e) => {
      updateItemField(item.tempId, 'included', e.target.checked);
      row.classList.toggle('item-excluded', !e.target.checked);
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
// Simpan 1 item ke products + stock_movements
// (mirror dari handleStockIn di app.js, source_type dibedakan)
// ============================================
async function saveExtractedItemToSupabase(item) {
  const productName = item.nama.trim();
  const quantity = parseFloat(item.jumlah);
  const unit = item.satuan || 'pcs';
  const category = item.kategori.trim() || null;
  const expiryDate = item.expiry_date || null;
  const storageLocation = item.lokasi_penyimpanan.trim() || null;

  let { data: existingProduct, error: findError } = await supabaseClient
    .from('products')
    .select('id, current_stock')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('name', productName)
    .maybeSingle();

  if (findError) throw findError;

  let productId, stockBefore;

  if (existingProduct) {
    productId = existingProduct.id;
    stockBefore = existingProduct.current_stock;
  } else {
    const { data: newProduct, error: insertProductError } = await supabaseClient
      .from('products')
      .insert({
        clinic_id: CURRENT_CLINIC_ID,
        name: productName,
        category: category,
        unit: unit,
        storage_location: storageLocation,
        minimum_stock: 0,
        current_stock: 0
      })
      .select('id, current_stock')
      .single();

    if (insertProductError) throw insertProductError;
    productId = newProduct.id;
    stockBefore = 0;
  }

  const stockAfter = stockBefore + quantity;

  const { error: insertMovementError } = await supabaseClient
    .from('stock_movements')
    .insert({
      clinic_id: CURRENT_CLINIC_ID,
      product_id: productId,
      movement_type: 'in',
      quantity: quantity,
      stock_before: stockBefore,
      stock_after: stockAfter,
      expiry_date: expiryDate,
      source_type: 'photo_ai',
      performed_by: CURRENT_USER_ID
    });

  if (insertMovementError) throw insertMovementError;
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
  uploadLabel.textContent = 'Tap untuk ambil foto atau pilih dari galeri';
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
}

function showSaveStatus(message, type) {
  saveStatus.textContent = message;
  saveStatus.className = 'status-message status-' + type;
  saveStatus.style.display = 'block';
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
      
