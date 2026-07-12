// ============================================
// INVENTARIS - Daftar stok barang
// Percakapan P10 - TAMBAH: dropdown sortir, tap-to-expand (detail + riwayat
//   transaksi singkat), pagination client-side (20 item/halaman)
// Default urutan (saat sortir = "Status"): Kritis (stok=0) > Menipis (stok<=minimum) > Normal
// ============================================

const ITEMS_PER_PAGE = 20;

let ALL_INVENTARIS_ITEMS = [];
let CURRENT_SORT = 'status'; // 'status' | 'nama' | 'stok' | 'kategori'
let CURRENT_PAGE = 1;
let EXPANDED_ITEM_ID = null; // tempId (product id) dari card yang sedang terbuka, atau null

const inventarisSearchInput = document.getElementById('inventarisSearchInput');
const inventarisSummary = document.getElementById('inventarisSummary');
const inventarisList = document.getElementById('inventarisList');
const inventarisSortSelect = document.getElementById('inventarisSortSelect');
const inventarisPagination = document.getElementById('inventarisPagination');

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  await loadInventaris();

  inventarisSearchInput.addEventListener('input', () => {
    CURRENT_PAGE = 1; // reset ke halaman 1 tiap kali pencarian berubah
    renderInventaris(inventarisSearchInput.value);
  });

  inventarisSortSelect.addEventListener('change', () => {
    CURRENT_SORT = inventarisSortSelect.value;
    CURRENT_PAGE = 1; // reset ke halaman 1 tiap kali sortir berubah
    renderInventaris(inventarisSearchInput.value);
  });
}

async function loadInventaris() {
  inventarisList.innerHTML = '<p class="loading-text">Memuat data...</p>';

  const { data: products, error } = await supabaseClient
    .from('products')
    .select('id, name, category, current_stock, minimum_stock, unit, storage_location')
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

  const item = document.createElement('div');
  item.className = `inventaris-item status-${p.status}${isExpanded ? ' expanded' : ''}`;
  item.dataset.productId = p.id;

  const badgeLabel = p.status === 'kritis' ? 'Kritis' : p.status === 'menipis' ? 'Menipis' : 'Normal';

  item.innerHTML = `
    <div class="inventaris-item-main">
      <span class="inventaris-item-name">${escapeHtml(p.name)}</span>
      <span class="inventaris-badge badge-${p.status}">${badgeLabel}</span>
      <span class="inventaris-chevron">${isExpanded ? '▴' : '▾'}</span>
    </div>
    <div class="inventaris-item-detail">
      <span>${escapeHtml(p.category || '-')}</span>
      <span>${p.current_stock} ${escapeHtml(p.unit)} (min: ${p.minimum_stock})</span>
    </div>
    <div class="inventaris-item-expand" style="display:${isExpanded ? 'block' : 'none'}">
      ${buildExpandContent(p)}
    </div>
  `;

  // Klik di area manapun pada card (kecuali di dalam expand content) = toggle expand
  item.addEventListener('click', (e) => {
    if (e.target.closest('.inventaris-item-expand')) return; // biar tidak konflik kalau nanti ada elemen interaktif di dalam expand
    handleCardToggle(p.id);
  });

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
    historyHtml = '<ul class="history-list">' + p.recentHistory.map(h => `
      <li>
        <span class="history-date">${formatTanggal(h.created_at)}</span>
        <span class="history-type">${movementTypeLabel(h.movement_type)}</span>
        <span class="history-qty">${h.quantity}</span>
      </li>
    `).join('') + '</ul>';
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

  return `
    <div class="expand-fields">
      <div><strong>Lokasi penyimpanan:</strong> ${escapeHtml(p.storage_location || '-')}</div>
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

// Label tampilan untuk movement_type. Fallback ke nilai asli kalau tipe belum dikenal,
// supaya tidak error/tampil kosong kalau ada jenis transaksi baru yang belum kepikiran di sini.
function movementTypeLabel(type) {
  const labels = {
    in: 'Masuk',
    out: 'Keluar',
    opname: 'Opname'
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
        .select('movement_type, quantity, created_at')
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

