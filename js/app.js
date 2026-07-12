// ============================================
// APP LOGIC - Form Input Stok (3 jenis transaksi)
// stock_movements: in, out, opname_adjustment
// Versi: P9 - Lot/Batch Tracking + FEFO otomatis
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

const DEFAULT_MIN_STOCK_PLACEHOLDER = 'Kosongkan jika belum tahu';
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

const productNameInput = document.getElementById('productName');
const categoryInput = document.getElementById('category');
const storageLocationInput = document.getElementById('storageLocation');
const unitInput = document.getElementById('unit');
const minimumStockInput = document.getElementById('minimumStock');

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
  const { data: products, error: productsError } = await supabaseClient
    .from('products')
    .select('category, storage_location, unit')
    .eq('clinic_id', CURRENT_CLINIC_ID);

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

function uniqueMerge(starterList, historyList) {
  const combined = starterList.concat(historyList);
  const seen = new Set();
  const result = [];

  combined.forEach(function(value) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  });

  return result;
}

function updateMetadataPlaceholders() {
  const typedName = productNameInput.value.trim().toLowerCase();

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
  // untuk produk existing (lihat handleStockIn).
  unitInput.value = '';
  unitInput.placeholder = 'Satuan saat ini: ' + matchedProduct.unit;
}

function resetMetadataPlaceholders() {
  categoryInput.placeholder = DEFAULT_CATEGORY_PLACEHOLDER;
  storageLocationInput.placeholder = DEFAULT_LOCATION_PLACEHOLDER;
  unitInput.placeholder = DEFAULT_UNIT_PLACEHOLDER;
  minimumStockInput.placeholder = DEFAULT_MIN_STOCK_PLACEHOLDER;
}

productNameInput.addEventListener('input', updateMetadataPlaceholders);

function renderProductResults(filterText) {
  const keyword = filterText.trim().toLowerCase();

  const filtered = keyword === ''
    ? ALL_PRODUCTS.slice(0, 50)
    : ALL_PRODUCTS.filter(function(p) { return p.name.toLowerCase().includes(keyword); }).slice(0, 50);

  productSearchResults.innerHTML = '';

  if (filtered.length === 0) {
    const noResult = document.createElement('div');
    noResult.className = 'product-search-no-result';
    noResult.textContent = 'Barang tidak ditemukan.';
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
  updateOpnamePreview();
}

function resetProductSelection() {
  productSelectedId.value = '';
  productSearchInput.value = '';
  delete productSearchInput.dataset.currentStock;
  productSearchResults.style.display = 'none';
  productSearchResults.innerHTML = '';
}

productSearchInput.addEventListener('focus', function() {
  renderProductResults('');
});

productSearchInput.addEventListener('input', function() {
  productSelectedId.value = '';
  renderProductResults(productSearchInput.value);
});

function setupSimpleAutocomplete(inputId, resultsId, getOptionsFn) {
  const input = document.getElementById(inputId);
  const resultsDiv = document.getElementById(resultsId);

  function render(filterText) {
    const keyword = filterText.trim().toLowerCase();
    const options = getOptionsFn();

    const filtered = keyword === ''
      ? options.slice(0, 50)
      : options.filter(function(v) { return v.toLowerCase().includes(keyword); }).slice(0, 50);

    resultsDiv.innerHTML = '';

    if (filtered.length === 0) {
      resultsDiv.style.display = 'none';
      return;
    }

    filtered.forEach(function(value) {
      const item = document.createElement('div');
      item.className = 'product-search-item';
      item.textContent = value;

      item.addEventListener('click', function() {
        input.value = value;
        resultsDiv.style.display = 'none';
        if (inputId === 'productName') {
          updateMetadataPlaceholders();
        }
      });

      resultsDiv.appendChild(item);
    });

    resultsDiv.style.display = 'block';
  }

  input.addEventListener('focus', function() {
    render('');
  });

  input.addEventListener('input', function() {
    render(input.value);
  });

  document.addEventListener('click', function(e) {
    const isClickInside = input.contains(e.target) || resultsDiv.contains(e.target);
    if (!isClickInside) {
      resultsDiv.style.display = 'none';
    }
  });
}

setupSimpleAutocomplete('productName', 'productNameResults', function() {
  return uniqueMerge([], ALL_PRODUCTS.map(function(p) { return p.name; }));
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

movementTypeSelect.addEventListener('change', function() {
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
  const msg = (error && error.message) || String(error);
  if (msg.includes('STOK_TIDAK_CUKUP')) {
    const match = msg.match(/kurang\s+(-?\d+)\s*unit/i);
    const kurang = match ? match[1] : '?';
    return 'Stok tidak cukup, kurang ' + kurang + ' unit dari yang diminta.';
  }
  return msg;
}

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

  let existingProductResult = await supabaseClient
    .from('products')
    .select('id')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('name', productName)
    .maybeSingle();

  if (existingProductResult.error) throw existingProductResult.error;

  const existingProduct = existingProductResult.data;
  let productId;

  if (existingProduct) {
    productId = existingProduct.id;
  } else {
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
    productId = insertResult.data.id;
  }

  const rpcResult = await supabaseClient.rpc('add_stock_lot', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_quantity: quantity,
    p_batch_number: batchNumber,
    p_expiry_date: expiryDate,
    p_user_id: CURRENT_USER_ID
  });

  if (rpcResult.error) throw rpcResult.error;
}

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

  const rpcResult = await supabaseClient.rpc('deduct_stock_fefo', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_quantity: quantity,
    p_movement_type: 'out',
    p_user_id: CURRENT_USER_ID,
    p_reason: reason
  });

  if (rpcResult.error) throw rpcResult.error;
}

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

  const rpcResult = await supabaseClient.rpc('adjust_stock_opname', {
    p_clinic_id: CURRENT_CLINIC_ID,
    p_product_id: productId,
    p_jumlah_fisik: physicalCount,
    p_user_id: CURRENT_USER_ID,
    p_opname_note: opnameNote
  });

  if (rpcResult.error) throw rpcResult.error;
}

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = type === 'success' ? 'status-success' : 'status-error';
  setTimeout(function() {
    statusDiv.className = '';
    statusDiv.textContent = '';
  }, 4000);
    }
