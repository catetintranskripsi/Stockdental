// ============================================
// APP LOGIC - Form Input Stok (3 jenis transaksi)
// stock_movements: in, out, opname_adjustment
// Versi: P9 - Lot/Batch Tracking + FEFO otomatis
// Semua write lot+movement sekarang lewat RPC (atomik di database):
//   - add_stock_lot()        -> stock in (bikin lot baru)
//   - deduct_stock_fefo()    -> stock out (potong lot FEFO otomatis)
//   - adjust_stock_opname()  -> stok opname (selisih via FEFO / lot baru)
// products.current_stock disinkron otomatis oleh trigger trg_sync_current_stock
// ============================================

let CURRENT_CLINIC_ID = null;
let CURRENT_USER_ID = null;
let ALL_PRODUCTS = []; // cache semua produk untuk difilter di searchable dropdown

const movementTypeSelect = document.getElementById('movementType');
const form = document.getElementById('formStockMovement');
const statusDiv = document.getElementById('statusMessage');
const submitBtn = document.getElementById('submitBtn');
const productSelectGroup = document.getElementById('productSelectGroup');

// Elemen searchable dropdown
const productSearchInput = document.getElementById('productSearchInput');
const productSelectedId = document.getElementById('productSelectedId');
const productSearchResults = document.getElementById('productSearchResults');

// Field groups (tampil/sembunyi tergantung movementType)
const fieldsIn = document.getElementById('fieldsIn');
const fieldsOut = document.getElementById('fieldsOut');
const fieldsOpname = document.getElementById('fieldsOpname');
const opnamePreview = document.getElementById('opnamePreview');
const newProductFields = document.getElementById('newProductFields');

// Dipanggil dari auth.js setelah user berhasil login
async function onUserLoggedIn() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  CURRENT_USER_ID = user.id;

  const { data: userRow, error } = await supabaseClient
    .from('users')
    .select('clinic_id')
    .eq('id', user.id)
    .single();

  if (error || !userRow) {
    showStatus('Gagal ambil data klinik. Hubungi admin.', 'error');
    console.error('Error ambil clinic_id:', error);
    return;
  }

  CURRENT_CLINIC_ID = userRow.clinic_id;

  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) bottomNav.style.display = 'flex';

  await loadProductOptions();
}

// Load daftar produk existing ke cache ALL_PRODUCTS (dipakai untuk filter search)
async function loadProductOptions() {
  const { data: products, error } = await supabaseClient
    .from('products')
    .select('id, name, current_stock, unit')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('Gagal load produk:', error);
    return;
  }

  ALL_PRODUCTS = products || [];
}

// ============================================
// SEARCHABLE DROPDOWN LOGIC
// ============================================

// Render daftar hasil filter di bawah input search
function renderProductResults(filterText) {
  const keyword = filterText.trim().toLowerCase();

  // Kalau kosong, tampilkan semua (dibatasi 50 biar tidak berat)
  const filtered = keyword === ''
    ? ALL_PRODUCTS.slice(0, 50)
    : ALL_PRODUCTS.filter(p => p.name.toLowerCase().includes(keyword)).slice(0, 50);

  productSearchResults.innerHTML = '';

  if (filtered.length === 0) {
    const noResult = document.createElement('div');
    noResult.className = 'product-search-no-result';
    noResult.textContent = 'Barang tidak ditemukan.';
    productSearchResults.appendChild(noResult);
    productSearchResults.style.display = 'block';
    return;
  }

  filtered.forEach(p => {
    const item = document.createElement('div');
    item.className = 'product-search-item';
    item.textContent = `${p.name} (stok: ${p.current_stock} ${p.unit})`;
    item.dataset.id = p.id;
    item.dataset.currentStock = p.current_stock;
    item.dataset.unit = p.unit;
    item.dataset.name = p.name;

    item.addEventListener('click', () => {
      selectProduct(p);
    });

    productSearchResults.appendChild(item);
  });

  productSearchResults.style.display = 'block';
}

// Set produk yang terpilih (dipanggil saat user klik salah satu hasil)
function selectProduct(product) {
  productSelectedId.value = product.id;
  productSearchInput.value = `${product.name} (stok: ${product.current_stock} ${product.unit})`;
  productSearchInput.dataset.currentStock = product.current_stock;
  productSearchResults.style.display = 'none';

  // Trigger update preview opname kalau lagi di mode itu
  updateOpnamePreview();
}

