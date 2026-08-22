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
  initSubscriptionStatus();
  initInfoAkun();
  initAiTipsCard();
  initTestimonial();
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

  // Percakapan [Ringkasan Lebih Visual] - donut proporsi Normal/Menipis/Kritis
  const normalCount = (products || []).length - kritisList.length - menipisList.length;
  renderStatusStokDonut(kritisList.length, menipisList.length, normalCount);

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
// Percakapan [Ringkasan Lebih Visual] - DONUT STATUS STOK
// Pakai Chart.js dari CDN. Kalau library gagal load (CDN diblokir, offline,
// dll), wrapper disembunyikan total dan angka teks kotak Kritis/Menipis yang
// sudah ada (tidak disentuh sama sekali) tetap jadi satu-satunya sumber info
// -- tidak ada fitur yang hilang, cuma visual tambahan yang tidak muncul.
// Instance chart disimpan supaya bisa di-destroy sebelum re-render (kalau
// loadStatusStok dipanggil ulang, misal habis refresh data).
// ============================================
let statusStokChartInstance = null;

function renderStatusStokDonut(kritisCount, menipisCount, normalCount) {
  const wrap = document.getElementById('statusStokVisual');
  const canvas = document.getElementById('statusStokDonut');
  const centerEl = document.getElementById('statusStokDonutCenter');
  if (!wrap || !canvas || !centerEl) return;

  const total = kritisCount + menipisCount + normalCount;
  if (typeof Chart === 'undefined' || total === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';

  // Ambil warna asli dari elemen .status-kritis/.status-menipis yang sudah
  // dipakai di tempat lain di halaman ini (computed style), supaya donut
  // otomatis konsisten dengan palet warna project tanpa perlu hardcode /
  // tanpa perlu tahu isi css/style.css.
  const kritisBoxEl = document.querySelector('.status-kritis');
  const menipisBoxEl = document.querySelector('.status-menipis');
  const colorKritis = kritisBoxEl ? getComputedStyle(kritisBoxEl).backgroundColor : '#DC2626';
  const colorMenipis = menipisBoxEl ? getComputedStyle(menipisBoxEl).backgroundColor : '#D97706';
  const colorNormal = '#E5E7EB'; // abu netral, tidak ada elemen existing yang mewakili "normal"

  centerEl.innerHTML = `<strong>${total}</strong>jenis barang`;

  if (statusStokChartInstance) {
    statusStokChartInstance.destroy();
  }

  statusStokChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Kritis', 'Menipis', 'Normal'],
      datasets: [{
        data: [kritisCount, menipisCount, normalCount],
        backgroundColor: [colorKritis, colorMenipis, colorNormal],
        borderWidth: 0
      }]
    },
    options: {
      cutout: '70%',
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.parsed} jenis barang`
          }
        }
      }
    }
  });
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

  // Percakapan [Ringkasan Lebih Visual] - ikon panah, angka sama, elemen beda
  const countInVisualEl = document.getElementById('countInVisual');
  const countOutVisualEl = document.getElementById('countOutVisual');
  const countOpnameVisualEl = document.getElementById('countOpnameVisual');
  if (countInVisualEl) countInVisualEl.textContent = countIn;
  if (countOutVisualEl) countOutVisualEl.textContent = countOut;
  if (countOpnameVisualEl) countOpnameVisualEl.textContent = countOpname;
}

// ============================================
// TOP 5 BARANG PALING SERING DIPAKAI BULAN INI
// Percakapan [Opname sebagai Pemakaian] - selain movement_type='out',
// sekarang juga ikut menghitung selisih TURUN dari Stok Opname
// (stock_before - stock_after, kalau positif) sebagai "pemakaian".
// Alasan: klinik sering pakai opname untuk barang yang pemakaiannya
// tidak sempat dicatat manual satu-satu (repot di lapangan) -- selisih
// turunnya secara praktis ya itu pemakaian (entah dipakai/rusak/hilang,
// tidak perlu dibedakan alasannya di sini).
// Opname yang naik (stok ketemu lebih banyak dari catatan) TIDAK
// dihitung sebagai pemakaian negatif -- diabaikan saja dari list ini.
// ============================================
async function loadTopProdukBulanIni() {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: movements, error } = await supabaseClient
    .from('stock_movements')
    .select('quantity, product_id, movement_type, stock_before, stock_after, products(name, unit)')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .in('movement_type', ['out', 'opname_adjustment'])
    .gte('created_at', startOfMonth.toISOString());

  if (error) throw error;

  // Group by product_id, jumlahkan quantity ('out') atau selisih turun ('opname_adjustment')
  const grouped = {};
  (movements || []).forEach(m => {
    // Tentukan jumlah yang dianggap "pemakaian" dari baris ini
    let pemakaian = 0;
    if (m.movement_type === 'out') {
      pemakaian = parseFloat(m.quantity);
    } else if (m.movement_type === 'opname_adjustment') {
      const selisih = parseFloat(m.stock_before) - parseFloat(m.stock_after);
      pemakaian = selisih > 0 ? selisih : 0; // opname naik (stok nambah) tidak dihitung
    }

    if (pemakaian <= 0) return; // tidak ada kontribusi pemakaian dari baris ini

    const id = m.product_id;
    if (!grouped[id]) {
      grouped[id] = {
        name: m.products?.name || 'Barang tidak diketahui',
        unit: m.products?.unit || '',
        total: 0
      };
    }
    grouped[id].total += pemakaian;
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

  // Percakapan [Ringkasan Lebih Visual] - bar horizontal proporsional
  // (panjang bar = total / total item pertama, item pertama selalu 100%)
  // dibanding list angka polos. Pakai <li> murni CSS, tidak perlu Chart.js
  // untuk bentuk bar horizontal sederhana seperti ini.
  const maxTotal = top5[0].total;

  top5.forEach(item => {
    const li = document.createElement('li');
    li.className = 'top-produk-bar-item';
    const widthPercent = maxTotal > 0 ? Math.max(6, Math.round((item.total / maxTotal) * 100)) : 0;
    li.innerHTML = `
      <div class="top-produk-bar-label">
        <span class="top-produk-bar-name">${escapeHtml(item.name)}</span>
        <span class="top-produk-bar-value">${item.total} ${escapeHtml(item.unit)}</span>
      </div>
      <div class="top-produk-bar-track">
        <div class="top-produk-bar-fill" style="width:${widthPercent}%;"></div>
      </div>
    `;
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

  // Percakapan [Open Date & PAO] - filter & urut sekarang pakai
  // effective_expiry_date (bisa lebih pendek dari expiry_date pabrik kalau
  // lot sudah dibuka & ada PAO), bukan expiry_date mentah lagi. Lot yang
  // belum pernah dibuka (effective_expiry_date = expiry_date, di-maintain
  // trigger DB) perilakunya sama persis seperti sebelumnya.
  const { data: lots, error } = await supabaseClient
    .from('product_lots')
    .select('id, batch_number, expiry_date, quantity, status, opened_at, pao_days, effective_expiry_date, products!inner(name, unit, is_active)')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true)
    .eq('products.is_active', true) // FIX: jangan hitung lot dari produk yang sudah dihapus (soft-delete)
    .gt('quantity', 0)
    .not('effective_expiry_date', 'is', null)
    .lte('effective_expiry_date', formatDateOnly(in30Days))
    .order('effective_expiry_date', { ascending: true });

  if (error) throw error;

  const expiredList = [];
  const h7List = [];
  const h30List = [];

  (lots || []).forEach(lot => {
    const expiryDate = new Date(lot.effective_expiry_date + 'T00:00:00');
    const diffDays = Math.round((expiryDate - today) / (1000 * 60 * 60 * 24));

    // Tandai kalau expiry ini lebih cepat gara-gara PAO (bukan expiry pabrik
    // asli) -- supaya user tahu kenapa barang ini muncul padahal expiry
    // pabriknya mungkin masih jauh.
    const isPaoDriven = lot.pao_days && lot.expiry_date && lot.effective_expiry_date < lot.expiry_date;

    const item = {
      name: lot.products?.name || 'Barang tidak diketahui',
      unit: lot.products?.unit || '',
      quantity: lot.quantity,
      expiryDate: expiryDate,
      diffDays: diffDays,
      isPaoDriven: isPaoDriven
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

  // Percakapan [Ringkasan Lebih Visual] - bar overview 3 kategori sebelum list detail
  renderKedaluwarsaBars(expiredList.length, h7List.length, h30List.length);

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
  // Percakapan [Open Date & PAO] - tandai kalau expiry ini dipercepat karena
  // PAO (bukan expiry pabrik asli), supaya user tidak bingung kenapa barang
  // ini muncul di alert padahal expiry pabriknya mungkin masih jauh.
  const paoTag = item.isPaoDriven ? ' <em>(dipercepat: sudah dibuka)</em>' : '';
  return `${escapeHtml(item.name)} — ${item.quantity} ${escapeHtml(item.unit)}, exp ${tanggalStr} (${sisaStr})${paoTag}`;
}

// ============================================
// Percakapan [Ringkasan Lebih Visual] - BAR OVERVIEW KEDALUWARSA
// 3 bar (Sudah Expired / H-7 / H-30) sebelum list detail. Panjang bar
// proporsional terhadap totalAlert (bukan Chart.js -- bar horizontal
// sederhana lebih ringan pakai CSS murni). Warna diambil dari
// .ringkasan-alert-subheading kalau ada styling warna di sana, kalau tidak
// pakai fallback merah/oranye/kuning standar (warna alert universal, aman
// dipakai walau tidak tahu isi persis style.css).
// ============================================
function renderKedaluwarsaBars(expiredCount, h7Count, h30Count) {
  const el = document.getElementById('kedaluwarsaBars');
  if (!el) return;

  const total = expiredCount + h7Count + h30Count;
  if (total === 0) {
    el.innerHTML = '';
    return;
  }

  const rows = [
    { label: 'Expired', count: expiredCount, color: '#DC2626' },
    { label: 'H-7', count: h7Count, color: '#D97706' },
    { label: 'H-30', count: h30Count, color: '#CA8A04' }
  ];

  el.innerHTML = rows.map(row => {
    const widthPercent = total > 0 ? Math.round((row.count / total) * 100) : 0;
    return `
      <div class="bar-row">
        <span class="bar-row-label">${row.label}</span>
        <div class="bar-row-track">
          <div class="bar-row-fill" style="width:${widthPercent}%; background:${row.color};"></div>
        </div>
        <span class="bar-row-count">${row.count}</span>
      </div>
    `;
  }).join('');
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

// ============================================
// KARTU "COBA AI" -- carousel 5 skenario penggunaan AI foto/suara.
// Selalu tampil untuk SEMUA klinik (tidak dicek jumlah barang) --
// tetap relevan buat staf baru atau user lama yang belum coba semua
// skenario (misal baru sadar bisa dipakai untuk stok opname via suara).
// Auto-rotate tiap 5 detik, tombol "Coba Sekarang" ikut skenario
// yang lagi tampil.
// ============================================
const AI_TIPS = [
  {
    text: 'Punya nota pembelian barang? Tidak perlu ketik satu per satu. Foto nota, AI yang analisis, tinggal simpan.',
    link: 'foto.html'
  },
  {
    text: 'Baru terima kiriman barang dan buru-buru? Sebutkan aja lewat suara, AI yang catat.',
    link: 'suara.html'
  },
  {
    text: '"Komposit" atau "Composite"? Analisis AI memastikan nama barang seragam — tidak ada 1 barang dengan 2 nama berbeda.',
    link: 'foto.html'
  },
  {
    text: 'Mau stok opname? Cukup bilang: "Komposit 3M A2 sisa 2 tube, alginat sisa 1 bungkus" — AI yang catat semua.',
    link: 'suara.html'
  },
  {
    text: 'Baru pertama pakai StockDental? Pindahkan data stok lama dengan mudah — foto saja daftar stok di komputer/kertas, AI akan menganalisisnya.',
    link: 'foto.html'
  }
];

const AI_TIPS_ROTATE_MS = 5000;
let aiTipsIndex = 0;
let aiTipsInterval = null;

function initAiTipsCard() {
  const textEl = document.getElementById('aiTipsText');
  const btnEl = document.getElementById('aiTipsBtn');
  const dotsEl = document.getElementById('aiTipsDots');
  const cardEl = document.getElementById('aiTipsCard');
  if (!textEl || !btnEl || !dotsEl || !cardEl) return; // guard kalau elemen belum ada

  // Buat dot indicator sejumlah AI_TIPS
  dotsEl.innerHTML = '';
  AI_TIPS.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'ai-tips-dot' + (i === 0 ? ' active' : '');
    dotsEl.appendChild(dot);
  });

  renderAiTip(0);
  startAiTipsAutoRotate();
  setupAiTipsSwipe(cardEl);
}

function startAiTipsAutoRotate() {
  if (aiTipsInterval) clearInterval(aiTipsInterval);
  aiTipsInterval = setInterval(() => {
    aiTipsIndex = (aiTipsIndex + 1) % AI_TIPS.length;
    renderAiTip(aiTipsIndex);
  }, AI_TIPS_ROTATE_MS);
}

// ---------- Swipe kiri/kanan (ganti tips manual) + tahan jari (pause) ----------
// - Sentuh & tahan tanpa geser -> auto-rotate berhenti sementara, lanjut lagi
//   otomatis setelah jari dilepas.
// - Geser kiri/kanan melewati ambang batas -> pindah ke tips berikutnya/
//   sebelumnya, lalu auto-rotate restart dari awal (5 detik) dari posisi baru.
const AI_TIPS_SWIPE_THRESHOLD_PX = 40;

function setupAiTipsSwipe(cardEl) {
  let touchStartX = 0;
  let touchStartY = 0;
  let isSwipeGesture = false;

  cardEl.addEventListener('touchstart', (e) => {
    if (aiTipsInterval) clearInterval(aiTipsInterval); // pause selama disentuh
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isSwipeGesture = false;
  }, { passive: true });

  cardEl.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    // Tandai sebagai swipe horizontal kalau gerakan X jelas lebih besar dari Y
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      isSwipeGesture = true;
    }
  }, { passive: true });

  cardEl.addEventListener('touchend', (e) => {
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;

    if (isSwipeGesture && Math.abs(dx) >= AI_TIPS_SWIPE_THRESHOLD_PX) {
      if (dx < 0) {
        // geser ke kiri -> tips berikutnya
        aiTipsIndex = (aiTipsIndex + 1) % AI_TIPS.length;
      } else {
        // geser ke kanan -> tips sebelumnya
        aiTipsIndex = (aiTipsIndex - 1 + AI_TIPS.length) % AI_TIPS.length;
      }
      renderAiTip(aiTipsIndex);
    }

    // Baik habis swipe maupun cuma tahan tanpa geser -> lanjutkan auto-rotate
    startAiTipsAutoRotate();
  });
}

function renderAiTip(index) {
  const textEl = document.getElementById('aiTipsText');
  const btnEl = document.getElementById('aiTipsBtn');
  const dotsEl = document.getElementById('aiTipsDots');
  if (!textEl || !btnEl || !dotsEl) return;

  const tip = AI_TIPS[index];

  // Fade out -> ganti isi -> fade in
  textEl.classList.add('fading');
  setTimeout(() => {
    textEl.textContent = tip.text;
    textEl.classList.remove('fading');
  }, 300);

  btnEl.onclick = () => { window.location.href = tip.link; };

  Array.from(dotsEl.children).forEach((dot, i) => {
    dot.classList.toggle('active', i === index);
  });
}

// ============================================
// STATUS LANGGANAN (Percakapan [Status Langganan di Ringkasan])
// Satu komponen SERAGAM untuk semua tier -- menggantikan banner
// upgrade lama yang terpisah (initUpgradeBanner). Isi & aksi tombol
// menyesuaikan tier: free / premium aktif / premium permanen.
//
// Baca LAST_KNOWN_CLINIC_ACCESS (diisi clinic-access.js via
// auth-check.js SEBELUM onPageReady ini jalan). TIDAK memanggil
// RPC/query baru.
// ============================================
const SUBSCRIPTION_WARNING_DAYS = 7; // konsisten dengan alert H-7 produk

const FREE_STATUS_MESSAGES = [
  'Kuota AI 3000/bulan & bebas limit jenis barang menanti di Premium',
  'Sudah dekat 70 jenis barang di Free? Upgrade Premium biar tidak terkunci',
  'Premium cuma Rp29.000/30 hari — lebih murah dari sekali beli bahan tambal'
];

function initSubscriptionStatus() {
  const card = document.getElementById('subscriptionStatusCard');
  if (!card) return;

  // Aman-nya: kalau LAST_KNOWN_CLINIC_ACCESS belum terisi (misal RPC
  // gagal), jangan tampilkan apa-apa daripada menebak tier.
  if (!LAST_KNOWN_CLINIC_ACCESS) return;

  const labelEl = document.getElementById('subscriptionStatusLabel');
  const detailEl = document.getElementById('subscriptionStatusDetail');
  const actionBtn = document.getElementById('subscriptionActionBtn');
  const tier = LAST_KNOWN_CLINIC_ACCESS.tier;
  const expiresAt = LAST_KNOWN_CLINIC_ACCESS.expires_at;

  card.classList.remove('status-warning', 'status-free');

  if (tier === 'free') {
    const randomMsg = FREE_STATUS_MESSAGES[Math.floor(Math.random() * FREE_STATUS_MESSAGES.length)];
    labelEl.textContent = '📦 Free';
    detailEl.textContent = randomMsg;
    card.classList.add('status-free');

    actionBtn.textContent = 'Lihat Premium';
    actionBtn.style.display = 'inline-block';
    actionBtn.onclick = () => { window.location.href = 'upgrade.html'; };

  } else if (tier === 'premium' && !expiresAt) {
    // Premium permanen -- tidak ada tombol aksi, tidak relevan.
    labelEl.textContent = '⭐ Premium';
    detailEl.textContent = 'Berlaku selamanya';
    actionBtn.style.display = 'none';

  } else if (tier === 'premium' && expiresAt) {
    const expiryDate = new Date(expiresAt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiryDateOnly = new Date(expiryDate);
    expiryDateOnly.setHours(0, 0, 0, 0);

    const diffDays = Math.round((expiryDateOnly - today) / (1000 * 60 * 60 * 24));
    const tanggalStr = expiryDate.toLocaleDateString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    labelEl.textContent = '⭐ Premium Aktif';

    if (diffDays < 0) {
      detailEl.textContent = `Sudah berakhir ${tanggalStr}`;
      card.classList.add('status-warning');
    } else if (diffDays === 0) {
      detailEl.textContent = 'Berakhir hari ini';
      card.classList.add('status-warning');
    } else {
      detailEl.textContent = `${diffDays} hari lagi (sampai ${tanggalStr})`;
      if (diffDays <= SUBSCRIPTION_WARNING_DAYS) {
        card.classList.add('status-warning');
      }
    }

    actionBtn.textContent = 'Perpanjang';
    actionBtn.style.display = 'inline-block';
    actionBtn.onclick = () => { window.location.href = 'upgrade.html'; };
  }

  card.style.display = 'block';
}

// ============================================
// INFO AKUN (nama klinik, email, ganti password)
// Nama klinik diambil dari tabel `clinics` (sumber utama, via
// CURRENT_CLINIC_ID) dengan fallback ke user_metadata.clinic_name
// kalau query clinics gagal/kosong -- jaga-jaga skema berbeda dugaan.
// ============================================
async function initInfoAkun() {
  const clinicNameEl = document.getElementById('infoAkunClinicName');
  const emailEl = document.getElementById('infoAkunEmail');

  // ---------- EMAIL ----------
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (user && emailEl) {
    emailEl.textContent = user.email || '-';
  }

  // ---------- NAMA KLINIK ----------
  if (clinicNameEl) {
    let clinicName = null;

    try {
      const { data: clinic, error } = await supabaseClient
        .from('clinics')
        .select('name')
        .eq('id', CURRENT_CLINIC_ID)
        .single();

      if (!error && clinic && clinic.name) {
        clinicName = clinic.name;
      }
    } catch (e) {
      console.warn('Gagal ambil nama klinik dari tabel clinics, coba fallback:', e);
    }

    // Fallback ke user_metadata kalau query di atas gagal/kosong
    if (!clinicName && user?.user_metadata?.clinic_name) {
      clinicName = user.user_metadata.clinic_name;
    }

    clinicNameEl.textContent = clinicName || '-';
  }

  setupGantiPasswordHandlers();
}

// ---------- TOGGLE & SUBMIT GANTI PASSWORD ----------
function setupGantiPasswordHandlers() {
  const showBtn = document.getElementById('showGantiPassword');
  const cancelBtn = document.getElementById('cancelGantiPassword');
  const submitBtn = document.getElementById('submitGantiPassword');
  const formWrap = document.getElementById('gantiPasswordForm');
  const statusEl = document.getElementById('gantiPasswordStatus');

  if (!showBtn) return; // guard kalau elemen belum ada

  showBtn.addEventListener('click', () => {
    formWrap.style.display = 'block';
    showBtn.style.display = 'none';
  });

  cancelBtn.addEventListener('click', () => {
    formWrap.style.display = 'none';
    showBtn.style.display = 'inline-block';
    document.getElementById('akunNewPassword').value = '';
    document.getElementById('akunNewPasswordConfirm').value = '';
    statusEl.style.display = 'none';
  });

  submitBtn.addEventListener('click', async () => {
    const newPassword = document.getElementById('akunNewPassword').value;
    const newPasswordConfirm = document.getElementById('akunNewPasswordConfirm').value;

    if (!newPassword || newPassword.length < 6) {
      showGantiPasswordStatus('Password minimal 6 karakter.', 'error');
      return;
    }

    if (newPassword !== newPasswordConfirm) {
      showGantiPasswordStatus('Password tidak cocok!', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';

    const { error } = await supabaseClient.auth.updateUser({
      password: newPassword
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan Password Baru';

    if (error) {
      showGantiPasswordStatus('Gagal mengubah password: ' + error.message, 'error');
      return;
    }

    showGantiPasswordStatus('Password berhasil diubah!', 'success');
    document.getElementById('akunNewPassword').value = '';
    document.getElementById('akunNewPasswordConfirm').value = '';
  });

  function showGantiPasswordStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status-message ' + (type === 'success' ? 'status-success' : 'status-error');
    statusEl.style.display = 'block';
  }
}

// ============================================
// RATING & TESTIMONI
// Card di bawah Info Akun. Klinik kasih rating 1-5 + komentar singkat
// (maks 200 karakter) + pilihan tampilkan nama klinik atau tidak.
// Submit masuk sebagai status 'pending' -- baru tampil di halaman
// login (index.html) setelah di-approve manual lewat Supabase dashboard.
// Satu klinik = satu testimoni aktif (submit ulang = replace + balik
// jadi 'pending' lagi, lihat RPC submit_testimonial di database).
// ============================================
let selectedRating = 0;

async function initTestimonial() {
  const card = document.getElementById('testimonialCard');
  if (!card) return; // guard kalau elemen belum ada

  const { data, error } = await supabaseClient.rpc('get_my_testimonial');

  if (error) {
    console.error('Gagal memuat testimoni:', error);
  }

  const existing = (!error && data && data.length > 0) ? data[0] : null;
  renderTestimonialForm(existing);
  setupTestimonialHandlers();
}

function renderTestimonialForm(existing) {
  const statusBadge = document.getElementById('testimonialStatusBadge');
  const commentEl = document.getElementById('testimonialComment');
  const counterEl = document.getElementById('testimonialCharCount');
  const checkboxEl = document.getElementById('testimonialShowName');
  const submitBtn = document.getElementById('testimonialSubmitBtn');

  if (existing) {
    selectedRating = existing.rating;
    commentEl.value = existing.comment;
    checkboxEl.checked = existing.show_clinic_name;
    counterEl.textContent = `${existing.comment.length}/200`;
    updateStarDisplay();

    submitBtn.textContent = 'Update Testimoni';

    if (existing.status === 'pending') {
      statusBadge.textContent = '⏳ Menunggu review';
      statusBadge.className = 'testimonial-badge badge-pending';
    } else if (existing.status === 'approved') {
      statusBadge.textContent = '✅ Sudah tampil di halaman login';
      statusBadge.className = 'testimonial-badge badge-approved';
    } else if (existing.status === 'rejected') {
      statusBadge.textContent = '❌ Tidak ditampilkan';
      statusBadge.className = 'testimonial-badge badge-rejected';
    }
    statusBadge.style.display = 'inline-block';
  } else {
    selectedRating = 0;
    updateStarDisplay();
    submitBtn.textContent = 'Kirim Testimoni';
    statusBadge.style.display = 'none';
  }
}

function setupTestimonialHandlers() {
  const stars = document.querySelectorAll('#testimonialStars .star-btn');
  stars.forEach(star => {
    star.onclick = () => {
      selectedRating = parseInt(star.dataset.value);
      updateStarDisplay();
    };
  });

  const commentEl = document.getElementById('testimonialComment');
  const counterEl = document.getElementById('testimonialCharCount');
  commentEl.oninput = () => {
    counterEl.textContent = `${commentEl.value.length}/200`;
  };

  document.getElementById('testimonialSubmitBtn').onclick = submitTestimonial;
}

function updateStarDisplay() {
  const stars = document.querySelectorAll('#testimonialStars .star-btn');
  stars.forEach(star => {
    const val = parseInt(star.dataset.value);
    star.classList.toggle('star-filled', val <= selectedRating);
  });
}

async function submitTestimonial() {
  const submitBtn = document.getElementById('testimonialSubmitBtn');
  const comment = document.getElementById('testimonialComment').value.trim();
  const showName = document.getElementById('testimonialShowName').checked;

  if (selectedRating === 0) {
    showTestimonialStatus('Pilih rating bintang dulu.', 'error');
    return;
  }
  if (!comment) {
    showTestimonialStatus('Komentar tidak boleh kosong.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Mengirim...';

  const { data, error } = await supabaseClient.rpc('submit_testimonial', {
    p_rating: selectedRating,
    p_comment: comment,
    p_show_clinic_name: showName
  });

  submitBtn.disabled = false;

  if (error || !data?.success) {
    const msg = data?.message || error?.message || 'Gagal mengirim testimoni.';
    showTestimonialStatus(msg, 'error');
    submitBtn.textContent = 'Kirim Testimoni';
    return;
  }

  showTestimonialStatus('Testimoni terkirim! Akan ditampilkan setelah direview.', 'success');
  await initTestimonial(); // refresh form + badge status
}

function showTestimonialStatus(message, type) {
  const el = document.getElementById('testimonialStatus');
  el.textContent = message;
  el.className = 'status-message ' + (type === 'success' ? 'status-success' : 'status-error');
  el.style.display = 'block';
}
