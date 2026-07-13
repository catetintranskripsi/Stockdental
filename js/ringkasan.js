// ============================================
// RINGKASAN - Dashboard ringkas kondisi klinik
// Percakapan 6 - RINGKASAN (awal)
// Percakapan 12 - DASHBOARD & ALERT SYSTEM (revisi)
//   - Status Stok: ditambah list nama barang (Kritis/Menipis)
//   - Card baru: Alert Kedaluwarsa (berbasis product_lots, FEFO-aware)
//   - Semua data on-the-fly, tanpa tabel notifications
// ============================================

// Batas tampil default sebelum "Lihat semua" (expand di tempat)
const RINGKASAN_MAX_ITEMS = 5;

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  await loadRingkasan();
}

async function loadRingkasan() {
  const loadingEl = document.getElementById('ringkasanLoading');
  const contentEl = document.getElementById('ringkasanContent');

  try {
    await Promise.all([
      loadStatusStok(),
      loadTransaksiHariIni(),
      loadTopProdukBulanIni(),
      loadAlertKedaluwarsa()
    ]);

    loadingEl.style.display = 'none';
    contentEl.style.display = 'block';
  } catch (error) {
    console.error('Gagal memuat ringkasan:', error);
    loadingEl.textContent = 'Gagal memuat ringkasan. Coba refresh halaman.';
  }
}

// ============================================
// STATUS STOK (Kritis / Menipis)
// Logic status sama persis dengan inventaris.js, biar konsisten.
// Sekarang ditambah: list nama barang per kategori (bukan cuma angka)
// ============================================
async function loadStatusStok() {
  const { data: products, error } = await supabaseClient
    .from('products')
    .select('id, name, unit, current_stock, minimum_stock')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true);

  if (error) throw error;

  const kritisList = [];
  const menipisList = [];

  (products || []).forEach(p => {
    const status = getStockStatus(p.current_stock, p.minimum_stock);
    if (status === 'kritis') kritisList.push(p);
    else if (status === 'menipis') menipisList.push(p);
  });

  // Urutkan: yang paling jauh dari minimum (paling parah) di atas
  kritisList.sort((a, b) => a.current_stock - b.current_stock);
  menipisList.sort((a, b) => (a.current_stock - a.minimum_stock) - (b.current_stock - b.minimum_stock));

  document.getElementById('countKritis').textContent = kritisList.length;
  document.getElementById('countMenipis').textContent = menipisList.length;

  renderExpandableList({
    containerId: 'listKritis',
    items: kritisList,
    emptyText: 'Tidak ada barang kritis 👍',
    renderItem: (p) => `${escapeHtml(p.name)} — ${p.current_stock} ${escapeHtml(p.unit || '')} (min. ${p.minimum_stock})`
  });

  renderExpandableList({
    containerId: 'listMenipis',
    items: menipisList,
    emptyText: 'Tidak ada barang menipis 👍',
    renderItem: (p) => `${escapeHtml(p.name)} — ${p.current_stock} ${escapeHtml(p.unit || '')} (min. ${p.minimum_stock})`
  });
}

// Sama persis dengan fungsi di inventaris.js
function getStockStatus(currentStock, minimumStock) {
  if (currentStock <= 0) return 'kritis';
  if (currentStock <= minimumStock) return 'menipis';
  return 'normal';
}

// ============================================
// TRANSAKSI HARI INI
// ============================================
async function loadTransaksiHariIni() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { data: movements, error } = await supabaseClient
    .from('stock_movements')
    .select('movement_type')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .gte('created_at', startOfToday.toISOString());

  if (error) throw error;

  const list = movements || [];
  const countIn = list.filter(m => m.movement_type === 'in').length;
  const countOut = list.filter(m => m.movement_type === 'out').length;
  const countOpname = list.filter(m => m.movement_type === 'opname_adjustment').length;

  document.getElementById('totalTransaksiHariIni').textContent = list.length;
  document.getElementById('countIn').textContent = countIn;
  document.getElementById('countOut').textContent = countOut;
  document.getElementById('countOpname').textContent = countOpname;
}

// ============================================
// TOP 5 BARANG PALING SERING DIPAKAI BULAN INI
// ============================================
async function loadTopProdukBulanIni() {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: movements, error } = await supabaseClient
    .from('stock_movements')
    .select('quantity, product_id, products(name, unit)')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('movement_type', 'out')
    .gte('created_at', startOfMonth.toISOString());

  if (error) throw error;

  // Group by product_id, jumlahkan quantity
  const grouped = {};
  (movements || []).forEach(m => {
    const id = m.product_id;
    if (!grouped[id]) {
      grouped[id] = {
        name: m.products?.name || 'Barang tidak diketahui',
        unit: m.products?.unit || '',
        total: 0
      };
    }
    grouped[id].total += parseFloat(m.quantity);
  });

  const top5 = Object.values(grouped)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const listEl = document.getElementById('topProdukList');
  listEl.innerHTML = '';

  if (top5.length === 0) {
    listEl.innerHTML = '<p class="loading-text">Belum ada pemakaian bulan ini.</p>';
    return;
  }

  top5.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `${item.name} — ${item.total} ${item.unit}`;
    listEl.appendChild(li);
  });
}

