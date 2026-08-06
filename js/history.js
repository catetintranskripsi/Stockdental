// ============================================
// HISTORY - Riwayat transaksi stock_movements
// Percakapan [Filter Rentang Tanggal] - GANTI dari dropdown Bulan/Tahun
// ke 2 date picker (Dari - Sampai). Default saat halaman dibuka:
// tanggal awal = tanggal 1 bulan berjalan, tanggal akhir = hari ini.
// User bisa ubah bebas ke rentang tanggal manapun, lalu tap "Terapkan".
// ============================================

const filterStartDate = document.getElementById('filterStartDate');
const filterEndDate = document.getElementById('filterEndDate');
const filterApplyBtn = document.getElementById('filterApplyBtn');
const filterDateError = document.getElementById('filterDateError');
const historySummary = document.getElementById('historySummary');
const historyList = document.getElementById('historyList');

// Percakapan [Tab Penggunaan Barang] - elemen sub-tab & section, plus
// cache movements terakhir supaya pindah tab tidak perlu query ulang
// (kedua tab pakai rentang tanggal & data mentah yang sama, cuma beda
// cara agregasi/tampilannya).
const tabTransaksiBtn = document.getElementById('tabTransaksiBtn');
const tabPenggunaanBtn = document.getElementById('tabPenggunaanBtn');
const tabTransaksiSection = document.getElementById('tabTransaksiSection');
const tabPenggunaanSection = document.getElementById('tabPenggunaanSection');
const usageList = document.getElementById('usageList');

let lastLoadedMovements = [];
let activeTab = 'transaksi'; // 'transaksi' | 'penggunaan'

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  setupDefaultDateRange();
  setupTabSwitching();
  await loadHistory();
}

// Percakapan [Tab Penggunaan Barang] - switch tampilan section, TIDAK
// query ulang ke Supabase (data mentah sudah di-cache di
// lastLoadedMovements dari loadHistory() sebelumnya, agregasi/render
// tab Penggunaan Barang dihitung dari cache itu saja).
function setupTabSwitching() {
  tabTransaksiBtn.addEventListener('click', () => switchTab('transaksi'));
  tabPenggunaanBtn.addEventListener('click', () => switchTab('penggunaan'));
}

function switchTab(tab) {
  activeTab = tab;

  tabTransaksiBtn.classList.toggle('sub-tab-active', tab === 'transaksi');
  tabPenggunaanBtn.classList.toggle('sub-tab-active', tab === 'penggunaan');
  tabTransaksiSection.style.display = tab === 'transaksi' ? 'block' : 'none';
  tabPenggunaanSection.style.display = tab === 'penggunaan' ? 'block' : 'none';

  if (tab === 'penggunaan') {
    renderUsageSummary(lastLoadedMovements);
  }
}

// Default filter: tanggal 1 bulan berjalan sampai hari ini
function setupDefaultDateRange() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  filterStartDate.value = formatDateForInput(startOfMonth);
  filterEndDate.value = formatDateForInput(now);
}

// Format Date jadi 'YYYY-MM-DD' untuk value <input type="date">, hindari isu timezone dari toISOString()
function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function loadHistory() {
  const startValue = filterStartDate.value;
  const endValue = filterEndDate.value;

  if (!startValue || !endValue) {
    showFilterDateError('Pilih tanggal awal dan tanggal akhir.');
    return;
  }

  if (startValue > endValue) {
    showFilterDateError('Tanggal awal tidak boleh lebih dari tanggal akhir.');
    return;
  }

  hideFilterDateError();
  historyList.innerHTML = '<p class="loading-text">Memuat data...</p>';

  // startValue dipakai apa adanya (awal hari), endValue digeser +1 hari
  // supaya transaksi PADA tanggal akhir yang dipilih ikut kehitung penuh
  // (pola sama seperti versi lama yang pakai .lt() ke awal bulan berikutnya)
  const startDate = new Date(startValue + 'T00:00:00').toISOString();
  const endDateExclusive = new Date(endValue + 'T00:00:00');
  endDateExclusive.setDate(endDateExclusive.getDate() + 1);
  const endDate = endDateExclusive.toISOString();

  const { data: movements, error } = await supabaseClient
    .from('stock_movements')
    .select(`
      id,
      movement_type,
      quantity,
      stock_before,
      stock_after,
      created_at,
      reason,
      opname_note,
      notes,
      products (name, unit)
    `)
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .gte('created_at', startDate)
    .lt('created_at', endDate)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Gagal load riwayat:', error);
    historyList.innerHTML = '<p class="error-text">Gagal memuat data. Coba refresh halaman.</p>';
    usageList.innerHTML = '<p class="error-text">Gagal memuat data. Coba refresh halaman.</p>';
    return;
  }

  lastLoadedMovements = movements || [];
  renderHistory(lastLoadedMovements);

  // Percakapan [Tab Penggunaan Barang] - kalau tab Penggunaan Barang
  // sedang aktif saat user klik Terapkan, render ulang juga (biar tidak
  // ketinggalan data lama sampai user klik pindah tab manual).
  if (activeTab === 'penggunaan') {
    renderUsageSummary(lastLoadedMovements);
  }
}

function showFilterDateError(message) {
  filterDateError.textContent = message;
  filterDateError.style.display = 'block';
}

function hideFilterDateError() {
  filterDateError.style.display = 'none';
  filterDateError.textContent = '';
}