// Reset pilihan produk (dipanggil saat form direset atau ganti jenis transaksi)
function resetProductSelection() {
  productSelectedId.value = '';
  productSearchInput.value = '';
  delete productSearchInput.dataset.currentStock;
  productSearchResults.style.display = 'none';
  productSearchResults.innerHTML = '';
}

// Buka daftar saat input di-fokus
productSearchInput.addEventListener('focus', () => {
  renderProductResults('');
});

// Filter saat user ketik
productSearchInput.addEventListener('input', () => {
  // Kalau user mulai ngetik lagi, anggap pilihan sebelumnya batal sampai klik ulang
  productSelectedId.value = '';
  renderProductResults(productSearchInput.value);
});

// Tutup dropdown kalau klik di luar area search
document.addEventListener('click', (e) => {
  const isClickInside = productSearchInput.contains(e.target) || productSearchResults.contains(e.target);
  if (!isClickInside) {
    productSearchResults.style.display = 'none';
  }
});

// ============================================
// TOGGLE FIELD GROUPS
// ============================================

movementTypeSelect.addEventListener('change', () => {
  const type = movementTypeSelect.value;

  fieldsIn.style.display = type === 'in' ? 'block' : 'none';
  fieldsOut.style.display = type === 'out' ? 'block' : 'none';
  fieldsOpname.style.display = type === 'opname_adjustment' ? 'block' : 'none';
  opnamePreview.textContent = '';

  // Untuk 'out' & 'opname', wajib pilih dari produk existing
  productSelectGroup.style.display = (type === 'out' || type === 'opname_adjustment') ? 'block' : 'none';

  // Untuk 'in', boleh input nama barang baru
  newProductFields.style.display = (type === 'in') ? 'block' : 'none';

  // Reset pilihan produk setiap ganti jenis transaksi
  resetProductSelection();
});

// Live preview selisih opname saat user ketik jumlah fisik
function updateOpnamePreview() {
  const currentStock = parseFloat(productSearchInput.dataset.currentStock);
  const physicalCount = parseFloat(document.getElementById('opnamePhysicalCount').value);

  if (isNaN(currentStock) || isNaN(physicalCount)) {
    opnamePreview.textContent = '';
    return;
  }

  const selisih = physicalCount - currentStock;
  const arah = selisih > 0 ? 'lebih' : selisih < 0 ? 'kurang' : 'sama';
  opnamePreview.textContent = `Selisih: ${selisih > 0 ? '+' : ''}${selisih} (${arah}). Stok akan disesuaikan dari ${currentStock} → ${physicalCount}.`;
  opnamePreview.className = 'opname-preview ' + (selisih === 0 ? 'preview-neutral' : (selisih > 0 ? 'preview-plus' : 'preview-minus'));
}

document.getElementById('opnamePhysicalCount').addEventListener('input', updateOpnamePreview);

