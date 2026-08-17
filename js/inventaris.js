// ============================================
// INVENTARIS - Daftar stok barang
// Percakapan P10 - TAMBAH: dropdown sortir, tap-to-expand (detail + riwayat
//   transaksi singkat), pagination client-side (20 item/halaman)
// Percakapan [Edit Data Barang] - TAMBAH: form edit inline di dalam expand card.
//   Field yang bisa diedit: nama, kategori, satuan (label saja, bukan konversi
//   kuantitas), lokasi penyimpanan, stok minimum. Jumlah stok TIDAK bisa diedit
//   di sini (diarahkan ke Stok Opname) karena current_stock adalah hasil agregat
//   dari product_lots (via trigger sync_product_current_stock), bukan kolom bebas.
// Percakapan [Gabungkan Barang] - TAMBAH: mode pilih 2 produk untuk digabung,
//   modal konfirmasi, panggil RPC merge_products(), tampilan khusus baris
//   'merge_marker' di riwayat transaksi. Juga perbaiki bug kecil label
//   'opname_adjustment' yang sebelumnya tidak ke-mapping (tampil mentah).
// Default urutan (saat sortir = "Status"): Kritis (stok=0) > Menipis (stok<=minimum) > Normal
// ============================================

const ITEMS_PER_PAGE = 20;

let ALL_INVENTARIS_ITEMS = [];
let CURRENT_SORT = 'status'; // 'status' | 'nama' | 'stok' | 'kategori'
let CURRENT_PAGE = 1;
let EXPANDED_ITEM_ID = null; // tempId (product id) dari card yang sedang terbuka, atau null
let EDITING_ITEM_ID = null; // product id dari card yang sedang dalam mode edit, atau null
// Percakapan [Edit Lot - Batch & Kadaluarsa] - lot_id dari baris lot yang sedang
// dalam mode edit (batch_number + expiry_date), atau null. Hanya satu lot boleh
// diedit dalam satu waktu, terpisah dari EDITING_ITEM_ID (edit data barang).
let EDITING_LOT_ID = null;

// ---- State untuk fitur Gabungkan Barang ----
let SELECTION_MODE = false;
let SELECTED_IDS = new Set(); // maksimal 2 product id

// Percakapan [Perbaikan Dropdown Foto/Suara/Edit Inventaris] - daftar
// untuk autocomplete di form Edit Data Barang (field Nama/Kategori/Satuan/Lokasi).
// Sumbernya sama dengan app.js: histori dari tabel products + starter list.
let ALL_PRODUCT_NAMES = [];
let ALL_CATEGORIES = [];
let ALL_LOCATIONS = [];
let ALL_UNITS = [];
const STARTER_CATEGORIES = ['APD', 'BMHP', 'Obat', 'Alat Kesehatan', 'Bahan Tambal/Restorasi', 'Lainnya'];
const STARTER_UNITS = ['pcs', 'box', 'botol', 'tube', 'dus', 'pack', 'set', 'lembar'];

async function loadAutocompleteOptionsInventaris() {
  // Percakapan [Fix: Nama Barang Hilang Setelah Dihapus] - filter
  // is_active=true, supaya barang yang sudah dihapus tidak lagi muncul
  // di dropdown autocomplete form Edit Data Barang.
  const { data: products, error } = await supabaseClient
    .from('products')
    .select('name, category, storage_location, unit')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true);

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

const inventarisSearchInput = document.getElementById('inventarisSearchInput');
const inventarisSummary = document.getElementById('inventarisSummary');
const inventarisList = document.getElementById('inventarisList');
const inventarisSortSelect = document.getElementById('inventarisSortSelect');
const inventarisPagination = document.getElementById('inventarisPagination');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const exportStatus = document.getElementById('exportStatus');

// ---- Elemen fitur Gabungkan Barang ----
const toggleMergeModeBtn = document.getElementById('toggleMergeModeBtn');
const confirmMergeBtn = document.getElementById('confirmMergeBtn');
const mergeStatus = document.getElementById('mergeStatus');

// Percakapan [Cek Barang Mirip (AI)] - elemen baru
const suggestMergeBtn = document.getElementById('suggestMergeBtn');
const suggestMergeSection = document.getElementById('suggestMergeSection');
const suggestMergeList = document.getElementById('suggestMergeList');
const suggestMergeStatus = document.getElementById('suggestMergeStatus');
const mergeConfirmModal = document.getElementById('mergeConfirmModal');
const mergeConfirmBody = document.getElementById('mergeConfirmBody');
const mergeExecuteBtn = document.getElementById('mergeExecuteBtn');
const mergeCancelBtn = document.getElementById('mergeCancelBtn');

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  await loadInventaris();

  // Percakapan [Perbaikan Dropdown Foto/Suara/Edit Inventaris] - load
  // daftar autocomplete untuk form Edit. Tidak perlu di-await sebelum
  // form edit dibuka, tapi dipanggil di awal supaya sudah siap saat
  // user pertama kali tap "Edit".
  loadAutocompleteOptionsInventaris();

  inventarisSearchInput.addEventListener('input', () => {
    CURRENT_PAGE = 1; // reset ke halaman 1 tiap kali pencarian berubah
    renderInventaris(inventarisSearchInput.value);
  });

  exportPdfBtn.addEventListener('click', handleExportPdf);

  inventarisSortSelect.addEventListener('change', () => {
    CURRENT_SORT = inventarisSortSelect.value;
    CURRENT_PAGE = 1; // reset ke halaman 1 tiap kali sortir berubah
    renderInventaris(inventarisSearchInput.value);
  });

  toggleMergeModeBtn.addEventListener('click', handleToggleMergeMode);
  confirmMergeBtn.addEventListener('click', handleMergeClick);
  mergeExecuteBtn.addEventListener('click', executeMerge);
  mergeCancelBtn.addEventListener('click', closeMergeConfirmModal);

  // Percakapan [Cek Barang Mirip (AI)]
  suggestMergeBtn.addEventListener('click', handleSuggestMergeClick);

  // Percakapan [Daftar Belanja]
  setupDaftarBelanja();
}

async function loadInventaris() {
  inventarisList.innerHTML = '<p class="loading-text">Memuat data...</p>';

  const { data: products, error } = await supabaseClient
    .from('products')
    .select('id, name, category, current_stock, minimum_stock, unit, storage_location, created_at')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true);

  if (error) {
    console.error('Gagal load inventaris:', error);
    inventarisList.innerHTML = '<p class="error-text">Gagal memuat data. Coba refresh halaman.</p>';
    return;
  }

  ALL_INVENTARIS_ITEMS = (products || []).map(p => ({
    ...p,
    status: getStockStatus(p.current_stock, p.minimum_stock),
    recentHistory: null, // diisi on-demand saat card di-expand pertama kali (cache)
    activeLots: null // diisi on-demand saat card di-expand pertama kali (cache) — daftar lot aktif (batch_number + expiry_date)
  }));

  renderInventaris('');
}

// Tentukan status stok: kritis, menipis, atau normal
function getStockStatus(currentStock, minimumStock) {
  if (currentStock <= 0) return 'kritis';
  if (currentStock <= minimumStock) return 'menipis';
  return 'normal';
}

// Urutan prioritas untuk sorting status: kritis dulu, lalu menipis, lalu normal
function statusPriority(status) {
  if (status === 'kritis') return 0;
  if (status === 'menipis') return 1;
  return 2;
}

// Terapkan sortir sesuai pilihan dropdown (CURRENT_SORT)
function applySorting(items) {
  const sorted = [...items];

  if (CURRENT_SORT === 'nama') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (CURRENT_SORT === 'stok') {
    // Stok rendah -> tinggi. Kalau sama, urutkan nama sebagai tie-breaker.
    sorted.sort((a, b) => a.current_stock - b.current_stock || a.name.localeCompare(b.name));
  } else if (CURRENT_SORT === 'kategori') {
    sorted.sort((a, b) => {
      const catA = a.category || '';
      const catB = b.category || '';
      return catA.localeCompare(catB) || a.name.localeCompare(b.name);
    });
  } else {
    // default: 'status' -> kritis > menipis > normal, lalu alfabetis dalam grup yang sama
    sorted.sort((a, b) => {
      const priorityDiff = statusPriority(a.status) - statusPriority(b.status);
      if (priorityDiff !== 0) return priorityDiff;
      return a.name.localeCompare(b.name);
    });
  }

  return sorted;
}

function renderInventaris(keyword) {
  const searchTerm = keyword.trim().toLowerCase();

  let filtered = searchTerm === ''
    ? ALL_INVENTARIS_ITEMS
    : ALL_INVENTARIS_ITEMS.filter(p => p.name.toLowerCase().includes(searchTerm));

  filtered = applySorting(filtered);

  renderSummary(filtered);

  if (filtered.length === 0) {
    inventarisList.innerHTML = '<p class="loading-text">Tidak ada barang ditemukan.</p>';
    inventarisPagination.innerHTML = '';
    return;
  }

  // ---- PAGINATION: potong array sesuai halaman aktif ----
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  if (CURRENT_PAGE > totalPages) CURRENT_PAGE = totalPages; // jaga-jaga kalau filter baru bikin halaman lama tidak valid lagi

  const startIndex = (CURRENT_PAGE - 1) * ITEMS_PER_PAGE;
  const pageItems = filtered.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  inventarisList.innerHTML = '';

  pageItems.forEach(p => {
    inventarisList.appendChild(buildItemCard(p));
  });

  renderPagination(totalPages);
}

