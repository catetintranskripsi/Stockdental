window.onerror = function(message, source, lineno, colno, error) {
  alert('ERROR: ' + message + '\nBaris: ' + lineno + '\nFile: ' + source);
};

// ============================================
// APP LOGIC - Form Input Stok (3 jenis transaksi)
// stock_movements: in, out, opname_adjustment
// Versi: P9 - Lot/Batch Tracking + FEFO otomatis
// Semua write lot+movement sekarang lewat RPC (atomik di database):
//   - add_stock_lot()        -> stock in (bikin lot baru)
//   - deduct_stock_fefo()    -> stock out (potong lot FEFO otomatis)
//   - adjust_stock_opname()  -> stok opname (selisih via FEFO / lot baru)
// products.current_stock disinkron otomatis oleh trigger trg_sync_current_stock
//
// Percakapan [lanjutan P10] - AUTOCOMPLETE/CREATABLE DROPDOWN
// Field Nama Barang, Kategori, Lokasi, Satuan, Nomor Batch searchable:
// histori diambil sekali saat load, di-cache, difilter lokal saat user
// mengetik. User tetap bisa ketik nilai baru yang belum ada.
//
// Percakapan [lanjutan P10, part 3] - INFO PLACEHOLDER UNTUK SEMUA
// FIELD METADATA (Kategori, Lokasi, Satuan, Stok Minimum)
// Saat nama barang yang diketik/dipilih cocok persis dengan produk
// existing, placeholder ke-4 field ini berubah jadi info nilai yang
// sudah tersimpan. Field-field ini TETAP kosong (kecuali Satuan yang
// punya default 'pcs'), tidak auto-fill ke value asli — supaya tidak
// ada risiko data lama tertimpa tanpa sadar. Saat submit, field yang
// dibiarkan kosong TIDAK mengubah data existing (lihat handleStockIn).
// Perubahan data existing (edit sungguhan) adalah domain fitur
// "Edit Data Barang" tersendiri, bukan bagian form ini.
// ============================================

let CURRENT_CLINIC_ID = null;
let CURRENT_USER_ID = null;
let ALL_PRODUCTS = []; // cache semua produk untuk difilter di searchable dropdown

// Cache untuk autocomplete field-field baru
let ALL_CATEGORIES = [];
let ALL_LOCATIONS = [];
let ALL_UNITS = [];
let ALL_BATCH_NUMBERS = [];

// Starter list (selalu muncul di awal, digabung dengan histori nyata)
const STARTER_CATEGORIES = ['APD', 'BMHP', 'Obat', 'Alat Kesehatan', 'Bahan Tambal/Restorasi', 'Lainnya'];
const STARTER_UNITS = ['pcs', 'box', 'botol', 'tube', 'dus', 'pack', 'set', 'lembar'];

const DEFAULT_MIN_STOCK_PLACEHOLDER = 'Kosongkan jika belum tahu';
const DEFAULT_CATEGORY_PLACEHOLDER = 'Contoh: APD, Obat, BMHP';
const DEFAULT_LOCATION_PLACEHOLDER = 'Contoh: Lemari A - Rak 2';
const DEFAULT_UNIT_PLACEHOLDER = 'pcs / box / botol';

const movementTypeSelect = document.getElementById('movementType');
const form = document.getElementById('formStockMovement');
const statusDiv = document.getElementById('statusMessage');
const submitBtn = document.getElementById('submitBtn');
const productSelectGroup = document.getElementById('productSelectGroup');

// Elemen searchable dropdown "Pilih Barang" (Out & Opname)
const productSearchInput = document.getElementById('productSearchInput');
const productSelectedId = document.getElementById('productSelectedId');
const productSearchResults = document.getElementById('productSearchResults');

// Field groups (tampil/sembunyi tergantung movementType)
const fieldsIn = document.getElementById('fieldsIn');
const fieldsOut = document.getElementById('fieldsOut');
const fieldsOpname = document.getElementById('fieldsOpname');
const opnamePreview = document.getElementById('opnamePreview');
const newProductFields = document.getElementById('newProductFields');

// Field-field yang butuh info placeholder saat produk existing dikenali
const productNameInput = document.getElementById('productName');
const categoryInput = document.getElementById('category');
const storageLocationInput = document.getElementById('storageLocation');
const unitInput = document.getElementById('unit');
const minimumStockInput = document.getElementById('minimumStock');

// Dipanggil dari auth.js setelah user berhasil login
async function onUserLoggedIn() {
  const { data: { user }, error: userAuthError } = await supabaseClient.auth.getUser();

  if (userAuthError || !user) {
    console.error('Gagal ambil user:', userAuthError);
    return;
  }

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
  await loadAutocompleteOptions();
}

