// ============================================
// RINGKASAN - Dashboard ringkas kondisi klinik
// Percakapan 6 - RINGKASAN
// Status stok, transaksi hari ini, top 5 barang bulan ini
// ============================================

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
      loadTopProdukBulanIni()
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
// Logic sama persis dengan inventaris.js, biar konsisten
// ============================================
async function loadStatusStok() {
  const { data: products, error } = await supabaseClient
    .from('products')
    .select('current_stock, minimum_stock')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true);

  if (error) throw error;

  let kritisCount = 0;
  let menipisCount = 0;

  (products || []).forEach(p => {
    const status = getStockStatus(p.current_stock, p.minimum_stock);
    if (status === 'kritis') kritisCount++;
    else if (status === 'menipis') menipisCount++;
  });

  document.getElementById('countKritis').textContent = kritisCount;
  document.getElementById('countMenipis').textContent = menipisCount;
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
