// ============================================
// APP LOGIC - Form Input Stok (3 jenis transaksi)
// stock_movements: in, out, opname_adjustment
// Versi: P10 - Unifikasi Barang Masuk & Stok Opname utk produk baru
//
// Percakapan [Unifikasi Barang Masuk/Stok Opname] - perubahan alur:
// - Barang Masuk & Stok Opname sekarang SAMA-SAMA bisa dipakai utk barang
//   baru (dulu cuma Barang Masuk yang bisa). User cari nama dulu lewat
//   productSearchInput; kalau ketemu & dipilih -> field produk baru
//   disembunyikan (existing product, cuma isi jumlah). Kalau tidak
//   ketemu/belum dipilih -> field produk baru (newProductFields) muncul.
// - Barang Keluar TETAP wajib pilih dari dropdown (tidak ada mode
//   produk baru) -- kalau search kosong, tampilkan pesan arahan ke
//   Stok Opname.
// - Field newProductFields (nama, kategori, lokasi, stok min, satuan,
//   expiry, batch) sekarang SHARED, dipakai gantian oleh Barang Masuk
//   maupun Stok Opname -- lihat resetNewProductFields() supaya tidak
//   ada nilai nyangkut saat pindah jenis transaksi.
// - Stok Opname produk baru memanggil add_stock_lot() dengan
//   p_movement_type: 'opname_adjustment' (bukan RPC adjust_stock_opname
//   biasa), supaya expiry & batch number tetap tersimpan sekaligus
//   Riwayat mencatat jenis transaksi yang benar. Lihat migration
//   [add_movement_type_param_to_add_stock_lot] di Supabase.
// ============================================

let CURRENT_CLINIC_ID = null;
let CURRENT_USER_ID = null;
let ALL_PRODUCTS = [];

let ALL_CATEGORIES = [];
let ALL_LOCATIONS = [];
let ALL_UNITS = [];
let ALL_BATCH_NUMBERS = [];

const STARTER_CATEGORIES = ['APD', 'BMHP', 'Obat', 'Alat Kesehatan', 'Bahan Tambal/Restorasi', 'Lainnya'];
const STARTER_UNITS = ['pcs', 'box', 'botol', 'tube', 'dus', 'pack', 'set', 'lembar'];

const DEFAULT_MIN_STOCK_PLACEHOLDER = 'Kosongkan jika belum tahu (cth: 3 atau 0.25 utk 1/4)';
const DEFAULT_CATEGORY_PLACEHOLDER = 'Contoh: APD, Obat, BMHP';
const DEFAULT_LOCATION_PLACEHOLDER = 'Contoh: Lemari A - Rak 2';
const DEFAULT_UNIT_PLACEHOLDER = 'pcs / box / botol';

const movementTypeSelect = document.getElementById('movementType');
const form = document.getElementById('formStockMovement');
const statusDiv = document.getElementById('statusMessage');
const submitBtn = document.getElementById('submitBtn');
const productSelectGroup = document.getElementById('productSelectGroup');

const productSearchInput = document.getElementById('productSearchInput');
const productSelectedId = document.getElementById('productSelectedId');
const productSearchResults = document.getElementById('productSearchResults');

const fieldsIn = document.getElementById('fieldsIn');
const fieldsOut = document.getElementById('fieldsOut');
const fieldsOpname = document.getElementById('fieldsOpname');
const opnamePreview = document.getElementById('opnamePreview');
const newProductFields = document.getElementById('newProductFields');
const lotFields = document.getElementById('lotFields');

const categoryInput = document.getElementById('category');
const storageLocationInput = document.getElementById('storageLocation');
const unitInput = document.getElementById('unit');
const minimumStockInput = document.getElementById('minimumStock');