// ============================================
// ALERT KEDALUWARSA (Percakapan 12)
// Sumber: product_lots (per-lot, FEFO-aware), bukan kolom expiry_date tunggal
// Kategori: Sudah Expired / H-7 / H-30
// ============================================
async function loadAlertKedaluwarsa() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const in30Days = new Date(today);
  in30Days.setDate(in30Days.getDate() + 30);

  const { data: lots, error } = await supabaseClient
    .from('product_lots')
    .select('id, batch_number, expiry_date, quantity, products(name, unit)')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true)
    .gt('quantity', 0)
    .not('expiry_date', 'is', null)
    .lte('expiry_date', formatDateOnly(in30Days))
    .order('expiry_date', { ascending: true });

  if (error) throw error;

  const expiredList = [];
  const h7List = [];
  const h30List = [];

  (lots || []).forEach(lot => {
    const expiryDate = new Date(lot.expiry_date + 'T00:00:00');
    const diffDays = Math.round((expiryDate - today) / (1000 * 60 * 60 * 24));

    const item = {
      name: lot.products?.name || 'Barang tidak diketahui',
      unit: lot.products?.unit || '',
      quantity: lot.quantity,
      expiryDate: expiryDate,
      diffDays: diffDays
    };

    if (diffDays < 0) expiredList.push(item);
    else if (diffDays <= 7) h7List.push(item);
    else h30List.push(item);
  });

  const totalAlert = expiredList.length + h7List.length + h30List.length;
  const countEl = document.getElementById('countKedaluwarsa');
  if (countEl) countEl.textContent = totalAlert;

  const emptyEl = document.getElementById('kedaluwarsaEmpty');
  const listsWrapEl = document.getElementById('kedaluwarsaListsWrap');
  if (totalAlert === 0) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (listsWrapEl) listsWrapEl.style.display = 'none';
    return;
  } else {
    if (emptyEl) emptyEl.style.display = 'none';
    if (listsWrapEl) listsWrapEl.style.display = 'block';
  }

  renderExpandableList({
    containerId: 'listExpired',
    items: expiredList,
    emptyText: null, // section disembunyikan total kalau kosong, lihat di bawah
    renderItem: formatLotAlertItem
  });
  toggleSection('sectionExpired', expiredList.length > 0);

  renderExpandableList({
    containerId: 'listH7',
    items: h7List,
    emptyText: null,
    renderItem: formatLotAlertItem
  });
  toggleSection('sectionH7', h7List.length > 0);

  renderExpandableList({
    containerId: 'listH30',
    items: h30List,
    emptyText: null,
    renderItem: formatLotAlertItem
  });
  toggleSection('sectionH30', h30List.length > 0);
}

function formatLotAlertItem(item) {
  const tanggalStr = item.expiryDate.toLocaleDateString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
  let sisaStr;
  if (item.diffDays < 0) {
    sisaStr = `sudah lewat ${Math.abs(item.diffDays)} hari`;
  } else if (item.diffDays === 0) {
    sisaStr = 'hari ini';
  } else {
    sisaStr = `${item.diffDays} hari lagi`;
  }
  return `${escapeHtml(item.name)} — ${item.quantity} ${escapeHtml(item.unit)}, exp ${tanggalStr} (${sisaStr})`;
}

function toggleSection(sectionId, show) {
  const el = document.getElementById(sectionId);
  if (el) el.style.display = show ? 'block' : 'none';
}

// ============================================
// HELPER: render list dengan batas RINGKASAN_MAX_ITEMS
// + tombol "Lihat semua (N)" yang expand di tempat
// ============================================
function renderExpandableList({ containerId, items, emptyText, renderItem }) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  if (!items || items.length === 0) {
    if (emptyText) {
      container.innerHTML = `<p class="loading-text">${escapeHtml(emptyText)}</p>`;
    }
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'ringkasan-alert-list';

  const visibleItems = items.slice(0, RINGKASAN_MAX_ITEMS);
  const hiddenItems = items.slice(RINGKASAN_MAX_ITEMS);

  visibleItems.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = renderItem(item);
    ul.appendChild(li);
  });

  container.appendChild(ul);

  if (hiddenItems.length > 0) {
    const hiddenUl = document.createElement('ul');
    hiddenUl.className = 'ringkasan-alert-list';
    hiddenUl.style.display = 'none';

    hiddenItems.forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = renderItem(item);
      hiddenUl.appendChild(li);
    });

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn-lihat-semua';
    toggleBtn.textContent = `Lihat semua (${items.length})`;

    toggleBtn.addEventListener('click', () => {
      const isHidden = hiddenUl.style.display === 'none';
      hiddenUl.style.display = isHidden ? 'block' : 'none';
      toggleBtn.textContent = isHidden ? 'Sembunyikan' : `Lihat semua (${items.length})`;
    });

    container.appendChild(hiddenUl);
    container.appendChild(toggleBtn);
  }
}

// Format Date jadi 'YYYY-MM-DD' (sesuai kolom `date` di Postgres), hindari isu timezone dari toISOString()
function formatDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Escape sederhana untuk cegah HTML injection dari nama barang
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