// ============================================
// KARTU BARANG: bagian ringkas (selalu terlihat) + bagian detail (tampil saat expanded)
// ============================================
function buildItemCard(p) {
  const isExpanded = EXPANDED_ITEM_ID === p.id;
  const isSelected = SELECTED_IDS.has(p.id);

  const item = document.createElement('div');
  item.className = `inventaris-item status-${p.status}${isExpanded ? ' expanded' : ''}${SELECTION_MODE ? ' selection-mode' : ''}${isSelected ? ' selected' : ''}`;
  item.dataset.productId = p.id;

  const badgeLabel = p.status === 'kritis' ? 'Kritis' : p.status === 'menipis' ? 'Menipis' : 'Normal';

  const checkboxHtml = SELECTION_MODE
    ? `<input type="checkbox" class="merge-checkbox" ${isSelected ? 'checked' : ''} tabindex="-1">`
    : '';

  item.innerHTML = `
    <div class="inventaris-item-main">
      ${checkboxHtml}
      <span class="inventaris-item-name">${escapeHtml(p.name)}</span>
      <span class="inventaris-badge badge-${p.status}">${badgeLabel}</span>
      <span class="inventaris-chevron">${SELECTION_MODE ? '' : (isExpanded ? '▴' : '▾')}</span>
    </div>
    <div class="inventaris-item-detail">
      <span>${escapeHtml(p.category || '-')}</span>
      <span>${p.current_stock} ${escapeHtml(p.unit)} (min: ${p.minimum_stock})</span>
    </div>
    <div class="inventaris-item-expand" style="display:${(!SELECTION_MODE && isExpanded) ? 'block' : 'none'}">
      ${buildExpandContent(p)}
    </div>
  `;

  // Percakapan [Perbaikan Dropdown Foto/Suara/Edit Inventaris] - pasang
  // autocomplete di form edit, HANYA kalau card ini sedang dalam mode
  // edit (form-nya baru lahir lewat innerHTML di atas, elemen di dalam
  // form belum pernah dipasangi listener sebelum baris ini).
  if (EDITING_ITEM_ID === p.id) {
    setupSimpleAutocompleteOnElement(
      item.querySelector('[data-field="name"]'),
      item.querySelector('.edit-name-results'),
      function() { return ALL_PRODUCT_NAMES; }
    );
    setupSimpleAutocompleteOnElement(
      item.querySelector('[data-field="category"]'),
      item.querySelector('.edit-category-results'),
      function() { return ALL_CATEGORIES; }
    );
    setupSimpleAutocompleteOnElement(
      item.querySelector('[data-field="unit"]'),
      item.querySelector('.edit-unit-results'),
      function() { return ALL_UNITS; }
    );
    setupSimpleAutocompleteOnElement(
      item.querySelector('[data-field="storage_location"]'),
      item.querySelector('.edit-location-results'),
      function() { return ALL_LOCATIONS; }
    );
  }

  // Klik di area manapun pada card (kecuali di dalam expand content) = toggle expand
  // ATAU, kalau sedang dalam mode pilih-untuk-gabung, klik = toggle pilihan checkbox
  item.addEventListener('click', (e) => {
    if (e.target.closest('.inventaris-item-expand')) return; // biar tidak konflik dengan elemen interaktif di dalam expand

    if (SELECTION_MODE) {
      handleToggleSelect(p.id);
      return;
    }

    handleCardToggle(p.id);
  });

  // Tombol-tombol di dalam area edit (Edit / Simpan / Batal) — event delegation
  const actionBtn = item.querySelector('[data-action]');
  if (actionBtn) {
    item.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); // jangan sampai toggle expand ikut kepicu
        const action = btn.dataset.action;
        if (action === 'edit') {
          handleStartEdit(p.id);
        } else if (action === 'cancel-edit') {
          handleCancelEdit(p.id);
        } else if (action === 'save-edit') {
          handleSaveEdit(p.id, item);
        } else if (action === 'delete-product') {
          handleDeleteProduct(p.id, p.name, item);
        } else if (action === 'edit-lot') {
          handleStartEditLot(btn.dataset.lotId, p.id);
        } else if (action === 'cancel-edit-lot') {
          handleCancelEditLot(p.id);
        } else if (action === 'save-edit-lot') {
          handleSaveEditLot(btn.dataset.lotId, p.id, item);
        }
      });
    });
  }

  return item;
}

// Isi bagian detail lengkap (muncul saat card di-expand)
function buildExpandContent(p) {
  let historyHtml;

  if (p.recentHistory === null) {
    historyHtml = '<p class="history-loading">Memuat riwayat...</p>';
  } else if (p.recentHistory.length === 0) {
    historyHtml = '<p class="history-empty">Belum ada riwayat transaksi.</p>';
  } else {
    historyHtml = '<ul class="history-list">' + p.recentHistory.map(h => {
      // Baris penanda hasil gabung produk ditampilkan beda (ikon + catatan, tanpa kolom jumlah)
      if (h.movement_type === 'merge_marker') {
        return `
          <li class="history-merge">
            <span class="history-date">${formatTanggal(h.created_at)}</span>
            <span class="history-type">🔗 ${escapeHtml(h.notes || 'Digabung dari produk lain')}</span>
          </li>
        `;
      }
      return `
        <li>
          <span class="history-date">${formatTanggal(h.created_at)}</span>
          <span class="history-type">${movementTypeLabel(h.movement_type)}</span>
          <span class="history-qty">${h.quantity}</span>
        </li>
      `;
    }).join('') + '</ul>';
  }

  let lotsHtml;

  if (p.activeLots === null) {
    lotsHtml = '<p class="history-loading">Memuat data lot...</p>';
  } else if (p.activeLots.length === 0) {
    lotsHtml = '<p class="history-empty">Tidak ada lot aktif.</p>';
  } else {
    // Percakapan [Edit Lot - Batch & Kadaluarsa] - tiap baris lot punya tombol
    // edit sendiri (bisa banyak lot per barang). Kalau lot.id sedang di-edit
    // (EDITING_LOT_ID), baris itu diganti mini-form batch_number + expiry_date.
    // Quantity TIDAK bisa diedit di sini (tetap lewat Stok Fisik/opname).
    lotsHtml = '<ul class="lots-list">' + p.activeLots.map(lot => {
      if (EDITING_LOT_ID === lot.id) {
        return `
          <li class="lot-edit-row" data-lot-id="${lot.id}">
            <div class="lot-edit-form">
              <div class="edit-form-group">
                <label>No. Batch (opsional)</label>
                <input type="text" class="edit-input lot-edit-batch" value="${escapeAttr(lot.batch_number || '')}" placeholder="Kosongkan kalau tidak ada">
              </div>
              <div class="edit-form-group">
                <label>Tanggal Kedaluwarsa (DDMMYYYY, 8 digit)</label>
                <input type="text" class="edit-input lot-edit-expiry" inputmode="numeric" maxlength="8" value="${lot.expiry_date ? formatToDDMMYYYY(lot.expiry_date) : ''}" placeholder="Contoh: 31122026">
              </div>
              <div class="edit-form-actions">
                <button type="button" class="btn-secondary" data-action="cancel-edit-lot">Batal</button>
                <button type="button" class="btn-primary" data-action="save-edit-lot" data-lot-id="${lot.id}">Simpan</button>
              </div>
              <div class="edit-status-message" data-role="lot-edit-status"></div>
            </div>
          </li>
        `;
      }
      return `
        <li>
          <span class="lot-batch">${escapeHtml(lot.batch_number || '(tanpa no. batch)')}</span>
          <span class="lot-expiry">Exp: ${formatTanggal(lot.expiry_date)}</span>
          <span class="lot-qty">${lot.quantity}</span>
          <button type="button" class="btn-edit-lot" data-action="edit-lot" data-lot-id="${lot.id}" aria-label="Edit lot">✏️</button>
        </li>
      `;
    }).join('') + '</ul>';
  }

  const isEditing = EDITING_ITEM_ID === p.id;

  return `
    <div class="expand-fields-view" style="display:${isEditing ? 'none' : 'block'}">
      <div><strong>Kategori:</strong> ${escapeHtml(p.category || '-')}</div>
      <div><strong>Satuan:</strong> ${escapeHtml(p.unit || '-')}</div>
      <div><strong>Lokasi penyimpanan:</strong> ${escapeHtml(p.storage_location || '-')}</div>
      <div><strong>Stok minimum:</strong> ${p.minimum_stock}</div>
      <button type="button" class="btn-edit-item" data-action="edit">✏️ Edit Data Barang</button>
    </div>
    <div class="expand-fields-edit" style="display:${isEditing ? 'block' : 'none'}">
      ${buildEditForm(p)}
    </div>
    <div class="expand-lots">
      <strong>Lot aktif (batch & kadaluarsa)</strong>
      ${lotsHtml}
    </div>
    <div class="expand-history">
      <strong>Riwayat terakhir</strong>
      ${historyHtml}
    </div>
  `;
}

// ============================================
// EDIT DATA BARANG: form inline di dalam expand card
// Field yang bisa diedit: nama, kategori, satuan (label saja), lokasi, stok minimum.
// Jumlah stok TIDAK bisa diedit di sini — diarahkan ke Stok Opname.
// ============================================
function buildEditForm(p) {
  return `
    <div class="edit-form">
      <div class="edit-form-group" style="position:relative;">
        <label>Nama Barang</label>
        <input type="text" class="edit-input" data-field="name" value="${escapeAttr(p.name)}" autocomplete="off">
        <div class="edit-name-results product-search-results" style="display:none;"></div>
      </div>
      <div class="edit-form-group" style="position:relative;">
        <label>Kategori</label>
        <input type="text" class="edit-input" data-field="category" value="${escapeAttr(p.category || '')}" autocomplete="off">
        <div class="edit-category-results product-search-results" style="display:none;"></div>
      </div>
      <div class="edit-form-group" style="position:relative;">
        <label>Satuan</label>
        <input type="text" class="edit-input" data-field="unit" value="${escapeAttr(p.unit || '')}" autocomplete="off">
        <div class="edit-unit-results product-search-results" style="display:none;"></div>
      </div>
      <div class="edit-form-group" style="position:relative;">
        <label>Lokasi Penyimpanan</label>
        <input type="text" class="edit-input" data-field="storage_location" value="${escapeAttr(p.storage_location || '')}" autocomplete="off">
        <div class="edit-location-results product-search-results" style="display:none;"></div>
      </div>
      <div class="edit-form-group">
        <label>Stok Minimum</label>
        <input type="number" class="edit-input" data-field="minimum_stock" value="${p.minimum_stock}" min="0">
      </div>
      <p class="edit-stock-note">Untuk ubah jumlah stok, gunakan menu <strong>Stok Fisik Saat Ini</strong> di halaman Input.</p>
      <div class="edit-form-actions">
        <button type="button" class="btn-secondary" data-action="cancel-edit">Batal</button>
        <button type="button" class="btn-primary" data-action="save-edit">Simpan</button>
      </div>
      <button type="button" class="btn-delete-item" data-action="delete-product">🗑️ Hapus Barang Ini</button>
      <div class="edit-status-message" data-role="edit-status"></div>
    </div>
  `;
}