// Percakapan [Unifikasi Barang Masuk/Stok Opname] - jenis transaksi yang
// boleh menampilkan field produk baru (Barang Keluar TIDAK termasuk,
// karena tidak boleh dipakai utk barang yang belum pernah tercatat).
const TYPES_ALLOWING_NEW_PRODUCT = ['in', 'opname_adjustment'];

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

  // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - cek status
  // akses klinik (locked kalau expired + jumlah barang > batas free).
  // Fungsi ini didefinisikan di js/clinic-access.js
  await checkClinicAccessAndRenderBanner();

  await loadProductOptions();
  await loadAutocompleteOptions();
}

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

async function loadAutocompleteOptions() {
  // Percakapan [Fix: Nama Barang Hilang Setelah Dihapus] - filter
  // is_active=true, supaya barang yang sudah dihapus tidak lagi muncul
  // di dropdown autocomplete kategori/lokasi/satuan.
  const { data: products, error: productsError } = await supabaseClient
    .from('products')
    .select('category, storage_location, unit')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true);

  if (productsError) {
    console.error('Gagal load histori kategori/lokasi/satuan:', productsError);
  } else if (products) {
    const categoriesFromHistory = products.map(function(p) { return p.category; }).filter(Boolean);
    const locationsFromHistory = products.map(function(p) { return p.storage_location; }).filter(Boolean);
    const unitsFromHistory = products.map(function(p) { return p.unit; }).filter(Boolean);

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
    const batchesFromHistory = lots.map(function(l) { return l.batch_number; }).filter(Boolean);
    ALL_BATCH_NUMBERS = uniqueMerge([], batchesFromHistory);
  }
}

// CATATAN: uniqueMerge() dan setupSimpleAutocomplete() TIDAK lagi
// didefinisikan di sini -- dipindah ke js/autocomplete-helper.js supaya
// bisa dipakai bersama oleh foto.js, suara.js, dan inventaris.js juga.
// File autocomplete-helper.js WAJIB di-load sebelum app.js di index.html.

function updateMetadataPlaceholders() {
  const typedName = productSearchInput.value.trim().toLowerCase();

  if (!typedName) {
    resetMetadataPlaceholders();
    return;
  }

  const matchedProduct = ALL_PRODUCTS.find(function(p) {
    return p.name.toLowerCase() === typedName;
  });

  if (!matchedProduct) {
    resetMetadataPlaceholders();
    return;
  }

  categoryInput.placeholder = 'Kategori saat ini: ' + (matchedProduct.category || '(belum diisi)');
  storageLocationInput.placeholder = 'Lokasi saat ini: ' + (matchedProduct.storage_location || '(belum diisi)');
  minimumStockInput.placeholder = 'Stok minimum saat ini: ' + matchedProduct.minimum_stock;

  // Satuan beda dari field lain: selalu ada default value "pcs",
  // jadi placeholder tidak akan kelihatan kalau tidak dikosongkan dulu.
  // Aman dikosongkan karena field ini diabaikan sepenuhnya saat submit
  // untuk produk existing (lihat handleStockIn/handleOpname).
  unitInput.value = '';
  unitInput.placeholder = 'Satuan saat ini: ' + matchedProduct.unit;
}

function resetMetadataPlaceholders() {
  categoryInput.placeholder = DEFAULT_CATEGORY_PLACEHOLDER;
  storageLocationInput.placeholder = DEFAULT_LOCATION_PLACEHOLDER;
  unitInput.placeholder = DEFAULT_UNIT_PLACEHOLDER;
  minimumStockInput.placeholder = DEFAULT_MIN_STOCK_PLACEHOLDER;
}

// Percakapan [Unifikasi Barang Masuk/Stok Opname] - bersihkan semua
// field produk baru + kembalikan ke default. Dipanggil setiap kali
// ganti jenis transaksi & setelah submit sukses, supaya tidak ada nilai
// "nyangkut" dari transaksi sebelumnya (field ini dipakai gantian oleh
// Barang Masuk maupun Stok Opname).
function resetNewProductFields() {
  categoryInput.value = '';
  storageLocationInput.value = '';
  minimumStockInput.value = '';
  unitInput.value = 'pcs';
  document.getElementById('expiryDate').value = '';
  document.getElementById('batchNumber').value = '';
  resetMetadataPlaceholders();
}