function renderHistory(movements) {
  renderSummary(movements);

  if (movements.length === 0) {
    historyList.innerHTML = '<p class="loading-text">Tidak ada transaksi di rentang tanggal ini.</p>';
    return;
  }

  historyList.innerHTML = '';

  movements.forEach(m => {
    const item = document.createElement('div');
    item.className = `history-item type-${m.movement_type}`;

    const typeLabel = getTypeLabel(m.movement_type);
    const productName = m.products ? m.products.name : '(barang dihapus)';
    const unit = m.products ? m.products.unit : '';
    const dateStr = formatDateTime(m.created_at);

    // merge_marker adalah jejak audit "produk lama digabung ke produk ini",
    // bukan transaksi stok biasa - jadi tidak relevan menampilkan jumlah/stok before-after
    const detailHtml = (m.movement_type === 'merge_marker')
      ? `<div class="history-item-detail history-item-detail-merge">${escapeHtml(m.notes || 'Digabung dari produk lain')}</div>`
      : `
        <div class="history-item-detail">
          <span>Jumlah: ${m.quantity} ${escapeHtml(unit)}</span>
          <span>Stok: ${m.stock_before} → ${m.stock_after}</span>
        </div>
      `;

    item.innerHTML = `
      <div class="history-item-main">
        <span class="history-badge badge-${m.movement_type}">${typeLabel}</span>
        <span class="history-date">${dateStr}</span>
      </div>
      <div class="history-item-name">${escapeHtml(productName)}</div>
      ${detailHtml}
    `;

    historyList.appendChild(item);
  });
}

function getTypeLabel(type) {
  if (type === 'in') return 'Masuk';
  if (type === 'out') return 'Keluar';
  if (type === 'opname_adjustment') return 'Stok Fisik';
  if (type === 'merge_marker') return '🔗 Digabung';
  return type;
}

function renderSummary(movements) {
  const inCount = movements.filter(m => m.movement_type === 'in').length;
  const outCount = movements.filter(m => m.movement_type === 'out').length;
  const opnameCount = movements.filter(m => m.movement_type === 'opname_adjustment').length;

  historySummary.innerHTML = `
    <p class="summary-stats">
      🟢 ${inCount} masuk · 🔴 ${outCount} keluar · 🔵 ${opnameCount} stok fisik
      (total ${movements.length} transaksi)
    </p>
  `;
}

// ============================================
// Percakapan [Tab Penggunaan Barang] - rekap total pemakaian per barang
// pada rentang tanggal yang difilter. Definisi "pemakaian" KONSISTEN
// dengan Top 5 Barang di dashboard (ringkasan.js):
// - Barang Keluar (movement_type='out') -> quantity dihitung penuh
// - Stok Fisik Saat Ini (movement_type='opname_adjustment') yang membuat
//   stok TURUN (stock_after < stock_before) -> selisihnya (stock_before -
//   stock_after) dihitung sebagai pemakaian juga, walau tidak pernah
//   dicatat lewat Barang Keluar
// - Stok Fisik yang membuat stok NAIK (ketemu lebih banyak dari catatan)
//   TIDAK dihitung sebagai pemakaian (itu temuan barang, bukan pemakaian)
// - merge_marker diabaikan (bukan transaksi stok riil)
// ============================================
function aggregateUsage(movements) {
  const usageMap = {}; // productName -> { quantity, unit }

  movements.forEach(m => {
    const productName = m.products ? m.products.name : null;
    if (!productName) return; // barang sudah dihapus, tidak ada nama utk direkap

    const unit = m.products.unit || '';

    if (m.movement_type === 'out') {
      if (!usageMap[productName]) usageMap[productName] = { quantity: 0, unit };
      usageMap[productName].quantity += Number(m.quantity) || 0;
    } else if (m.movement_type === 'opname_adjustment') {
      const stockBefore = Number(m.stock_before);
      const stockAfter = Number(m.stock_after);
      if (!isNaN(stockBefore) && !isNaN(stockAfter) && stockAfter < stockBefore) {
        const selisih = stockBefore - stockAfter;
        if (!usageMap[productName]) usageMap[productName] = { quantity: 0, unit };
        usageMap[productName].quantity += selisih;
      }
    }
  });

  return Object.keys(usageMap)
    .map(name => ({ name, quantity: usageMap[name].quantity, unit: usageMap[name].unit }))
    .sort((a, b) => b.quantity - a.quantity); // paling banyak dipakai dulu
}

function renderUsageSummary(movements) {
  const usage = aggregateUsage(movements);

  if (usage.length === 0) {
    usageList.innerHTML = '<p class="loading-text">Tidak ada pemakaian barang di rentang tanggal ini.</p>';
    return;
  }

  usageList.innerHTML = '';

  usage.forEach((u, index) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-item-main">
        <span class="history-badge badge-out">#${index + 1}</span>
      </div>
      <div class="history-item-name">${escapeHtml(u.name)}</div>
      <div class="history-item-detail">
        <span>Total dipakai: ${u.quantity} ${escapeHtml(u.unit)}</span>
      </div>
    `;
    usageList.appendChild(item);
  });
}

function formatDateTime(isoString) {
  const date = new Date(isoString);
  const options = { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
  return date.toLocaleDateString('id-ID', options);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Reload data saat tombol Terapkan ditekan
filterApplyBtn.addEventListener('click', loadHistory);
    