// Label tampilan untuk movement_type. Fallback ke nilai asli kalau tipe belum dikenal,
// supaya tidak error/tampil kosong kalau ada jenis transaksi baru yang belum kepikiran di sini.
// Catatan: key 'opname_adjustment' sempat tidak ke-mapping sebelumnya (tertulis 'opname') — sudah diperbaiki.
// Percakapan [Selaraskan Istilah Stok Fisik Saat Ini] - label "Opname" (jargon)
// diganti "Stok Fisik", konsisten dengan istilah yang dipakai di halaman Input & Riwayat.
function movementTypeLabel(type) {
  const labels = {
    in: 'Masuk',
    out: 'Keluar',
    opname_adjustment: 'Stok Fisik',
    merge_marker: 'Digabung'
  };
  return labels[type] || escapeHtml(type || '-');
}

function formatTanggal(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ============================================
// TOGGLE EXPAND: buka/tutup card, fetch riwayat on-demand (sekali per produk, lalu di-cache)
// ============================================
async function handleCardToggle(productId) {
  const wasExpanded = EXPANDED_ITEM_ID === productId;
  EXPANDED_ITEM_ID = wasExpanded ? null : productId;

  // Re-render langsung supaya UI terasa responsif (chevron & expand area berubah seketika)
  renderInventaris(inventarisSearchInput.value);

  if (wasExpanded) return; // ditutup, tidak perlu fetch apa-apa

  const product = ALL_INVENTARIS_ITEMS.find(p => p.id === productId);
  if (!product) return;

  // Fetch riwayat transaksi & lot aktif secara paralel (kalau belum ada cache masing-masing)
  const fetchHistory = product.recentHistory === null
    ? supabaseClient
        .from('stock_movements')
        .select('movement_type, quantity, created_at, notes')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(5)
    : null;

  const fetchLots = product.activeLots === null
    ? supabaseClient
        .from('product_lots')
        .select('id, batch_number, expiry_date, quantity')
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('expiry_date', { ascending: true }) // FEFO: paling dekat kadaluarsa duluan
    : null;

  if (!fetchHistory && !fetchLots) return; // keduanya sudah di-cache, tidak perlu query ulang

  const [historyResult, lotsResult] = await Promise.all([
    fetchHistory || Promise.resolve(null),
    fetchLots || Promise.resolve(null)
  ]);

  if (historyResult) {
    if (historyResult.error) {
      console.error('Gagal load riwayat transaksi:', historyResult.error);
      product.recentHistory = []; // tampilkan sebagai kosong daripada macet di "Memuat..."
    } else {
      product.recentHistory = historyResult.data || [];
    }
  }

  if (lotsResult) {
    if (lotsResult.error) {
      console.error('Gagal load data lot:', lotsResult.error);
      product.activeLots = [];
    } else {
      product.activeLots = lotsResult.data || [];
    }
  }

  // Re-render lagi supaya data yang baru di-fetch langsung tampil
  // (hanya kalau card ini masih dalam keadaan terbuka saat fetch selesai)
  if (EXPANDED_ITEM_ID === productId) {
    renderInventaris(inventarisSearchInput.value);
  }
}

// ============================================
// EDIT DATA BARANG: mulai edit, batal, simpan
// ============================================
function handleStartEdit(productId) {
  EDITING_ITEM_ID = productId;
  renderInventaris(inventarisSearchInput.value);
}

function handleCancelEdit(productId) {
  EDITING_ITEM_ID = null;
  renderInventaris(inventarisSearchInput.value);
}

// ============================================
// Percakapan [Edit Lot - Batch & Kadaluarsa] - EDIT LOT: mulai edit, batal, simpan.
// Terpisah dari edit data barang (EDITING_ITEM_ID) karena satu barang bisa
// punya banyak lot aktif. Field yang bisa diedit: batch_number & expiry_date
// saja. Quantity lot TIDAK bisa diedit di sini (tetap lewat Stok Fisik/opname),
// supaya total stok tetap sinkron dengan jejak stock_movements.
// ============================================
function handleStartEditLot(lotId, productId) {
  EDITING_LOT_ID = lotId;
  renderInventaris(inventarisSearchInput.value);
}

function handleCancelEditLot(productId) {
  EDITING_LOT_ID = null;
  renderInventaris(inventarisSearchInput.value);
}

async function handleSaveEditLot(lotId, productId, cardEl) {
  const row = cardEl.querySelector(`.lot-edit-row[data-lot-id="${lotId}"]`);
  if (!row) return;

  const saveBtn = row.querySelector('[data-action="save-edit-lot"]');
  const statusEl = row.querySelector('[data-role="lot-edit-status"]');
  const batchInput = row.querySelector('.lot-edit-batch');
  const expiryInput = row.querySelector('.lot-edit-expiry');

  const batchNumber = batchInput.value.trim();
  const expiryRaw = expiryInput.value.trim();

  // Tanggal boleh dikosongkan (lot tanpa expiry_date, misal alat non-consumable).
  // parseDDMMYYYY() return { valid, isoDate, error } — lihat date-helper.js.
  // Kosong tetap valid (isoDate: null), format salah/tanggal tidak ada di
  // kalender (misal 31 Februari) ditolak dengan pesan error dari helper-nya.
  const parsed = parseDDMMYYYY(expiryRaw);
  if (!parsed.valid) {
    showEditStatus(statusEl, parsed.error, 'error');
    return;
  }
  const expiryDateIso = parsed.isoDate;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Menyimpan...';

  const { data, error } = await supabaseClient.rpc('update_lot_details', {
    p_lot_id: lotId,
    p_batch_number: batchNumber || null,
    p_expiry_date: expiryDateIso
  });

  saveBtn.disabled = false;
  saveBtn.textContent = 'Simpan';

  if (error || !data || data.success !== true) {
    console.error('Gagal simpan perubahan lot:', error || data);
    showEditStatus(statusEl, 'Gagal menyimpan perubahan lot. Coba lagi.', 'error');
    return;
  }

  // Update state lokal langsung (tidak perlu fetch ulang semua lot)
  const product = ALL_INVENTARIS_ITEMS.find(p => p.id === productId);
  if (product && product.activeLots) {
    const lot = product.activeLots.find(l => l.id === lotId);
    if (lot) {
      lot.batch_number = batchNumber || null;
      lot.expiry_date = expiryDateIso;
    }
  }

  EDITING_LOT_ID = null;
  renderInventaris(inventarisSearchInput.value);
}

// ============================================
// Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - HAPUS BARANG
// Soft-delete (is_active=false) lewat RPC soft_delete_product(), supaya
// riwayat stock_movements & product_lots yang mengacu ke produk ini tetap
// utuh. Tombol ini SELALU aktif (tidak ikut terkunci saat CLINIC_LOCKED),
// karena ini satu-satunya jalan keluar dari status locked.
// ============================================
async function handleDeleteProduct(productId, productName, cardEl) {
  const confirmed = confirm(`Hapus "${productName}" dari inventaris?\n\nRiwayat transaksi barang ini tetap tersimpan, tapi barang ini tidak akan muncul lagi di daftar.`);
  if (!confirmed) return;

  const deleteBtn = cardEl.querySelector('[data-action="delete-product"]');
  const statusEl = cardEl.querySelector('[data-role="edit-status"]');
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Menghapus...';
  }

  const { data, error } = await supabaseClient.rpc('soft_delete_product', {
    p_product_id: productId
  });

  if (error || !data || data.success !== true) {
    console.error('Gagal hapus produk:', error || data);
    showEditStatus(statusEl, 'Gagal menghapus barang. Coba lagi.', 'error');
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.textContent = '🗑️ Hapus Barang Ini';
    }
    return;
  }

  // Hapus dari state lokal & tutup mode edit/expand
  ALL_INVENTARIS_ITEMS = ALL_INVENTARIS_ITEMS.filter(p => p.id !== productId);
  EDITING_ITEM_ID = null;
  EXPANDED_ITEM_ID = null;

  // Cek ulang status akses DULU (update LAST_KNOWN_CLINIC_ACCESS & banner
  // global di auth-check.js), baru render -- supaya badge total jenis
  // barang di summary langsung pakai data terbaru, tidak telat 1 render.
  if (typeof checkClinicAccessAndRenderBanner === 'function') {
    await checkClinicAccessAndRenderBanner();
  }

  renderInventaris(inventarisSearchInput.value);
}