function renderProductResults(filterText) {
  const keyword = filterText.trim().toLowerCase();
  const movementType = movementTypeSelect.value;

  const filtered = keyword === ''
    ? ALL_PRODUCTS.slice(0, 50)
    : ALL_PRODUCTS.filter(function(p) { return p.name.toLowerCase().includes(keyword); }).slice(0, 50);

  productSearchResults.innerHTML = '';

  if (filtered.length === 0) {
    const noResult = document.createElement('div');
    noResult.className = 'product-search-no-result';

    // Percakapan [Unifikasi Barang Masuk/Stok Opname] - Barang Keluar
    // TIDAK boleh dipakai utk barang baru, jadi kalau search kosong,
    // arahkan user ke Stok Opname alih-alih pesan generik.
    if (movementType === 'out') {
      noResult.textContent = 'Barang belum pernah tercatat, silakan input dulu melalui Stok Fisik Saat Ini.';
    } else {
      noResult.textContent = 'Barang tidak ditemukan. Ini akan tercatat sebagai barang baru -- lengkapi data di bawah.';
    }

    productSearchResults.appendChild(noResult);
    productSearchResults.style.display = 'block';
    return;
  }

  filtered.forEach(function(p) {
    const item = document.createElement('div');
    item.className = 'product-search-item';
    item.textContent = p.name + ' (stok: ' + p.current_stock + ' ' + p.unit + ')';
    item.dataset.id = p.id;
    item.dataset.currentStock = p.current_stock;
    item.dataset.unit = p.unit;
    item.dataset.name = p.name;

    item.addEventListener('click', function() {
      selectProduct(p);
    });

    productSearchResults.appendChild(item);
  });

  productSearchResults.style.display = 'block';
}

function selectProduct(product) {
  productSelectedId.value = product.id;
  productSearchInput.value = product.name + ' (stok: ' + product.current_stock + ' ' + product.unit + ')';
  productSearchInput.dataset.currentStock = product.current_stock;
  productSearchResults.style.display = 'none';

  // Percakapan [Unifikasi Barang Masuk/Stok Opname] - barang sudah ada
  // di sistem -> sembunyikan field produk baru, cukup isi jumlah.
  newProductFields.style.display = 'none';
  resetNewProductFields();

  // Percakapan [Fix: Expiry/Batch Selalu Muncul di Barang Masuk] - beda
  // dari newProductFields, lotFields TIDAK otomatis disembunyikan di sini
  // -- toggleLotFields() yang menentukan (tetap tampil kalau jenis
  // transaksinya Barang Masuk, walau barangnya sudah existing).
  toggleLotFields();

  updateOpnamePreview();
}

function resetProductSelection() {
  productSelectedId.value = '';
  productSearchInput.value = '';
  delete productSearchInput.dataset.currentStock;
  productSearchResults.style.display = 'none';
  productSearchResults.innerHTML = '';
  resetMetadataPlaceholders();
}

// Percakapan [Unifikasi Barang Masuk/Stok Opname] - tampilkan/sembunyikan
// newProductFields tergantung: (a) jenis transaksi mengizinkan produk
// baru, DAN (b) user belum memilih barang existing dari dropdown.
function toggleNewProductFields() {
  const movementType = movementTypeSelect.value;
  const allowsNewProduct = TYPES_ALLOWING_NEW_PRODUCT.includes(movementType);
  const hasSelectedExisting = !!productSelectedId.value;

  newProductFields.style.display = (allowsNewProduct && !hasSelectedExisting) ? 'block' : 'none';
}

