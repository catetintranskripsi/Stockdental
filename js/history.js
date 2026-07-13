// ============================================
// HISTORY - Riwayat transaksi stock_movements
// Filter by bulan & tahun
// ============================================

const filterMonth = document.getElementById('filterMonth');
const filterYear = document.getElementById('filterYear');
const historySummary = document.getElementById('historySummary');
const historyList = document.getElementById('historyList');

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  setupYearOptions();
  setupDefaultMonth();
  await loadHistory();
}

// Isi dropdown tahun: 2 tahun ke belakang sampai tahun sekarang
function setupYearOptions() {
  const currentYear = new Date().getFullYear();
  filterYear.innerHTML = '';
  for (let y = currentYear; y >= currentYear - 2; y--) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    filterYear.appendChild(opt);
  }
}

// Default filter: bulan & tahun berjalan
function setupDefaultMonth() {
  const now = new Date();
  filterMonth.value = now.getMonth();
  filterYear.value = now.getFullYear();
}

async function loadHistory() {
  historyList.innerHTML = '<p class="loading-text">Memuat data...</p>';

  const month = parseInt(filterMonth.value);
  const year = parseInt(filterYear.value);

  // Rentang awal & akhir bulan yang dipilih
  const startDate = new Date(year, month, 1).toISOString();
  const endDate = new Date(year, month + 1, 1).toISOString();

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
    return;
  }

  renderHistory(movements || []);
}

function renderHistory(movements) {
  renderSummary(movements);

  if (movements.length === 0) {
    historyList.innerHTML = '<p class="loading-text">Tidak ada transaksi di bulan ini.</p>';
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
  if (type === 'opname_adjustment') return 'Opname';
  if (type === 'merge_marker') return '🔗 Digabung';
  return type;
}

function renderSummary(movements) {
  const inCount = movements.filter(m => m.movement_type === 'in').length;
  const outCount = movements.filter(m => m.movement_type === 'out').length;
  const opnameCount = movements.filter(m => m.movement_type === 'opname_adjustment').length;

  historySummary.innerHTML = `
    <p class="summary-stats">
      🟢 ${inCount} masuk · 🔴 ${outCount} keluar · 🔵 ${opnameCount} opname
      (total ${movements.length} transaksi)
    </p>
  `;
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

// Reload data setiap filter bulan/tahun berubah
filterMonth.addEventListener('change', loadHistory);
filterYear.addEventListener('change', loadHistory);
    