async function handleSaveEdit(productId, cardEl) {
  const saveBtn = cardEl.querySelector('[data-action="save-edit"]');
  const statusEl = cardEl.querySelector('[data-role="edit-status"]');

  const getField = (field) => cardEl.querySelector(`.edit-input[data-field="${field}"]`).value.trim();

  const name = getField('name');
  const category = getField('category');
  const unit = getField('unit');
  const storageLocation = getField('storage_location');
  const minimumStockRaw = getField('minimum_stock');
  const minimumStock = minimumStockRaw === '' ? 0 : parseFloat(minimumStockRaw);

  if (!name) {
    showEditStatus(statusEl, 'Nama barang tidak boleh kosong.', 'error');
    return;
  }

  if (isNaN(minimumStock) || minimumStock < 0) {
    showEditStatus(statusEl, 'Stok minimum harus angka 0 atau lebih.', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Menyimpan...';

  const { error } = await supabaseClient
    .from('products')
    .update({
      name: name,
      category: category,
      unit: unit,
      storage_location: storageLocation,
      minimum_stock: minimumStock
    })
    .eq('id', productId)
    .eq('clinic_id', CURRENT_CLINIC_ID);

  saveBtn.disabled = false;
  saveBtn.textContent = 'Simpan';

  if (error) {
    console.error('Gagal simpan perubahan produk:', error);
    showEditStatus(statusEl, 'Gagal menyimpan: ' + error.message, 'error');
    return;
  }

  // Update data lokal langsung (tidak perlu fetch ulang semua produk)
  const product = ALL_INVENTARIS_ITEMS.find(p => p.id === productId);
  if (product) {
    product.name = name;
    product.category = category;
    product.unit = unit;
    product.storage_location = storageLocation;
    product.minimum_stock = minimumStock;
    product.status = getStockStatus(product.current_stock, product.minimum_stock);
  }

  EDITING_ITEM_ID = null;
  renderInventaris(inventarisSearchInput.value);
}

function showEditStatus(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = 'edit-status-message edit-status-' + type;
}

// ============================================
// GABUNGKAN BARANG (MERGE)
// Alur: toggle mode pilih -> pilih tepat 2 card -> validasi satuan & hitung
// riwayat transaksi tiap produk -> tentukan survivor otomatis -> tampilkan
// modal konfirmasi -> panggil RPC merge_products() -> reload data.
// ============================================
function handleToggleMergeMode() {
  SELECTION_MODE = !SELECTION_MODE;
  SELECTED_IDS.clear();
  EXPANDED_ITEM_ID = null; // tutup expand card yang mungkin lagi kebuka, biar tidak membingungkan

  toggleMergeModeBtn.textContent = SELECTION_MODE ? 'Batal Pilih' : '🔗 Gabungkan Barang';
  confirmMergeBtn.style.display = 'none';
  hideMergeStatus();

  renderInventaris(inventarisSearchInput.value);
}

function exitSelectionMode() {
  SELECTION_MODE = false;
  SELECTED_IDS.clear();
  toggleMergeModeBtn.textContent = '🔗 Gabungkan Barang';
  confirmMergeBtn.style.display = 'none';
  renderInventaris(inventarisSearchInput.value);
}

function handleToggleSelect(productId) {
  if (SELECTED_IDS.has(productId)) {
    SELECTED_IDS.delete(productId);
  } else {
    if (SELECTED_IDS.size >= 2) {
      showMergeStatus('Pilih maksimal 2 barang untuk digabungkan.', 'error');
      return;
    }
    SELECTED_IDS.add(productId);
  }

  confirmMergeBtn.style.display = SELECTED_IDS.size === 2 ? 'inline-block' : 'none';
  hideMergeStatus();
  renderInventaris(inventarisSearchInput.value);
}

async function handleMergeClick() {
  if (SELECTED_IDS.size !== 2) return;

  const [idA, idB] = Array.from(SELECTED_IDS);
  const productA = ALL_INVENTARIS_ITEMS.find(p => p.id === idA);
  const productB = ALL_INVENTARIS_ITEMS.find(p => p.id === idB);
  if (!productA || !productB) return;

  // Validasi satuan di sisi client dulu (function di database juga akan cek ulang sebagai jaring pengaman terakhir)
  if ((productA.unit || '') !== (productB.unit || '')) {
    showMergeStatus(
      `Kedua barang punya satuan berbeda (${productA.unit || '-'} vs ${productB.unit || '-'}). Ubah dulu satuan salah satu barang lewat Edit Data Barang, baru coba gabungkan lagi.`,
      'error'
    );
    return;
  }

  confirmMergeBtn.disabled = true;
  confirmMergeBtn.textContent = 'Memeriksa...';

  // Hitung jumlah riwayat transaksi masing-masing produk, untuk tentukan survivor otomatis
  const { data: movementsData, error: countError } = await supabaseClient
    .from('stock_movements')
    .select('product_id')
    .in('product_id', [idA, idB]);

  confirmMergeBtn.disabled = false;
  confirmMergeBtn.textContent = 'Gabungkan (2)';

  if (countError) {
    console.error('Gagal menghitung riwayat transaksi:', countError);
    showMergeStatus('Gagal memeriksa data. Coba lagi.', 'error');
    return;
  }

  const countA = (movementsData || []).filter(m => m.product_id === idA).length;
  const countB = (movementsData || []).filter(m => m.product_id === idB).length;

  let survivor, merged, survivorCount, mergedCount;

  if (countA > countB) {
    survivor = productA; merged = productB; survivorCount = countA; mergedCount = countB;
  } else if (countB > countA) {
    survivor = productB; merged = productA; survivorCount = countB; mergedCount = countA;
  } else {
    // Jumlah riwayat sama -> yang dibuat lebih dulu (created_at lebih awal) jadi survivor
    const aOlder = (productA.created_at || '') <= (productB.created_at || '');
    survivor = aOlder ? productA : productB;
    merged = aOlder ? productB : productA;
    survivorCount = aOlder ? countA : countB;
    mergedCount = aOlder ? countB : countA;
  }

  openMergeConfirmModal(survivor, merged, survivorCount, mergedCount);
}

function openMergeConfirmModal(survivor, merged, survivorCount, mergedCount) {
  const totalStock = Number(survivor.current_stock) + Number(merged.current_stock);

  mergeConfirmBody.innerHTML = `
    <p class="merge-direction">
      <span class="merge-direction-from">${escapeHtml(merged.name)}</span>
      <span class="merge-direction-arrow">→</span>
      <span class="merge-direction-to">${escapeHtml(survivor.name)}</span>
    </p>
    <p>Barang <strong>${escapeHtml(merged.name)}</strong> (${mergedCount} riwayat transaksi) akan digabung ke <strong>${escapeHtml(survivor.name)}</strong> (${survivorCount} riwayat transaksi) — dipilih otomatis karena riwayat transaksinya lebih banyak/lebih lama dipakai.</p>
    <p>Kategori hasil gabungan: <strong>${escapeHtml(survivor.category || '-')}</strong></p>
    <p>Lokasi hasil gabungan: <strong>${escapeHtml(survivor.storage_location || '-')}</strong></p>
    <p>Total stok setelah gabung: <strong>${totalStock} ${escapeHtml(survivor.unit || '')}</strong></p>
    <p class="merge-note-edit">Nama/kategori/lokasi hasil gabungan bisa diubah lagi kapan saja lewat Edit Data Barang setelah ini.</p>
    <p class="merge-warning">Aksi gabung ini sendiri tidak bisa dibatalkan.</p>
  `;

  mergeConfirmModal.dataset.survivorId = survivor.id;
  mergeConfirmModal.dataset.mergedId = merged.id;
  mergeConfirmModal.style.display = 'flex';
}

// ============================================
// Percakapan [Cek Barang Mirip (AI)] - saran pasangan barang duplikat
// via edge function suggest-merge-candidates. Reuse SELECTED_IDS +
// handleMergeClick() yang sudah ada untuk alur konfirmasi & eksekusi
// gabung -- tidak duplikasi logic penentuan survivor.
// ============================================
async function handleSuggestMergeClick() {
  suggestMergeBtn.disabled = true;
  suggestMergeBtn.textContent = 'Menganalisis...';
  hideSuggestMergeStatus();
  suggestMergeSection.style.display = 'none';
  suggestMergeList.innerHTML = '';

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
      showSuggestMergeStatus('Sesi login sudah habis, silakan login ulang.', 'error');
      return;
    }

    const response = await fetch(
      `${window.SUPABASE_URL || SUPABASE_URL}/functions/v1/suggest-merge-candidates`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': window.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ clinic_id: CURRENT_CLINIC_ID })
      }
    );

    const result = await response.json();

    if (response.status === 429 && result.error === 'quota_exceeded') {
      showSuggestMergeStatus(
        `Kuota AI klinik ini sudah habis (${result.used}/${result.limit} bulan ini). Kamu tetap bisa gabungkan barang secara manual lewat "🔗 Gabungkan Barang".`,
        'error'
      );
      return;
    }

    if (!response.ok) {
      showSuggestMergeStatus(result.error || 'Gagal menganalisis barang. Coba lagi.', 'error');
      return;
    }

    await renderSuggestMergeCandidates(result.candidates || []);

  } catch (err) {
    console.error('Gagal cek barang mirip:', err);
    showSuggestMergeStatus('Terjadi kesalahan jaringan. Coba lagi.', 'error');
  } finally {
    suggestMergeBtn.disabled = false;
    suggestMergeBtn.textContent = '🤖 Cek Barang Mirip (AI)';
  }
}