// Percakapan [Fix: Expiry/Batch Selalu Muncul di Barang Masuk] -
// lotFields (expiry & batch) TIDAK ikut logic yang sama dengan
// newProductFields. Barang Masuk SELALU lot baru (expiry/batch kiriman
// baru bisa beda dari lot sebelumnya, walau nama produknya sudah ada di
// Inventaris) -> lotFields SELALU tampil untuk jenis 'in', apapun status
// existing-nya. Stok Fisik Saat Ini untuk barang existing = koreksi pada
// stok yang sudah ada (bukan lot baru) -> lotFields ikut sembunyi sama
// seperti newProductFields. Barang Keluar = tidak pernah tampil.
function toggleLotFields() {
  const movementType = movementTypeSelect.value;
  const hasSelectedExisting = !!productSelectedId.value;

  if (movementType === 'in') {
    lotFields.style.display = 'block';
  } else if (movementType === 'opname_adjustment') {
    lotFields.style.display = hasSelectedExisting ? 'none' : 'block';
  } else {
    lotFields.style.display = 'none';
  }
}

productSearchInput.addEventListener('focus', function() {
  renderProductResults(productSearchInput.value);
});

productSearchInput.addEventListener('input', function() {
  productSelectedId.value = '';
  renderProductResults(productSearchInput.value);
  toggleNewProductFields();
  toggleLotFields();
  updateMetadataPlaceholders();
});

setupSimpleAutocomplete('category', 'categoryResults', function() {
  return ALL_CATEGORIES;
});

setupSimpleAutocomplete('storageLocation', 'storageLocationResults', function() {
  return ALL_LOCATIONS;
});

setupSimpleAutocomplete('unit', 'unitResults', function() {
  return ALL_UNITS;
});

setupSimpleAutocomplete('batchNumber', 'batchNumberResults', function() {
  return ALL_BATCH_NUMBERS;
});

document.addEventListener('click', function(e) {
  const isClickInside = productSearchInput.contains(e.target) || productSearchResults.contains(e.target);
  if (!isClickInside) {
    productSearchResults.style.display = 'none';
  }
});

// Percakapan [Keterangan Jenis Transaksi] - teks bantuan singkat di bawah
// dropdown, supaya user paham kapan pakai jenis transaksi yang mana
// tanpa perlu buka tutorial terpisah.
// Percakapan [Unifikasi Barang Masuk/Stok Opname] - teks hint diupdate:
// Barang Masuk & Stok Opname sekarang sama-sama bisa utk barang baru.
const MOVEMENT_TYPE_HINTS = {
  in: 'Barang baru datang dari supplier/pembelian. Cari dulu namanya -- kalau belum pernah tercatat, lengkapi data barangnya di bawah.',
  out: 'Barang dipakai untuk pasien/operasional. Contoh: hari ini alginat habis 1 bungkus, maka input pemakaian alginat di sini sebagai 1 bungkus. Hanya bisa untuk barang yang sudah pernah tercatat.',
  opname_adjustment: 'Catat jumlah fisik barang yang ada di klinik sekarang.'
};
const movementTypeHint = document.getElementById('movementTypeHint');

