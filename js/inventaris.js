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

// ---- State untuk fitur Gabungkan Barang ----
let SELECTION_MODE = false;
let SELECTED_IDS = new Set(); // maksimal 2 product id

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
const mergeConfirmModal = document.getElementById('mergeConfirmModal');
const mergeConfirmBody = document.getElementById('mergeConfirmBody');
const mergeExecuteBtn = document.getElementById('mergeExecuteBtn');
const mergeCancelBtn = document.getElementById('mergeCancelBtn');

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  await loadInventaris();

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
    lotsHtml = '<ul class="lots-list">' + p.activeLots.map(lot => `
      <li>
        <span class="lot-batch">${escapeHtml(lot.batch_number || '(tanpa no. batch)')}</span>
        <span class="lot-expiry">Exp: ${formatTanggal(lot.expiry_date)}</span>
        <span class="lot-qty">${lot.quantity}</span>
      </li>
    `).join('') + '</ul>';
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
      <div class="edit-form-group">
        <label>Nama Barang</label>
        <input type="text" class="edit-input" data-field="name" value="${escapeAttr(p.name)}">
      </div>
      <div class="edit-form-group">
        <label>Kategori</label>
        <input type="text" class="edit-input" data-field="category" value="${escapeAttr(p.category || '')}">
      </div>
      <div class="edit-form-group">
        <label>Satuan</label>
        <input type="text" class="edit-input" data-field="unit" value="${escapeAttr(p.unit || '')}">
      </div>
      <div class="edit-form-group">
        <label>Lokasi Penyimpanan</label>
        <input type="text" class="edit-input" data-field="storage_location" value="${escapeAttr(p.storage_location || '')}">
      </div>
      <div class="edit-form-group">
        <label>Stok Minimum</label>
        <input type="number" class="edit-input" data-field="minimum_stock" value="${p.minimum_stock}" min="0">
      </div>
      <p class="edit-stock-note">Untuk ubah jumlah stok, gunakan menu <strong>Stok Opname</strong> di halaman Input.</p>
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
function movementTypeLabel(type) {
  const labels = {
    in: 'Masuk',
    out: 'Keluar',
    opname_adjustment: 'Opname',
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
        .select('batch_number, expiry_date, quantity')
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

  // Hapus dari state lokal & tutup mode edit/expand, lalu render ulang
  ALL_INVENTARIS_ITEMS = ALL_INVENTARIS_ITEMS.filter(p => p.id !== productId);
  EDITING_ITEM_ID = null;
  EXPANDED_ITEM_ID = null;
  renderInventaris(inventarisSearchInput.value);

  // Barang berkurang bisa saja membuat klinik lolos dari status locked -->
  // cek ulang & update banner global (function ini ada di auth-check.js)
  if (typeof checkClinicAccessAndRenderBanner === 'function') {
    await checkClinicAccessAndRenderBanner();
  }
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
    <p>Produk <strong>${escapeHtml(merged.name)}</strong> (${mergedCount} riwayat transaksi) akan digabung ke <strong>${escapeHtml(survivor.name)}</strong> (${survivorCount} riwayat transaksi).</p>
    <p>Kategori hasil gabungan: <strong>${escapeHtml(survivor.category || '-')}</strong></p>
    <p>Lokasi hasil gabungan: <strong>${escapeHtml(survivor.storage_location || '-')}</strong></p>
    <p>Total stok setelah gabung: <strong>${totalStock} ${escapeHtml(survivor.unit || '')}</strong></p>
    <p class="merge-warning">Aksi ini tidak bisa dibatalkan.</p>
  `;

  mergeConfirmModal.dataset.survivorId = survivor.id;
  mergeConfirmModal.dataset.mergedId = merged.id;
  mergeConfirmModal.style.display = 'flex';
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
  const kritisCount = items.filter(p => p.status === 'kritis').length;
  const menipisCount = items.filter(p => p.status === 'menipis').length;

  if (kritisCount === 0 && menipisCount === 0) {
    inventarisSummary.innerHTML = '<p class="summary-ok">✅ Semua stok dalam kondisi baik.</p>';
    return;
  }

  let parts = [];
  if (kritisCount > 0) parts.push(`🔴 ${kritisCount} kritis`);
  if (menipisCount > 0) parts.push(`🟡 ${menipisCount} menipis`);

  inventarisSummary.innerHTML = `<p class="summary-warning">${parts.join(' · ')}</p>`;
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

function hideExportStatus() {
  exportStatus.style.display = 'none';
}