async function renderSuggestMergeCandidates(candidates) {
  if (candidates.length === 0) {
    showSuggestMergeStatus('Tidak ditemukan barang yang kemungkinan sama saat ini. 👍', 'success');
    return;
  }

  suggestMergeSection.style.display = 'block';

  // Percakapan [Cek Barang Mirip (AI)] - tampilkan dulu kartu tanpa
  // badge survivor (biar user tidak menunggu), lalu isi badge-nya
  // begitu hasil hitung riwayat transaksi selesai per kartu.
  suggestMergeList.innerHTML = candidates.map((c, index) => `
    <div class="suggest-merge-card" data-index="${index}">
      <p class="suggest-merge-pair">
        <strong>${escapeHtml(c.nama_a)}</strong> &harr; <strong>${escapeHtml(c.nama_b)}</strong>
      </p>
      <p class="suggest-merge-reason">${escapeHtml(c.alasan || '')}</p>
      <p class="suggest-merge-survivor-hint" data-role="survivor-hint">Menghitung barang mana yang bakal jadi utama...</p>
      <div class="suggest-merge-actions">
        <button type="button" class="btn-secondary suggest-merge-dismiss" data-index="${index}">Bukan Barang Sama</button>
        <button type="button" class="btn-primary suggest-merge-confirm" data-index="${index}">Tinjau & Gabungkan</button>
      </div>
    </div>
  `).join('');

  suggestMergeList.querySelectorAll('.suggest-merge-dismiss').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.suggest-merge-card').remove();
      if (suggestMergeList.children.length === 0) {
        suggestMergeSection.style.display = 'none';
      }
    });
  });

  suggestMergeList.querySelectorAll('.suggest-merge-confirm').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.dataset.index, 10);
      const candidate = candidates[index];
      // Percakapan [Cek Barang Mirip (AI)] - hilangkan kartu ini SEGERA
      // setelah diklik, supaya user tahu kartu mana yang sudah ditinjau
      // (tidak menunggu sampai modal konfirmasi selesai/dibatalkan).
      btn.closest('.suggest-merge-card').remove();
      if (suggestMergeList.children.length === 0) {
        suggestMergeSection.style.display = 'none';
      }
      handleReviewSuggestedPair(candidate);
    });
  });

  // Isi badge prediksi survivor per kartu, paralel semua kartu sekaligus
  candidates.forEach((c, index) => {
    fillSurvivorHint(c, index);
  });
}

// Percakapan [Cek Barang Mirip (AI)] - hitung BETULAN (bukan cuma
// prediksi) siapa yang bakal jadi survivor kalau pasangan ini digabung,
// pakai logic SAMA PERSIS dengan handleMergeClick() (jumlah riwayat
// transaksi, fallback ke created_at lebih awal). Ditampilkan sebagai
// hint di kartu SEBELUM user klik apapun, supaya user tidak bingung
// arah gabungnya sebelum memutuskan untuk menindaklanjuti kartu ini.
async function fillSurvivorHint(candidate, index) {
  const card = suggestMergeList.querySelector(`.suggest-merge-card[data-index="${index}"]`);
  if (!card) return; // kartu sudah dihapus (dismiss/confirm) sebelum hint selesai dihitung

  const hintEl = card.querySelector('[data-role="survivor-hint"]');
  if (!hintEl) return;

  const productA = ALL_INVENTARIS_ITEMS.find(p => p.name === candidate.nama_a);
  const productB = ALL_INVENTARIS_ITEMS.find(p => p.name === candidate.nama_b);

  if (!productA || !productB) {
    hintEl.textContent = 'Salah satu barang sudah tidak ada lagi.';
    return;
  }

  const { data: movementsData, error } = await supabaseClient
    .from('stock_movements')
    .select('product_id')
    .in('product_id', [productA.id, productB.id]);

  // Kartu mungkin sudah dihapus user selagi query ini jalan -- cek lagi.
  if (!suggestMergeList.querySelector(`.suggest-merge-card[data-index="${index}"]`)) return;

  if (error) {
    hintEl.textContent = '';
    return;
  }

  const countA = (movementsData || []).filter(m => m.product_id === productA.id).length;
  const countB = (movementsData || []).filter(m => m.product_id === productB.id).length;

  let survivorName, mergedName;
  if (countA > countB) {
    survivorName = productA.name; mergedName = productB.name;
  } else if (countB > countA) {
    survivorName = productB.name; mergedName = productA.name;
  } else {
    const aOlder = (productA.created_at || '') <= (productB.created_at || '');
    survivorName = aOlder ? productA.name : productB.name;
    mergedName = aOlder ? productB.name : productA.name;
  }

  hintEl.innerHTML = `↳ Kalau digabung: <strong>${escapeHtml(mergedName)}</strong> → <strong>${escapeHtml(survivorName)}</strong> (jadi nama utama)`;
}

// Percakapan [Cek Barang Mirip (AI)] - cari product id dari nama (hasil
// AI berupa nama, bukan id), lalu reuse SELECTION_MODE + SELECTED_IDS +
// handleMergeClick() yang SUDAH ADA -- supaya validasi satuan, hitung
// riwayat transaksi, penentuan survivor, dan modal konfirmasi semuanya
// pakai jalur yang sama persis dengan gabung manual (tidak ada logic
// gabung yang terpisah/duplikat untuk jalur AI ini).
function handleReviewSuggestedPair(candidate) {
  const productA = ALL_INVENTARIS_ITEMS.find(p => p.name === candidate.nama_a);
  const productB = ALL_INVENTARIS_ITEMS.find(p => p.name === candidate.nama_b);

  if (!productA || !productB) {
    showSuggestMergeStatus('Salah satu barang sudah tidak ada lagi (mungkin baru saja diubah/dihapus). Coba cek ulang.', 'error');
    return;
  }

  if (!SELECTION_MODE) {
    handleToggleMergeMode();
  }
  SELECTED_IDS.clear();
  SELECTED_IDS.add(productA.id);
  SELECTED_IDS.add(productB.id);
  confirmMergeBtn.style.display = 'inline-block';

  renderInventaris(inventarisSearchInput.value);

  // Percakapan [Fix Auto-scroll Tinjau & Gabungkan] - LANGSUNG buka modal
  // konfirmasi (reuse handleMergeClick(), sama dengan alur gabung manual),
  // BUKAN scroll ke daftar barang. Kedua barang bisa saja ada di halaman
  // pagination berbeda -- scroll ke list tidak menjamin user lihat
  // keduanya. Modal (position:fixed, menutupi layar) sudah menampilkan
  // jelas arah gabung tanpa bergantung posisi scroll/halaman sama sekali.
  handleMergeClick();
}

function showSuggestMergeStatus(message, type) {
  suggestMergeStatus.textContent = message;
  suggestMergeStatus.className = 'status-message status-' + type;
  suggestMergeStatus.style.display = 'block';
}

function hideSuggestMergeStatus() {
  suggestMergeStatus.style.display = 'none';
}

function closeMergeConfirmModal() {
  mergeConfirmModal.style.display = 'none';
  mergeConfirmModal.dataset.survivorId = '';
  mergeConfirmModal.dataset.mergedId = '';
}

async function executeMerge() {
  const survivorId = mergeConfirmModal.dataset.survivorId;
  const mergedId = mergeConfirmModal.dataset.mergedId;
  if (!survivorId || !mergedId) return;

  mergeExecuteBtn.disabled = true;
  mergeExecuteBtn.textContent = 'Menggabungkan...';

  const { data: userData, error: userError } = await supabaseClient.auth.getUser();

  if (userError || !userData?.user) {
    console.error('Gagal ambil data user:', userError);
    mergeExecuteBtn.disabled = false;
    mergeExecuteBtn.textContent = 'Ya, Gabungkan';
    showMergeStatus('Gagal mengambil data akun. Coba login ulang.', 'error');
    return;
  }

  const { data, error } = await supabaseClient.rpc('merge_products', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_survivor_id: survivorId,
    p_merged_id: mergedId,
    p_user_id: userData.user.id
  });

  mergeExecuteBtn.disabled = false;
  mergeExecuteBtn.textContent = 'Ya, Gabungkan';

  if (error) {
    console.error('Gagal menggabungkan produk:', error);
    showMergeStatus('Gagal menggabungkan: ' + error.message, 'error');
    return;
  }

  closeMergeConfirmModal();
  exitSelectionMode();

  const resultRow = Array.isArray(data) ? data[0] : null;
  const survivorName = resultRow?.survivor_name || 'produk';
  const finalStock = resultRow?.final_stock ?? '-';

  showMergeStatus(`Berhasil digabungkan ke "${survivorName}". Stok akhir: ${finalStock}.`, 'success');

  await loadInventaris(); // reload supaya produk yang sudah dihapus tidak tampil lagi
}

function showMergeStatus(message, type) {
  mergeStatus.textContent = message;
  mergeStatus.className = 'status-message status-' + type;
  mergeStatus.style.display = 'block';
}

function hideMergeStatus() {
  mergeStatus.style.display = 'none';
}

