// ============================================
// APP LOGIC - Form Input Stok (3 jenis transaksi)
// stock_movements: in, out, opname_adjustment
// Versi: searchable dropdown untuk pilih barang
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
// Dipanggil dari auth.js setelah user berhasil login
async function onUserLoggedIn() {
  try {
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError) {
      alert('DEBUG - Error getUser: ' + userError.message);
      return;
    }

    if (!user) {
      alert('DEBUG - user kosong (tidak ada session)');
      return;
    }

    CURRENT_USER_ID = user.id;

    const { data: userRow, error } = await supabaseClient
      .from('users')
      .select('clinic_id')
      .eq('id', user.id)
      .single();

    if (error || !userRow) {
      alert('DEBUG - Error ambil clinic_id: ' + JSON.stringify(error) + ' | userRow: ' + JSON.stringify(userRow));
      showStatus('Gagal ambil data klinik. Hubungi admin.', 'error');
      console.error('Error ambil clinic_id:', error);
      return;
    }

    CURRENT_CLINIC_ID = userRow.clinic_id;
    alert('DEBUG - Berhasil! CURRENT_CLINIC_ID = ' + CURRENT_CLINIC_ID);

    const bottomNav = document.getElementById('bottomNav');
    if (bottomNav) bottomNav.style.display = 'flex';

    await loadProductOptions();
  } catch (e) {
    alert('DEBUG - Exception tak terduga: ' + e.message);
  }
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
    showStatus('Gagal menyimpan: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan Transaksi';
  }
});

// ============================================
// HANDLER: Tambah Barang (in)
// ============================================
async function handleStockIn() {
  const productName = document.getElementById('productName').value.trim();
  const category = document.getElementById('category').value.trim();
  const quantity = parseFloat(document.getElementById('quantity').value);
  const unit = document.getElementById('unit').value.trim() || 'pcs';
  const expiryDate = document.getElementById('expiryDate').value || null;
  const batchNumber = document.getElementById('batchNumber').value.trim() || null;
  const storageLocation = document.getElementById('storageLocation').value.trim();
  const minimumStock = parseFloat(document.getElementById('minimumStock').value) || 0;

  if (!productName || isNaN(quantity) || quantity <= 0) {
    throw new Error('Nama barang dan jumlah wajib diisi dengan benar.');
  }

  // Cari produk existing atau buat baru
  let { data: existingProduct, error: findError } = await supabaseClient
    .from('products')
    .select('id, current_stock')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('name', productName)
    .maybeSingle();

  if (findError) throw findError;

  let productId, stockBefore;

  if (existingProduct) {
    productId = existingProduct.id;
    stockBefore = existingProduct.current_stock;
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
      .select('id, current_stock')
      .single();

    if (insertProductError) throw insertProductError;
    productId = newProduct.id;
    stockBefore = 0;
  }

  const stockAfter = stockBefore + quantity;

  const { error: insertMovementError } = await supabaseClient
    .from('stock_movements')
    .insert({
      clinic_id: CURRENT_CLINIC_ID,
      product_id: productId,
      movement_type: 'in',
      quantity: quantity,
      stock_before: stockBefore,
      stock_after: stockAfter,
      expiry_date: expiryDate,
      batch_number: batchNumber,
      source_type: 'manual',
      performed_by: CURRENT_USER_ID
    });

  if (insertMovementError) throw insertMovementError;
}

// ============================================
// HANDLER: Penggunaan Barang (out)
// ============================================
async function handleStockOut() {
  const productId = productSelectedId.value;
  const quantity = parseFloat(document.getElementById('outQuantity').value);
  const reason = document.getElementById('outReason').value;

  if (!productId) {
    throw new Error('Pilih barang dari daftar terlebih dahulu (klik salah satu hasil pencarian).');
  }

  if (isNaN(quantity) || quantity <= 0) {
    throw new Error('Isi jumlah dengan benar.');
  }

  const { data: product, error: fetchError } = await supabaseClient
    .from('products')
    .select('current_stock')
    .eq('id', productId)
    .single();

  if (fetchError) throw fetchError;

  const stockBefore = product.current_stock;
  const stockAfter = stockBefore - quantity;

  // Validasi tidak minus — sesuaikan kalau kamu ingin izinkan dengan warning
  if (stockAfter < 0) {
    throw new Error(`Stok tidak cukup. Stok saat ini: ${stockBefore}, diminta keluar: ${quantity}.`);
  }

  const { error: insertMovementError } = await supabaseClient
    .from('stock_movements')
    .insert({
      clinic_id: CURRENT_CLINIC_ID,
      product_id: productId,
      movement_type: 'out',
      quantity: quantity,
      stock_before: stockBefore,
      stock_after: stockAfter,
      reason: reason,
      source_type: 'manual',
      performed_by: CURRENT_USER_ID
    });

  if (insertMovementError) throw insertMovementError;
}

// ============================================
// HANDLER: Stok Opname
// ============================================
async function handleOpname() {
  const productId = productSelectedId.value;
  const physicalCount = parseFloat(document.getElementById('opnamePhysicalCount').value);
  const opnameNote = document.getElementById('opnameNote').value.trim() || null;

  if (!productId) {
    throw new Error('Pilih barang dari daftar terlebih dahulu (klik salah satu hasil pencarian).');
  }

  if (isNaN(physicalCount) || physicalCount < 0) {
    throw new Error('Isi jumlah fisik dengan benar.');
  }

  const { data: product, error: fetchError } = await supabaseClient
    .from('products')
    .select('current_stock')
    .eq('id', productId)
    .single();

  if (fetchError) throw fetchError;

  const stockBefore = product.current_stock;
  const stockAfter = physicalCount;
  const selisih = Math.abs(stockAfter - stockBefore);

  const { error: insertMovementError } = await supabaseClient
    .from('stock_movements')
    .insert({
      clinic_id: CURRENT_CLINIC_ID,
      product_id: productId,
      movement_type: 'opname_adjustment',
      quantity: selisih,
      stock_before: stockBefore,
      stock_after: stockAfter,
      opname_note: opnameNote,
      source_type: 'manual',
      performed_by: CURRENT_USER_ID
    });

  if (insertMovementError) throw insertMovementError;
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = type === 'success' ? 'status-success' : 'status-error';
  setTimeout(() => {
    statusDiv.className = '';
    statusDiv.textContent = '';
  }, 4000);
}