// ============================================
// FORM SUBMIT
// ============================================

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!CURRENT_CLINIC_ID) {
    showStatus('Data klinik belum siap, coba refresh halaman.', 'error');
    return;
  }

  const movementType = movementTypeSelect.value;
  if (!movementType) {
    showStatus('Pilih jenis transaksi dulu.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Menyimpan...';

  try {
    if (movementType === 'in') {
      await handleStockIn();
    } else if (movementType === 'out') {
      await handleStockOut();
    } else if (movementType === 'opname_adjustment') {
      await handleOpname();
    }

    showStatus('Transaksi berhasil disimpan!', 'success');
    form.reset();
    opnamePreview.textContent = '';
    fieldsIn.style.display = 'none';
    fieldsOut.style.display = 'none';
    fieldsOpname.style.display = 'none';
    productSelectGroup.style.display = 'none';
    newProductFields.style.display = 'none';
    resetProductSelection();
    document.getElementById('unit').value = 'pcs';
    await loadProductOptions();

  } catch (error) {
    console.error('Error:', error);
    showStatus('Gagal menyimpan: ' + parseErrorMessage(error), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan Transaksi';
  }
});

// Ubah pesan error dari Postgres (RAISE EXCEPTION 'STOK_TIDAK_CUKUP: kurang % unit')
// jadi lebih enak dibaca staff, tanpa kehilangan detail aslinya
function parseErrorMessage(error) {
  const msg = error?.message || String(error);
  if (msg.includes('STOK_TIDAK_CUKUP')) {
    const match = msg.match(/kurang\s+(-?\d+)\s*unit/i);
    const kurang = match ? match[1] : '?';
    return `Stok tidak cukup, kurang ${kurang} unit dari yang diminta.`;
  }
  return msg;
}

// ============================================
// HANDLER: Tambah Barang (in)
// Sekarang lewat RPC add_stock_lot -> bikin 1 lot baru + 1 movement 'in'
// secara atomik. Trigger trg_sync_current_stock yang update products.current_stock.
// ============================================
async function handleStockIn() {
  const productName = document.getElementById('productName').value.trim();
  const category = document.getElementById('category').value.trim();
  const quantity = parseInt(document.getElementById('quantity').value, 10);
  const unit = document.getElementById('unit').value.trim() || 'pcs';
  const expiryDate = document.getElementById('expiryDate').value || null;
  const batchNumber = document.getElementById('batchNumber').value.trim() || null;
  const storageLocation = document.getElementById('storageLocation').value.trim();
  const minimumStock = parseFloat(document.getElementById('minimumStock').value) || 0;

  if (!productName || isNaN(quantity) || quantity <= 0) {
    throw new Error('Nama barang dan jumlah wajib diisi dengan benar.');
  }

  // Cari produk existing, atau buat baru kalau belum ada
  let { data: existingProduct, error: findError } = await supabaseClient
    .from('products')
    .select('id')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('name', productName)
    .maybeSingle();

  if (findError) throw findError;

  let productId;

  if (existingProduct) {
    productId = existingProduct.id;
  } else {
    const { data: newProduct, error: insertProductError } = await supabaseClient
      .from('products')
      .insert({
        clinic_id: CURRENT_CLINIC_ID,
        name: productName,
        category: category,
        unit: unit,
        storage_location: storageLocation,
        minimum_stock: minimumStock,
        current_stock: 0
      })
      .select('id')
      .single();

    if (insertProductError) throw insertProductError;
    productId = newProduct.id;
  }

  // Panggil RPC: bikin lot baru + movement 'in', atomik di database
  const { error: rpcError } = await supabaseClient.rpc('add_stock_lot', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_quantity: quantity,
    p_batch_number: batchNumber,
    p_expiry_date: expiryDate,
    p_user_id: CURRENT_USER_ID
  });

  if (rpcError) throw rpcError;
}

// ============================================
// HANDLER: Penggunaan Barang (out)
// Sekarang lewat RPC deduct_stock_fefo -> Postgres yang urus alokasi
// lintas lot (FEFO), bisa hasilkan >1 baris movement, staff cuma lihat 1 hasil.
// ============================================
async function handleStockOut() {
  const productId = productSelectedId.value;
  const quantity = parseInt(document.getElementById('outQuantity').value, 10);
  const reason = document.getElementById('outReason').value.trim() || null;

  if (!productId) {
    throw new Error('Pilih barang dari daftar terlebih dahulu (klik salah satu hasil pencarian).');
  }

  if (isNaN(quantity) || quantity <= 0) {
    throw new Error('Isi jumlah dengan benar.');
  }

  const { error: rpcError } = await supabaseClient.rpc('deduct_stock_fefo', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_quantity: quantity,
    p_movement_type: 'out',
    p_user_id: CURRENT_USER_ID,
    p_reason: reason
  });

  if (rpcError) throw rpcError;
}

// ============================================
// HANDLER: Stok Opname
// Sekarang lewat RPC adjust_stock_opname -> Postgres hitung selisih sendiri
// (fisik vs sistem), lalu FEFO stock-out otomatis (kurang) atau bikin lot
// baru expiry NULL (lebih), sesuai desain P9.
// ============================================
async function handleOpname() {
  const productId = productSelectedId.value;
  const physicalCount = parseInt(document.getElementById('opnamePhysicalCount').value, 10);
  const opnameNote = document.getElementById('opnameNote').value.trim() || null;

  if (!productId) {
    throw new Error('Pilih barang dari daftar terlebih dahulu (klik salah satu hasil pencarian).');
  }

  if (isNaN(physicalCount) || physicalCount < 0) {
    throw new Error('Isi jumlah fisik dengan benar.');
  }

  const { error: rpcError } = await supabaseClient.rpc('adjust_stock_opname', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_jumlah_fisik: physicalCount,
    p_user_id: CURRENT_USER_ID,
    p_opname_note: opnameNote
  });

  if (rpcError) throw rpcError;
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = type === 'success' ? 'status-success' : 'status-error';
  setTimeout(() => {
    statusDiv.className = '';
    statusDiv.textContent = '';
  }, 4000);
}