// ============================================
// PAGINATION: render angka halaman "1 2 3 ... 24"
// ============================================
function renderPagination(totalPages) {
  if (totalPages <= 1) {
    inventarisPagination.innerHTML = '';
    return;
  }

  const pageNumbers = buildPageNumberList(CURRENT_PAGE, totalPages);

  inventarisPagination.innerHTML = pageNumbers.map(p => {
    if (p === '...') return '<span class="page-ellipsis">...</span>';
    const activeClass = p === CURRENT_PAGE ? ' active' : '';
    return `<button class="page-number${activeClass}" data-page="${p}">${p}</button>`;
  }).join('');

  inventarisPagination.querySelectorAll('.page-number').forEach(btn => {
    btn.addEventListener('click', () => {
      CURRENT_PAGE = parseInt(btn.dataset.page, 10);
      renderInventaris(inventarisSearchInput.value);
      inventarisList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// Bikin daftar nomor halaman dengan "..." untuk halaman yang banyak.
// Contoh hasil untuk currentPage=1, totalPages=24: [1,2,3,4,5,'...',24]
function buildPageNumberList(currentPage, totalPages) {
  const delta = 2; // berapa banyak angka di kiri-kanan halaman aktif yang ditampilkan penuh
  const range = [];
  const rangeWithDots = [];
  let lastPage;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
      range.push(i);
    }
  }

  range.forEach(i => {
    if (lastPage) {
      if (i - lastPage === 2) {
        rangeWithDots.push(lastPage + 1);
      } else if (i - lastPage > 2) {
        rangeWithDots.push('...');
      }
    }
    rangeWithDots.push(i);
    lastPage = i;
  });

  return rangeWithDots;
}

function renderSummary(items) {
  const totalCount = ALL_INVENTARIS_ITEMS.length; // total keseluruhan, TIDAK ikut berubah saat search/filter
  const totalLine = buildTotalCountLine(totalCount);

  const kritisCount = items.filter(p => p.status === 'kritis').length;
  const menipisCount = items.filter(p => p.status === 'menipis').length;

  if (kritisCount === 0 && menipisCount === 0) {
    inventarisSummary.innerHTML = `${totalLine}<p class="summary-ok">✅ Semua stok dalam kondisi baik.</p>`;
    return;
  }

  let parts = [];
  if (kritisCount > 0) parts.push(`🔴 ${kritisCount} kritis`);
  if (menipisCount > 0) parts.push(`🟡 ${menipisCount} menipis`);

  inventarisSummary.innerHTML = `${totalLine}<p class="summary-warning">${parts.join(' · ')}</p>`;
}

// ============================================
// Percakapan [Fix Badge Jumlah Barang Premium] - BADGE TOTAL (v2)
// Pakai LAST_KNOWN_CLINIC_ACCESS (diisi checkClinicAccessAndRenderBanner
// di clinic-access.js) untuk tahu max_products klinik ini. Kalau belum
// sempat terisi (auth-check belum jalan / RPC gagal), tampilkan total
// polos tanpa batas -- tidak memblokir apa pun, cuma teks saja.
//
// PERUBAHAN dari versi sebelumnya: badge TIDAK LAGI menampilkan
// "X dari 70 jenis barang" untuk siapa pun (premium maupun free).
// Sekarang selalu "X jenis barang" polos, KECUALI kalau akun free
// sudah mendekati batas (>=85% dari max_products free) -- baru muncul
// catatan tambahan di bawahnya. Batas keras (hard block) tetap
// ditangani terpisah oleh check_product_limit saat submit barang baru
// (lihat app.js/foto.js/suara.js), tidak berubah sama sekali di sini.
// ============================================
function buildTotalCountLine(totalCount) {
  const access = (typeof LAST_KNOWN_CLINIC_ACCESS !== 'undefined') ? LAST_KNOWN_CLINIC_ACCESS : null;
  const isFreeLimit = access && access.max_products && access.max_products < 999999;

  if (isFreeLimit) {
    const nearLimit = totalCount >= access.max_products * 0.85; // ambang 85% dari batas free

    if (nearLimit) {
      const sisa = Math.max(0, access.max_products - totalCount);
      return `
        <p class="summary-total near-limit">📦 ${totalCount} jenis barang</p>
        <p class="summary-near-limit-note">⚠️ Mendekati batas ${access.max_products} jenis barang untuk akun Free (sisa ${sisa}).</p>
      `;
    }
  }

  return `<p class="summary-total">📦 ${totalCount} jenis barang</p>`;
}

// Basic escape untuk mencegah HTML injection dari nama barang
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Escape untuk dipakai di dalam atribut HTML (value="...")
function escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================
// Percakapan [P11] - EXPORT PDF (Laporan Snapshot Stok)
// Pakai pdf-lib (dimuat via CDN di inventaris.html), semua proses di browser,
// tidak ada data yang dikirim ke server manapun untuk pembuatan PDF ini.
//
// Data yang di-export = hasil filter pencarian yang sedang aktif & sortir
// yang sedang dipilih (bukan cuma 20 item di halaman aktif — SEMUA hasil filter),
// supaya laporan tetap lengkap walau UI-nya lagi di halaman pagination tertentu.
// ============================================
const PAGE_WIDTH = 595.28;  // A4 dalam points
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const ROW_HEIGHT = 20;
const COL_X = { nama: MARGIN, kategori: 220, stok: 340, minimum: 400, status: 460, lokasi: 520 };

async function handleExportPdf() {
  // Percakapan [Export PDF - Fitur Premium] - Export PDF adalah fitur
  // khusus Premium. Baca LAST_KNOWN_CLINIC_ACCESS.tier (sudah diisi
  // clinic-access.js sebelum onPageReady berjalan, sama seperti pola
  // yang dipakai banner upgrade di ringkasan.js). TIDAK memanggil RPC
  // baru -- tier yang dibaca di sini sudah otomatis benar walau klinik
  // premium-nya sudah expired, karena check_clinic_access sudah pakai
  // get_clinic_tier() yang mempertimbangkan expires_at.
  if (!LAST_KNOWN_CLINIC_ACCESS || LAST_KNOWN_CLINIC_ACCESS.tier !== 'premium') {
    showExportPremiumGate();
    return;
  }

  exportPdfBtn.disabled = true;
  exportPdfBtn.textContent = 'Membuat PDF...';
  hideExportStatus();

  try {
    const searchTerm = inventarisSearchInput.value.trim().toLowerCase();
    let dataToExport = searchTerm === ''
      ? ALL_INVENTARIS_ITEMS
      : ALL_INVENTARIS_ITEMS.filter(p => p.name.toLowerCase().includes(searchTerm));
    dataToExport = applySorting(dataToExport);

    if (dataToExport.length === 0) {
      showExportStatus('Tidak ada data untuk di-export.', 'error');
      return;
    }

    const pdfBytes = await buildInventarisPdf(dataToExport);
    downloadPdfBytes(pdfBytes, buildExportFilename());

    showExportStatus(`Laporan berhasil dibuat (${dataToExport.length} barang).`, 'success');
  } catch (error) {
    console.error('Gagal membuat PDF:', error);
    showExportStatus('Gagal membuat PDF: ' + error.message, 'error');
  } finally {
    exportPdfBtn.disabled = false;
    exportPdfBtn.textContent = 'Export PDF';
  }
}

async function buildInventarisPdf(items) {
  const { PDFDocument, rgb, StandardFonts } = PDFLib;

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = drawPageHeader(page, fontBold, font, items.length);

  // Header kolom tabel
  y -= 10;
  y = drawTableHeader(page, fontBold, y);

  for (const item of items) {
    // Kalau sudah mepet ke bawah halaman, buat halaman baru dan gambar ulang header tabel
    if (y < MARGIN + ROW_HEIGHT) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      y = drawTableHeader(page, fontBold, y);
    }

    drawItemRow(page, font, y, item);
    y -= ROW_HEIGHT;
  }

  return pdfDoc.save();
}

function drawPageHeader(page, fontBold, font, totalItems) {
  const { rgb } = PDFLib;
  let y = PAGE_HEIGHT - MARGIN;

  page.drawText('Laporan Stok Barang - StockDental', {
    x: MARGIN, y, size: 16, font: fontBold, color: rgb(0.1, 0.1, 0.1)
  });
  y -= 20;

  const tanggalCetak = new Date().toLocaleDateString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  page.drawText(`Dicetak: ${tanggalCetak}  |  Total barang: ${totalItems}`, {
    x: MARGIN, y, size: 10, font, color: rgb(0.4, 0.4, 0.4)
  });
  y -= 20;

  return y;
}

function drawTableHeader(page, fontBold, y) {
  const { rgb } = PDFLib;

  page.drawRectangle({
    x: MARGIN, y: y - 4, width: PAGE_WIDTH - MARGIN * 2, height: ROW_HEIGHT,
    color: rgb(0.9, 0.9, 0.9)
  });

  const headerY = y;
  page.drawText('Nama', { x: COL_X.nama + 4, y: headerY, size: 9, font: fontBold });
  page.drawText('Kategori', { x: COL_X.kategori, y: headerY, size: 9, font: fontBold });
  page.drawText('Stok', { x: COL_X.stok, y: headerY, size: 9, font: fontBold });
  page.drawText('Min', { x: COL_X.minimum, y: headerY, size: 9, font: fontBold });
  page.drawText('Status', { x: COL_X.status, y: headerY, size: 9, font: fontBold });

  return y - ROW_HEIGHT;
}

function drawItemRow(page, font, y, item) {
  const { rgb } = PDFLib;

  // Warna teks status biar cepat kelihatan yang perlu perhatian
  const statusColor = item.status === 'kritis' ? rgb(0.8, 0.1, 0.1)
    : item.status === 'menipis' ? rgb(0.8, 0.55, 0) : rgb(0.1, 0.6, 0.2);
  const statusLabel = item.status === 'kritis' ? 'Kritis' : item.status === 'menipis' ? 'Menipis' : 'Normal';

  // Nama barang dipotong kalau kepanjangan, supaya tidak tabrakan dengan kolom kategori
  const namaText = truncateText(item.name, 34);

  page.drawText(namaText, { x: COL_X.nama + 4, y, size: 9, font, color: rgb(0, 0, 0) });
  page.drawText(truncateText(item.category || '-', 18), { x: COL_X.kategori, y, size: 9, font });
  page.drawText(`${item.current_stock} ${item.unit}`, { x: COL_X.stok, y, size: 9, font });
  page.drawText(`${item.minimum_stock}`, { x: COL_X.minimum, y, size: 9, font });
  page.drawText(statusLabel, { x: COL_X.status, y, size: 9, font, color: statusColor });
}

// Potong teks panjang + tambah "..." biar tidak keluar dari lebar kolom PDF
function truncateText(text, maxChars) {
  if (!text) return '-';
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
}

function buildExportFilename() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `laporan-stok-stockdental-${yyyy}-${mm}-${dd}.pdf`;
}

// Trigger download file PDF ke perangkat user (tanpa upload/server apapun)
function downloadPdfBytes(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function showExportStatus(message, type) {
  exportStatus.textContent = message;
  exportStatus.className = 'status-message status-' + type;
  exportStatus.style.display = 'block';
}

// Percakapan [Export PDF - Fitur Premium] - pakai innerHTML (bukan
// showExportStatus yang textContent-only) supaya bisa sisipkan tombol
// langsung ke upgrade.html, sesuai pola clinicLockedBanner di
// clinic-access.js.
function showExportPremiumGate() {
  exportStatus.className = 'status-message status-error';
  exportStatus.innerHTML = `
    Export PDF adalah fitur Premium.
    <button type="button" onclick="window.location.href='upgrade.html'"
      style="margin-left:8px;padding:4px 10px;border-radius:6px;border:none;background:var(--color-accent);color:#fff;font-weight:600;cursor:pointer;">
      Lihat Premium
    </button>
  `;
  exportStatus.style.display = 'block';
}

function hideExportStatus() {
  exportStatus.style.display = 'none';
}

// ============================================
// Percakapan [Daftar Belanja] - user bisa checklist barang (diurutkan status
// kritis > menipis > normal, reuse applySorting/statusPriority yang sudah ada)
// dan isi "Jumlah kebutuhan" per barang, lalu generate teks siap-copas untuk
// dikirim lewat WA/email. Nama klinik diambil dari tabel `clinics` via
// CURRENT_CLINIC_ID (variabel global yang sudah dipakai loadInventaris()).
// Tidak menyentuh RPC/skema baru — murni baca data yang sudah ada di
// ALL_INVENTARIS_ITEMS + 1 query ringan ke tabel clinics untuk nama klinik.
// ============================================

const daftarBelanjaBtn = document.getElementById('daftarBelanjaBtn');
const daftarBelanjaModal = document.getElementById('daftarBelanjaModal');
const daftarBelanjaSearchInput = document.getElementById('daftarBelanjaSearchInput');
const daftarBelanjaList = document.getElementById('daftarBelanjaList');
const daftarBelanjaCloseBtn = document.getElementById('daftarBelanjaCloseBtn');
const daftarBelanjaGenerateBtn = document.getElementById('daftarBelanjaGenerateBtn');
const daftarBelanjaAiBtn = document.getElementById('daftarBelanjaAiBtn');
const daftarBelanjaAiStatus = document.getElementById('daftarBelanjaAiStatus');
const daftarBelanjaStatus = document.getElementById('daftarBelanjaStatus');
const daftarBelanjaResultSection = document.getElementById('daftarBelanjaResultSection');
const daftarBelanjaResultText = document.getElementById('daftarBelanjaResultText');
const daftarBelanjaCopyBtn = document.getElementById('daftarBelanjaCopyBtn');
const daftarBelanjaCopyStatus = document.getElementById('daftarBelanjaCopyStatus');

// Map product id -> jumlah kebutuhan yang sudah diisi user (bertahan selama modal terbuka,
// termasuk saat user ganti keyword pencarian, supaya centang tidak hilang)
let DAFTAR_BELANJA_QTY = new Map();
let DAFTAR_BELANJA_REASONING = new Map(); // product_id -> reasoning_short dari hasil AI (Isi Otomatis)
let DAFTAR_BELANJA_CLINIC_NAME = null; // cache, supaya tidak query ulang tiap buka modal

function setupDaftarBelanja() {
  daftarBelanjaBtn.addEventListener('click', openDaftarBelanjaModal);
  daftarBelanjaCloseBtn.addEventListener('click', closeDaftarBelanjaModal);
  daftarBelanjaGenerateBtn.addEventListener('click', handleGenerateDaftarBelanja);
  daftarBelanjaAiBtn.addEventListener('click', handleIsiOtomatisAI);
  daftarBelanjaCopyBtn.addEventListener('click', handleCopyDaftarBelanja);

  daftarBelanjaSearchInput.addEventListener('input', () => {
    renderDaftarBelanjaList(daftarBelanjaSearchInput.value);
  });

  // Klik di luar modal-box (area overlay gelap) = tutup modal, konsisten dengan pola mergeConfirmModal
  daftarBelanjaModal.addEventListener('click', (e) => {
    if (e.target === daftarBelanjaModal) closeDaftarBelanjaModal();
  });
}

function openDaftarBelanjaModal() {
  DAFTAR_BELANJA_QTY = new Map();
  DAFTAR_BELANJA_REASONING = new Map();
  daftarBelanjaSearchInput.value = '';
  hideDaftarBelanjaStatus();
  hideDaftarBelanjaAiStatus();
  daftarBelanjaResultSection.style.display = 'none';
  daftarBelanjaCopyStatus.style.display = 'none';
  daftarBelanjaAiBtn.disabled = true;

  renderDaftarBelanjaList('');
  daftarBelanjaModal.style.display = 'flex';
}

function closeDaftarBelanjaModal() {
  daftarBelanjaModal.style.display = 'none';
}

// List barang di dalam modal: urut status (reuse applySorting yang sama dengan halaman utama),
// bisa difilter pencarian nama, terpisah dari search box halaman utama.
function renderDaftarBelanjaList(keyword) {
  const searchTerm = keyword.trim().toLowerCase();

  let items = searchTerm === ''
    ? ALL_INVENTARIS_ITEMS
    : ALL_INVENTARIS_ITEMS.filter(p => p.name.toLowerCase().includes(searchTerm));

  // Urut berdasarkan status (kritis > menipis > normal), lepas dari CURRENT_SORT
  // halaman utama -- daftar belanja selalu prioritaskan barang yang butuh perhatian dulu.
  items = [...items].sort((a, b) => {
    const priorityDiff = statusPriority(a.status) - statusPriority(b.status);
    if (priorityDiff !== 0) return priorityDiff;
    return a.name.localeCompare(b.name);
  });

  if (items.length === 0) {
    daftarBelanjaList.innerHTML = '<p class="loading-text">Tidak ada barang ditemukan.</p>';
    return;
  }

  daftarBelanjaList.innerHTML = items.map(p => buildDaftarBelanjaRow(p)).join('');

  // Event listener per baris (checkbox toggle + input qty)
  daftarBelanjaList.querySelectorAll('.db-row').forEach(row => {
    const productId = row.dataset.productId;
    const checkbox = row.querySelector('.db-checkbox');
    const qtyInput = row.querySelector('.db-qty-input');

    checkbox.addEventListener('change', () => {
      const qtyGroup = row.querySelector('.db-qty-group');
      if (checkbox.checked) {
        qtyGroup.style.display = 'flex';
        if (!DAFTAR_BELANJA_QTY.has(productId)) DAFTAR_BELANJA_QTY.set(productId, '');
        qtyInput.focus();
      } else {
        qtyGroup.style.display = 'none';
        DAFTAR_BELANJA_QTY.delete(productId);
        DAFTAR_BELANJA_REASONING.delete(productId);
      }
      updateDaftarBelanjaAiBtnState();
    });

    if (qtyInput) {
      qtyInput.addEventListener('input', () => {
        DAFTAR_BELANJA_QTY.set(productId, qtyInput.value);
      });
    }
  });

  updateDaftarBelanjaAiBtnState();
}

// Tombol "Isi Otomatis (AI)" hanya aktif kalau minimal 1 barang tercentang
function updateDaftarBelanjaAiBtnState() {
  daftarBelanjaAiBtn.disabled = DAFTAR_BELANJA_QTY.size === 0;
}

function buildDaftarBelanjaRow(p) {
  const badgeLabel = p.status === 'kritis' ? 'Kritis' : p.status === 'menipis' ? 'Menipis' : 'Normal';
  const isChecked = DAFTAR_BELANJA_QTY.has(p.id);
  const currentQty = DAFTAR_BELANJA_QTY.get(p.id) || '';
  const reasoning = DAFTAR_BELANJA_REASONING.get(p.id) || '';

  return `
    <div class="db-row" data-product-id="${p.id}">
      <div class="db-row-main">
        <input type="checkbox" class="db-checkbox" ${isChecked ? 'checked' : ''}>
        <div class="db-row-info">
          <span class="db-row-name">${escapeHtml(p.name)}</span>
          <span class="inventaris-badge badge-${p.status}">${badgeLabel}</span>
        </div>
      </div>
      <div class="db-row-detail">Stok saat ini: ${p.current_stock} ${escapeHtml(p.unit)} (min: ${p.minimum_stock})</div>
      <div class="db-qty-group" style="display:${isChecked ? 'flex' : 'none'}">
        <label>Jumlah kebutuhan</label>
        <input type="number" class="db-qty-input" min="0" step="any" inputmode="decimal"
          placeholder="Contoh: 2" value="${escapeAttr(currentQty)}">
        <span class="db-qty-unit">${escapeHtml(p.unit)}</span>
      </div>
      ${reasoning ? `<span class="db-reasoning">🤖 ${escapeHtml(reasoning)}</span>` : ''}
    </div>
  `;
}

// ============================================
// Percakapan [Daftar Belanja - Isi Otomatis AI] - BARU.
// Kumpulkan barang tercentang -> ambil stock_movements 90 hari terakhir
// (movement_type='out') -> agregasi per minggu di sisi client (supaya
// payload ke Edge Function ringkas) -> kirim ke Edge Function terpisah
// suggest-kebutuhan (standalone, pola sama seperti suggest-merge-candidates,
// BUKAN action di dalam smooth-responder) -> isi hasil ke DAFTAR_BELANJA_QTY
// + DAFTAR_BELANJA_REASONING -> re-render.
// Tidak mengubah checklist yang sudah dicentang manual sebelumnya kalau AI
// balikin null untuk barang itu (isi manual tetap dipertahankan).
// ============================================
async function handleIsiOtomatisAI() {
  const checkedIds = Array.from(DAFTAR_BELANJA_QTY.keys());
  if (checkedIds.length === 0) return;

  hideDaftarBelanjaAiStatus();
  daftarBelanjaAiBtn.disabled = true;
  daftarBelanjaAiBtn.textContent = 'Menganalisis...';

  try {
    const checkedItems = checkedIds
      .map(id => ALL_INVENTARIS_ITEMS.find(p => String(p.id) === String(id)))
      .filter(Boolean);

    // Ambil riwayat stock_movements tipe 'out', 90 hari terakhir, untuk
    // semua barang tercentang sekaligus (1 query, bukan per barang)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: movements, error: movementsError } = await supabaseClient
      .from('stock_movements')
      .select('product_id, quantity, created_at')
      .eq('clinic_id', CURRENT_CLINIC_ID)
      .eq('movement_type', 'out')
      .gte('created_at', ninetyDaysAgo.toISOString())
      .in('product_id', checkedIds);

    if (movementsError) throw movementsError;

    // Agregasi per barang per minggu (format label minggu: "YYYY-Www")
    const movementsByProduct = new Map();
    (movements || []).forEach(m => {
      const weekLabel = getWeekLabel(new Date(m.created_at));
      if (!movementsByProduct.has(m.product_id)) movementsByProduct.set(m.product_id, new Map());
      const weekMap = movementsByProduct.get(m.product_id);
      weekMap.set(weekLabel, (weekMap.get(weekLabel) || 0) + Number(m.quantity || 0));
    });

    // Susun payload ringkas per barang untuk dikirim ke Edge Function
    const itemsPayload = checkedItems.map(p => {
      const weekMap = movementsByProduct.get(p.id) || new Map();
      const movementsArr = Array.from(weekMap.entries())
        .map(([period, qty_out]) => ({ period, qty_out }))
        .sort((a, b) => a.period.localeCompare(b.period));

      return {
        product_id: p.id,
        name: p.name,
        unit: p.unit,
        current_stock: p.current_stock,
        minimum_stock: p.minimum_stock,
        movements: movementsArr
      };
    });

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('Sesi login tidak ditemukan, silakan login ulang.');

    const response = await fetch(
      `${window.SUPABASE_URL || SUPABASE_URL}/functions/v1/suggest-kebutuhan`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': window.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          clinic_id: CURRENT_CLINIC_ID,
          items: itemsPayload
        })
      }
    );

    const result = await response.json().catch(() => ({}));

    if (response.status === 429 && result.error === 'quota_exceeded') {
      showDaftarBelanjaAiStatus(
        `Kuota AI klinik sudah habis (${result.used}/${result.limit} periode ini). Isi manual, atau upgrade Premium untuk kuota lebih besar.`,
        'error'
      );
      return;
    }

    if (!response.ok) {
      showDaftarBelanjaAiStatus(result.error || 'Gagal menghubungi server AI.', 'error');
      return;
    }

    const { suggestions } = result;

    // Isi hasil ke state, tanpa mengubah checklist barang lain yang tidak
    // termasuk dalam permintaan ini
    let filledCount = 0;
    (suggestions || []).forEach(s => {
      if (s.suggested_qty !== null && s.suggested_qty !== undefined && s.suggested_qty > 0) {
        DAFTAR_BELANJA_QTY.set(s.product_id, String(s.suggested_qty));
        filledCount++;
      }
      if (s.reasoning_short) {
        DAFTAR_BELANJA_REASONING.set(s.product_id, s.reasoning_short);
      }
    });

    renderDaftarBelanjaList(daftarBelanjaSearchInput.value);

    if (filledCount === 0) {
      showDaftarBelanjaAiStatus('AI belum bisa menyarankan angka untuk barang yang dipilih (data riwayat belum cukup). Silakan isi manual.', 'error');
    } else {
      showDaftarBelanjaAiStatus(`${filledCount} barang terisi otomatis. Silakan cek dan sesuaikan kalau perlu.`, 'success');
    }
  } catch (error) {
    console.error('Gagal isi otomatis AI:', error);
    showDaftarBelanjaAiStatus('Gagal menghubungi AI: ' + error.message, 'error');
  } finally {
    daftarBelanjaAiBtn.disabled = DAFTAR_BELANJA_QTY.size === 0;
    daftarBelanjaAiBtn.textContent = '🤖 Isi Otomatis (AI)';
  }
}