// Load daftar produk existing ke cache ALL_PRODUCTS.
// Ambil semua kolom metadata (category, storage_location, unit,
// minimum_stock) supaya bisa dipakai untuk info placeholder.
async function loadProductOptions() {
  const { data: products, error } = await supabaseClient
    .from('products')
    .select('id, name, current_stock, unit, minimum_stock, category, storage_location')
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
// Load histori untuk autocomplete: kategori, lokasi, satuan, batch
// ============================================
async function loadAutocompleteOptions() {
  const { data: products, error: productsError } = await supabaseClient
    .from('products')
    .select('category, storage_location, unit')
    .eq('clinic_id', CURRENT_CLINIC_ID);

  if (productsError) {
    console.error('Gagal load histori kategori/lokasi/satuan:', productsError);
  } else if (products) {
    const categoriesFromHistory = products.map(p => p.category).filter(Boolean);
    const locationsFromHistory = products.map(p => p.storage_location).filter(Boolean);
    const unitsFromHistory = products.map(p => p.unit).filter(Boolean);

    ALL_CATEGORIES = uniqueMerge(STARTER_CATEGORIES, categoriesFromHistory);
    ALL_LOCATIONS = uniqueMerge([], locationsFromHistory);
    ALL_UNITS = uniqueMerge(STARTER_UNITS, unitsFromHistory);
  }

  const { data: lots, error: lotsError } = await supabaseClient
    .from('product_lots')
    .select('batch_number')
    .eq('clinic_id', CURRENT_CLINIC_ID);

  if (lotsError) {
    console.error('Gagal load histori batch number:', lotsError);
  } else if (lots) {
    const batchesFromHistory = lots.map(l => l.batch_number).filter(Boolean);
    ALL_BATCH_NUMBERS = uniqueMerge([], batchesFromHistory);
  }
}

// Gabung starter list + histori, hilangkan duplikat (case-insensitive)
function uniqueMerge(starterList, historyList) {
  const combined = [...starterList, ...historyList];
  const seen = new Set();
  const result = [];

  combined.forEach(value => {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  });

  return result;
}

// ============================================
// INFO PLACEHOLDER UNTUK 4 FIELD METADATA
// Dipanggil tiap kali field Nama Barang berubah. Kalau nama cocok
// PERSIS (case-insensitive) dengan produk yang sudah ada, placeholder
// ke-4 field metadata berubah jadi info nilai yang sudah tersimpan.
// Field TETAP kosong (tidak auto-fill value), murni info visual.
// ============================================
function updateMetadataPlaceholders() {
  const typedName = productNameInput.value.trim().toLowerCase();

  if (!typedName) {
    resetMetadataPlaceholders();
    return;
  }

  const matchedProduct = ALL_PRODUCTS.find(p => p.name.toLowerCase() === typedName);

  if (!matchedProduct) {
    resetMetadataPlaceholders();
    return;
  }

  categoryInput.placeholder = `Kategori saat ini: ${matchedProduct.category || '(belum diisi)'}`;
  storageLocationInput.placeholder = `Lokasi saat ini: ${matchedProduct.storage_location || '(belum diisi)'}`;
  unitInput.placeholder = `Satuan saat ini: ${matchedProduct.unit}`;
  minimumStockInput.placeholder = `Stok minimum saat ini: ${matchedProduct.minimum_stock}`;
}

function resetMetadataPlaceholders() {
  categoryInput.placeholder = DEFAULT_CATEGORY_PLACEHOLDER;
  storageLocationInput.placeholder = DEFAULT_LOCATION_PLACEHOLDER;
  unitInput.placeholder = DEFAULT_UNIT_PLACEHOLDER;
  minimumStockInput.placeholder = DEFAULT_MIN_STOCK_PLACEHOLDER;
}

productNameInput.addEventListener('input', updateMetadataPlaceholders);

// ============================================
// SEARCHABLE DROPDOWN LOGIC — "Pilih Barang" (Out & Opname)
// ============================================

function renderProductResults(filterText) {
  const keyword = filterText.trim().toLowerCase();

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

function selectProduct(product) {
  productSelectedId.value = product.id;
  productSearchInput.value = `${product.name} (stok: ${product.current_stock} ${product.unit})`;
  productSearchInput.dataset.currentStock = product.current_stock;
  productSearchResults.style.display = 'none';
  updateOpnamePreview();
}

function resetProductSelection() {
  productSelectedId.value = '';
  productSearchInput.value = '';
  delete productSearchInput.dataset.currentStock;
  productSearchResults.style.display = 'none';
  productSearchResults.innerHTML = '';
}

productSearchInput.addEventListener('focus', () => {
  renderProductResults('');
});

productSearchInput.addEventListener('input', () => {
  productSelectedId.value = '';
  renderProductResults(productSearchInput.value);
});

// ============================================
// SEARCHABLE DROPDOWN LOGIC — Generik, dipakai untuk 5 field baru
// ============================================

function setupSimpleAutocomplete(inputId, resultsId, getOptionsFn) {
  const input = document.getElementById(inputId);
  const resultsDiv = document.getElementById(resultsId);

  function render(filterText) {
    const keyword = filterText.trim().toLowerCase();
    const options = getOptionsFn();

    const filtered = keyword === ''
      ? options.slice(0, 50)
      : options.filter(v => v.toLowerCase().includes(keyword)).slice(0, 50);

    resultsDiv.innerHTML = '';

    if (filtered.length === 0) {
      resultsDiv.style.display = 'none';
      return;
    }

    filtered.forEach(value => {
      const item = document.createElement('div');
      item.className = 'product-search-item';
      item.textContent = value;

      item.addEventListener('click', () => {
        input.value = value;
        resultsDiv.style.display = 'none';
        // Kalau ini field Nama Barang, trigger juga update semua info placeholder
        if (inputId === 'productName') {
          updateMetadataPlaceholders();
        }
      });

      resultsDiv.appendChild(item);
    });

    resultsDiv.style.display = 'block';
  }

  input.addEventListener('focus', () => render(''));
  input.addEventListener('input', () => render(input.value));

  document.addEventListener('click', (e) => {
    const isClickInside = input.contains(e.target) || resultsDiv.contains(e.target);
    if (!isClickInside) {
      resultsDiv.style.display = 'none';
    }
  });
}

setupSimpleAutocomplete('productName', 'productNameResults', () => {
  return uniqueMerge([], ALL_PRODUCTS.map(p => p.name));
});

setupSimpleAutocomplete('category', 'categoryResults', () => ALL_CATEGORIES);
setupSimpleAutocomplete('storageLocation', 'storageLocationResults', () => ALL_LOCATIONS);
setupSimpleAutocomplete('unit', 'unitResults', () => ALL_UNITS);
setupSimpleAutocomplete('batchNumber', 'batchNumberResults', () => ALL_BATCH_NUMBERS);

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

  productSelectGroup.style.display = (type === 'out' || type === 'opname_adjustment') ? 'block' : 'none';
  newProductFields.style.display = (type === 'in') ? 'block' : 'none';

  resetProductSelection();
  resetMetadataPlaceholders();
});