movementTypeSelect.addEventListener('change', function() {
  const type = movementTypeSelect.value;

  fieldsIn.style.display = type === 'in' ? 'block' : 'none';
  fieldsOut.style.display = type === 'out' ? 'block' : 'none';
  fieldsOpname.style.display = type === 'opname_adjustment' ? 'block' : 'none';
  opnamePreview.textContent = '';

  // Percakapan [Unifikasi Barang Masuk/Stok Opname] - dropdown pencarian
  // sekarang tampil utk KETIGA jenis transaksi (in/out/opname), bukan
  // cuma out/opname seperti dulu.
  productSelectGroup.style.display = (type === 'in' || type === 'out' || type === 'opname_adjustment') ? 'block' : 'none';

  if (movementTypeHint) {
    if (MOVEMENT_TYPE_HINTS[type]) {
      movementTypeHint.textContent = MOVEMENT_TYPE_HINTS[type];
      movementTypeHint.style.display = 'block';
    } else {
      movementTypeHint.textContent = '';
      movementTypeHint.style.display = 'none';
    }
  }

  resetProductSelection();
  resetNewProductFields();
  toggleNewProductFields();
  toggleLotFields();
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
  opnamePreview.textContent = 'Selisih: ' + (selisih > 0 ? '+' : '') + selisih + ' (' + arah + '). Stok akan disesuaikan dari ' + currentStock + ' -> ' + physicalCount + '.';
  opnamePreview.className = 'opname-preview ' + (selisih === 0 ? 'preview-neutral' : (selisih > 0 ? 'preview-plus' : 'preview-minus'));
}

document.getElementById('opnamePhysicalCount').addEventListener('input', updateOpnamePreview);

form.addEventListener('submit', async function(e) {
  e.preventDefault();

  if (!CURRENT_CLINIC_ID) {
    showStatus('Data klinik belum siap, coba refresh halaman.', 'error');
    return;
  }

  // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - tolak semua
  // jenis transaksi (in/out/opname) kalau klinik locked. CLINIC_LOCKED
  // diisi oleh checkClinicAccessAndRenderBanner() di js/clinic-access.js.
  if (CLINIC_LOCKED) {
    showStatus('Langganan sudah berakhir dan jumlah barang melebihi batas gratis. Kurangi jumlah jenis barang di Inventaris atau perpanjang Premium untuk lanjut.', 'error');
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
    lotFields.style.display = 'none';
    resetProductSelection();
    resetNewProductFields();
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
  const msg = (error && error.message) || String(error);
  if (msg.includes('STOK_TIDAK_CUKUP')) {
    const match = msg.match(/kurang\s+(-?\d+)\s*unit/i);
    const kurang = match ? match[1] : '?';
    return 'Stok tidak cukup, kurang ' + kurang + ' unit dari yang diminta.';
  }
  return msg;
}

// Percakapan [Unifikasi Barang Masuk/Stok Opname] - dipakai bersama oleh
// handleStockIn() & handleOpname() untuk insert produk baru (nama,
// kategori, satuan, lokasi, stok minimum), termasuk cek limit 70 jenis
// barang. Mengembalikan productId baru.
async function insertNewProduct() {
  const productName = productSearchInput.value.trim();
  const category = document.getElementById('category').value.trim();
  const unit = document.getElementById('unit').value.trim() || 'pcs';
  const storageLocation = document.getElementById('storageLocation').value.trim();
  const minimumStockRaw = document.getElementById('minimumStock').value;
  const minimumStock = minimumStockRaw === '' ? 0 : parseFloat(minimumStockRaw);

  if (!productName) {
    throw new Error('Nama barang wajib diisi.');
  }

  // Percakapan [Fix: Nama Barang Hilang Setelah Dihapus] - WAJIB filter
  // is_active=true. Tanpa ini, produk yang sudah di-soft-delete masih
  // "ketemu", sehingga input berikutnya dengan nama sama malah nge-restock
  // ke baris mati itu (tidak pernah muncul lagi di Inventaris).
  let existingProductResult = await supabaseClient
    .from('products')
    .select('id')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('name', productName)
    .eq('is_active', true)
    .maybeSingle();

  if (existingProductResult.error) throw existingProductResult.error;

  if (existingProductResult.data) {
    // Nama persis sudah ada tapi user tidak memilihnya dari dropdown
    // (mungkin typo pas ngetik ulang) -- pakai saja produk yang ada,
    // supaya tidak accidentally bikin percobaan insert duplikat.
    return existingProductResult.data.id;
  }

  // Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - cek limit
  // HANYA untuk produk baru (bukan restock produk lama), karena limit
  // ini soal jumlah JENIS barang, bukan jumlah transaksi.
  const limitCheck = await supabaseClient.rpc('check_product_limit', {
    p_clinic_id: CURRENT_CLINIC_ID
  });

  if (limitCheck.error) throw limitCheck.error;

  if (limitCheck.data.allowed === false) {
    throw new Error(
      `Batas jenis barang tercapai (${limitCheck.data.product_count}/${limitCheck.data.max_products}). ` +
      `Upgrade ke Premium untuk tambah jenis barang baru, atau hapus barang lama di Inventaris.`
    );
  }

  const insertResult = await supabaseClient
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

  if (insertResult.error) throw insertResult.error;
  return insertResult.data.id;
}

async function handleStockIn() {
  const isNewProduct = !productSelectedId.value;
  const quantity = parseFloat(document.getElementById('quantity').value);

  // Percakapan [Format Tanggal DDMMYYYY] - parse & validasi input manual
  const expiryRaw = document.getElementById('expiryDate').value;
  const expiryParsed = parseDDMMYYYY(expiryRaw);
  if (!expiryParsed.valid) {
    showStatus(expiryParsed.error, 'error');
    return;
  }
  const expiryDate = expiryParsed.isoDate;
  const batchNumber = document.getElementById('batchNumber').value.trim() || null;

  if (isNaN(quantity) || quantity <= 0) {
    throw new Error('Nama barang dan jumlah wajib diisi dengan benar.');
  }

  let productId;
  if (isNewProduct) {
    productId = await insertNewProduct();
  } else {
    productId = productSelectedId.value;
  }

  const rpcResult = await supabaseClient.rpc('add_stock_lot', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_quantity: quantity,
    p_batch_number: batchNumber,
    p_expiry_date: expiryDate,
    p_user_id: CURRENT_USER_ID,
    p_movement_type: 'in'
  });

  if (rpcResult.error) throw rpcResult.error;
}

async function handleStockOut() {
  const productId = productSelectedId.value;
  const quantity = parseFloat(document.getElementById('outQuantity').value);

  if (!productId) {
    throw new Error('Barang belum dipilih. Klik salah satu hasil pencarian di bawah kolom nama barang. Kalau tidak muncul hasil, berarti barang ini belum pernah diinput -- input dulu lewat Stok Fisik Saat Ini.');
  }

  if (isNaN(quantity) || quantity <= 0) {
    throw new Error('Isi jumlah dengan benar.');
  }

  const rpcResult = await supabaseClient.rpc('deduct_stock_fefo', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_quantity: quantity,
    p_movement_type: 'out',
    p_user_id: CURRENT_USER_ID,
    p_reason: null
  });

  if (rpcResult.error) throw rpcResult.error;
}

async function handleOpname() {
  const isNewProduct = !productSelectedId.value;

  if (isNewProduct) {
    // Percakapan [Unifikasi Barang Masuk/Stok Opname] - produk baru lewat
    // Stok Opname: insert produk (sama seperti Barang Masuk), lalu pakai
    // add_stock_lot() dengan p_movement_type: 'opname_adjustment' supaya
    // expiry/batch tetap tersimpan TAPI Riwayat mencatat sebagai opname,
    // bukan barang masuk biasa. adjust_stock_opname() RPC lama TIDAK
    // dipakai di sini karena dia hardcode expiry/batch = NULL.
    const physicalCount = parseFloat(document.getElementById('opnamePhysicalCount').value);

    if (isNaN(physicalCount) || physicalCount < 0) {
      throw new Error('Isi jumlah fisik dengan benar.');
    }

    const expiryRaw = document.getElementById('expiryDate').value;
    const expiryParsed = parseDDMMYYYY(expiryRaw);
    if (!expiryParsed.valid) {
      showStatus(expiryParsed.error, 'error');
      return;
    }
    const expiryDate = expiryParsed.isoDate;
    const batchNumber = document.getElementById('batchNumber').value.trim() || null;

    const productId = await insertNewProduct();

    // physicalCount = 0 valid secara input (misal barang baru dicatat
    // habis), tapi tidak ada gunanya bikin lot kosong -- skip lot kalau 0.
    if (physicalCount > 0) {
      const rpcResult = await supabaseClient.rpc('add_stock_lot', {
        p_clinic_id: CURRENT_CLINIC_ID,
        p_product_id: productId,
        p_quantity: physicalCount,
        p_batch_number: batchNumber,
        p_expiry_date: expiryDate,
        p_user_id: CURRENT_USER_ID,
        p_movement_type: 'opname_adjustment'
      });

      if (rpcResult.error) throw rpcResult.error;
    }

    return;
  }

  // Produk sudah ada -- behavior lama, tidak berubah.
  const productId = productSelectedId.value;
  const physicalCount = parseFloat(document.getElementById('opnamePhysicalCount').value);

  if (!productId) {
    throw new Error('Barang belum dipilih. Klik salah satu hasil pencarian di bawah kolom nama barang.');
  }

  if (isNaN(physicalCount) || physicalCount < 0) {
    throw new Error('Isi jumlah fisik dengan benar.');
  }

  const rpcResult = await supabaseClient.rpc('adjust_stock_opname', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_jumlah_fisik: physicalCount,
    p_user_id: CURRENT_USER_ID,
    p_opname_note: null
  });

  if (rpcResult.error) throw rpcResult.error;
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = 'status-message status-' + (type === 'success' ? 'success' : 'error');
  statusDiv.style.display = 'block';

  // Percakapan [Perbaikan Pesan Status] - auto-scroll ke pesan error, biar
  // user pasti lihat (tombol Simpan Transaksi ada di atasnya, jadi pesan
  // yang muncul di bawah bisa tidak kelihatan tanpa scroll manual).
  // Pesan sukses TIDAK di-scroll -- kalau submit berhasil, user sudah
  // melihat form-nya, tidak perlu dipaksa scroll ke bawah.
  if (type !== 'success') {
    statusDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  setTimeout(function() {
    statusDiv.className = '';
    statusDiv.style.display = 'none';
    statusDiv.textContent = '';
  }, 7000);
}

/* ============================================
   INSTALL TO HOME SCREEN — tombol di index.html (dekat form
   login, elemen #installAppBtn). Berjalan independen dari logic
   form di atas, tidak menyentuh flow auth sama sekali.

   KHUSUS iOS/Safari SAJA. Alasan: iOS tidak mendukung event
   'beforeinstallprompt' sama sekali, jadi satu-satunya cara install
   di iOS adalah menuntun user manual lewat modal instruksi
   (#iosInstallOverlay). Untuk Android/Chrome, kita SENGAJA TIDAK
   intercept 'beforeinstallprompt' (tidak preventDefault) supaya
   Chrome menampilkan mini infobar/pop-up install bawaannya sendiri
   secara otomatis begitu syarat installability terpenuhi (manifest +
   service worker) -- ini behavior default browser, tidak perlu
   tombol custom di halaman.
   ============================================ */
(function setupInstallToHomeScreen() {
  const installBtn = document.getElementById('installAppBtn');
  if (!installBtn) return; // elemen tidak ada di halaman ini, skip

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // fallback lama utk iOS Safari

  if (isStandalone) return; // sudah ter-install, tombol tetap hidden

  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  if (!isIos) return; // Android/Chrome: biarkan browser urus sendiri, tombol tetap hidden

  // iOS: tidak ada prompt otomatis, tampilkan tombol -> buka modal instruksi
  installBtn.style.display = 'flex';
  installBtn.addEventListener('click', function() {
    const overlay = document.getElementById('iosInstallOverlay');
    if (overlay) overlay.classList.add('show');
  });

  const closeBtn = document.getElementById('iosInstallCloseBtn');
  const overlay = document.getElementById('iosInstallOverlay');
  if (closeBtn && overlay) {
    closeBtn.addEventListener('click', function() {
      overlay.classList.remove('show');
    });
    // Tap area gelap di luar sheet juga menutup modal
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  }
})();

/* ============================================
   REGISTRASI SERVICE WORKER — syarat wajib supaya Chrome
   menganggap situs ini installable (tanpa ini, baik pop-up
   otomatis Chrome MAUPUN tombol iOS di atas sama-sama tidak akan
   pernah terpicu). Tidak melakukan caching/offline mode apa pun,
   cuma pass-through ke network -- lihat isi service-worker.js.
   ============================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/service-worker.js').catch(function(err) {
      console.warn('Gagal daftar service worker:', err);
    });
  });
}