// Label minggu format "YYYY-Www" (ISO week sederhana, cukup untuk pengelompokan,
// tidak perlu presisi ISO 8601 penuh)
function getWeekLabel(date) {
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
  const weekNum = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function showDaftarBelanjaAiStatus(message, type) {
  daftarBelanjaAiStatus.textContent = message;
  daftarBelanjaAiStatus.className = 'status-message status-' + type;
  daftarBelanjaAiStatus.style.display = 'block';
}

function hideDaftarBelanjaAiStatus() {
  daftarBelanjaAiStatus.style.display = 'none';
}

async function handleGenerateDaftarBelanja() {
  hideDaftarBelanjaStatus();

  // Ambil semua barang yang dicentang (ada di Map), validasi jumlah kebutuhan wajib diisi > 0
  const checkedIds = Array.from(DAFTAR_BELANJA_QTY.keys());

  if (checkedIds.length === 0) {
    showDaftarBelanjaStatus('Pilih minimal satu barang terlebih dahulu.', 'error');
    return;
  }

  const invalidNames = [];
  const selectedItems = [];

  checkedIds.forEach(id => {
    const item = ALL_INVENTARIS_ITEMS.find(p => String(p.id) === String(id));
    if (!item) return;

    const rawQty = DAFTAR_BELANJA_QTY.get(id);
    const qty = parseFloat(rawQty);

    if (!rawQty || isNaN(qty) || qty <= 0) {
      invalidNames.push(item.name);
    } else {
      selectedItems.push({ ...item, plannedQty: qty });
    }
  });

  if (invalidNames.length > 0) {
    showDaftarBelanjaStatus(
      `Isi jumlah kebutuhan (harus lebih dari 0) untuk: ${invalidNames.join(', ')}.`,
      'error'
    );
    return;
  }

  // Urut hasil akhir sesuai status juga, biar konsisten dengan urutan checklist
  selectedItems.sort((a, b) => {
    const priorityDiff = statusPriority(a.status) - statusPriority(b.status);
    if (priorityDiff !== 0) return priorityDiff;
    return a.name.localeCompare(b.name);
  });

  daftarBelanjaGenerateBtn.disabled = true;
  daftarBelanjaGenerateBtn.textContent = 'Membuat...';

  try {
    const clinicName = await getClinicNameForDaftarBelanja();
    const teks = buildDaftarBelanjaText(clinicName, selectedItems);

    daftarBelanjaResultText.value = teks;
    daftarBelanjaResultSection.style.display = 'block';
    daftarBelanjaCopyStatus.style.display = 'none';

    // Scroll ke hasil supaya user langsung lihat, terutama kalau listnya panjang
    daftarBelanjaResultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    console.error('Gagal membuat daftar belanja:', error);
    showDaftarBelanjaStatus('Gagal membuat daftar belanja: ' + error.message, 'error');
  } finally {
    daftarBelanjaGenerateBtn.disabled = false;
    daftarBelanjaGenerateBtn.textContent = 'Generate List';
  }
}

// Ambil nama klinik dari tabel `clinics` (di-cache di DAFTAR_BELANJA_CLINIC_NAME
// supaya tidak query ulang tiap kali generate dalam sesi modal yang sama)
async function getClinicNameForDaftarBelanja() {
  if (DAFTAR_BELANJA_CLINIC_NAME) return DAFTAR_BELANJA_CLINIC_NAME;

  const { data, error } = await supabaseClient
    .from('clinics')
    .select('name')
    .eq('id', CURRENT_CLINIC_ID)
    .single();

  if (error || !data || !data.name) {
    console.error('Gagal ambil nama klinik:', error);
    return 'Klinik'; // fallback generik supaya generate tetap jalan walau nama klinik gagal diambil
  }

  DAFTAR_BELANJA_CLINIC_NAME = data.name;
  return DAFTAR_BELANJA_CLINIC_NAME;
}

function buildDaftarBelanjaText(clinicName, items) {
  const statusLabel = { kritis: 'Kritis', menipis: 'Menipis', normal: 'Normal' };

  let lines = [`Kebutuhan Barang — ${clinicName}`, ''];

  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name}`);
    lines.push(`Jumlah stok: ${item.current_stock} ${item.unit}`);
    lines.push(`Status: ${statusLabel[item.status] || item.status}`);
    lines.push(`Minimal stok: ${item.minimum_stock} ${item.unit}`);
    lines.push(`Jumlah kebutuhan: ${formatPlannedQty(item.plannedQty)} ${item.unit}`);
    lines.push('');
  });

  return lines.join('\n').trim();
}

// Buang desimal ".0" yang tidak perlu (misal user isi "2" -> tampil "2", bukan "2.0")
function formatPlannedQty(qty) {
  return Number.isInteger(qty) ? String(qty) : String(qty);
}

async function handleCopyDaftarBelanja() {
  const teks = daftarBelanjaResultText.value;
  if (!teks) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(teks);
    } else {
      // Fallback untuk browser lama/tanpa izin clipboard API: select teks lalu execCommand
      daftarBelanjaResultText.select();
      document.execCommand('copy');
    }
    showDaftarBelanjaCopyStatus('Berhasil disalin! Silakan tempel ke WhatsApp atau email.', 'success');
  } catch (error) {
    console.error('Gagal menyalin ke clipboard:', error);
    // Fallback terakhir: select teksnya supaya user bisa copy manual (Ctrl+C / tap-hold)
    daftarBelanjaResultText.select();
    showDaftarBelanjaCopyStatus('Gagal menyalin otomatis. Teks sudah diseleksi, silakan copy manual.', 'error');
  }
}

function showDaftarBelanjaStatus(message, type) {
  daftarBelanjaStatus.textContent = message;
  daftarBelanjaStatus.className = 'status-message status-' + type;
  daftarBelanjaStatus.style.display = 'block';
}

function hideDaftarBelanjaStatus() {
  daftarBelanjaStatus.style.display = 'none';
}

function showDaftarBelanjaCopyStatus(message, type) {
  daftarBelanjaCopyStatus.textContent = message;
  daftarBelanjaCopyStatus.className = 'status-message status-' + type;
  daftarBelanjaCopyStatus.style.display = 'block';
}