function updateOpnamePreview() {
  const currentStock = parseFloat(productSearchInput.dataset.currentStock);
  const physicalCount = parseFloat(document.getElementById('opnamePhysicalCount').value);

  if (isNaN(currentStock) || isNaN(physicalCount)) {
    opnamePreview.textContent = '';
    return;
  }

  const selisih = physicalCount - currentStock;
  const arah = selisih > 0 ? 'lebih' : selisih < 0 ? 'kurang' : 'sama';
  opnamePreview.textContent = `Selisih: ${selisih > 0 ? '+' : ''}${selisih} (${arah}). Stok akan disesuaikan dari ${currentStock} -> ${physicalCount}.`;
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
    resetMetadataPlaceholders();
    await loadProductOptions();
    await loadAutocompleteOptions();

  } catch (error) {
    console.error('Error:', error);
    showStatus('Gagal menyimpan: ' + parseErrorMessage(error), 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan Transaksi';
  }
});

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
// CATATAN: kalau produk sudah ada (existingProduct), field category,
// storage_location, unit, minimum_stock yang diisi user di form ini
// TIDAK dipakai untuk update produk — cuma dipakai kalau produk BARU.
// Ini konsisten dengan prinsip "form ini untuk transaksi, bukan edit
// data produk" yang sudah disepakati.
// ============================================
async function handleStockIn() {
  const productName = document.getElementById('productName').value.trim();
  const category = document.getElementById('category').value.trim();
  const quantity = parseInt(document.getElementById('quantity').value, 10);
  const unit = document.getElementById('unit').value.trim() || 'pcs';
  const expiryDate = document.getElementById('expiryDate').value || null;
  const batchNumber = document.getElementById('batchNumber').value.trim() || null;
  const storageLocation = document.getElementById('storageLocation').value.trim();
  const minimumStockRaw = document.getElementById('minimumStock').value;
  const minimumStock = minimumStockRaw === '' ? 0 : parseFloat(minimumStockRaw);

  if (!productName || isNaN(quantity) || quantity <= 0) {
    throw new Error('Nama barang dan jumlah wajib diisi dengan benar.');
  }

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
    // Semua field metadata (category, storage_location, unit, minimum_stock)
    // diabaikan di sini untuk produk existing. Lihat catatan di atas fungsi.
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
// ============================================
async function handleOpname() {
  const productId = productSelectedId.value;
  const physicalCount = parseInt(document.getElementById('opnamePhysicalCount').value, 10);
  const opnameNote = document.getElementById('opnameNote').value.trim() || null;

  if (!productId) {
    throw new Error('Pilih barang dari daftar terlebih dahulu (klik salah satu hasil pencarian).');
  }

  if (isNaN(physicalCount) || ph
