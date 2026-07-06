// ============================================
// INVENTARIS - Daftar stok barang
// Urutan: Kritis (stok=0) > Menipis (stok<=minimum) > Normal
// ============================================

let ALL_INVENTARIS_ITEMS = [];

const inventarisSearchInput = document.getElementById('inventarisSearchInput');
const inventarisSummary = document.getElementById('inventarisSummary');
const inventarisList = document.getElementById('inventarisList');

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  await loadInventaris();
}

async function loadInventaris() {
  inventarisList.innerHTML = '<p class="loading-text">Memuat data...</p>';

  const { data: products, error } = await supabaseClient
    .from('products')
    .select('id, name, category, current_stock, minimum_stock, unit')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true);

  if (error) {
    console.error('Gagal load inventaris:', error);
    inventarisList.innerHTML = '<p class="error-text">Gagal memuat data. Coba refresh halaman.</p>';
    return;
  }

  ALL_INVENTARIS_ITEMS = (products || []).map(p => ({
    ...p,
    status: getStockStatus(p.current_stock, p.minimum_stock)
  }));

  renderInventaris('');
}

// Tentukan status stok: kritis, menipis, atau normal
function getStockStatus(currentStock, minimumStock) {
  if (currentStock <= 0) return 'kritis';
  if (currentStock <= minimumStock) return 'menipis';
  return 'normal';
}

// Urutan prioritas untuk sorting: kritis dulu, lalu menipis, lalu normal
function statusPriority(status) {
  if (status === 'kritis') return 0;
  if (status === 'menipis') return 1;
  return 2;
}

function renderInventaris(keyword) {
  const searchTerm = keyword.trim().toLowerCase();

  let filtered = searchTerm === ''
    ? ALL_INVENTARIS_ITEMS
    : ALL_INVENTARIS_ITEMS.filter(p => p.name.toLowerCase().includes(searchTerm));

  // Urutkan: kritis > menipis > normal, lalu alfabetis dalam grup yang sama
  filtered = [...filtered].sort((a, b) => {
    const priorityDiff = statusPriority(a.status) - statusPriority(b.status);
    if (priorityDiff !== 0) return priorityDiff;
    return a.name.localeCompare(b.name);
  });

  renderSummary(filtered);

  if (filtered.length === 0) {
    inventarisList.innerHTML = '<p class="loading-text">Tidak ada barang ditemukan.</p>';
    return;
  }

  inventarisList.innerHTML = '';

  filtered.forEach(p => {
    const item = document.createElement('div');
    item.className = `inventaris-item status-${p.status}`;

    const badgeLabel = p.status === 'kritis' ? 'Kritis' : p.status === 'menipis' ? 'Menipis' : 'Normal';

    item.innerHTML = `
      <div class="inventaris-item-main">
        <span class="inventaris-item-name">${escapeHtml(p.name)}</span>
        <span class="inventaris-badge badge-${p.status}">${badgeLabel}</span>
      </div>
      <div class="inventaris-item-detail">
        <span>${escapeHtml(p.category || '-')}</span>
        <span>${p.current_stock} ${escapeHtml(p.unit)} (min: ${p.minimum_stock})</span>
      </div>
    `;

    inventarisList.appendChild(item);
  });
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

// Filter real-time saat user mengetik
inventarisSearchInput.addEventListener('input', () => {
  renderInventaris(inventarisSearchInput.value);
});
      
