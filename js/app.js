// ============================================
// APP LOGIC - Form Input Stok (3 jenis transaksi)
// stock_movements: in, out, opname_adjustment
// ============================================

let CURRENT_CLINIC_ID = null;
let CURRENT_USER_ID = null;

const movementTypeSelect = document.getElementById('movementType');
const form = document.getElementById('formStockMovement');
const statusDiv = document.getElementById('statusMessage');
const submitBtn = document.getElementById('submitBtn');
const productSelect = document.getElementById('productSelect');
const productSelectGroup = document.getElementById('productSelectGroup');

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
  await loadProductOptions();
}

// Load daftar produk existing untuk dropdown (dipakai di Out & Opname)
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

  productSelect.innerHTML = '<option value="">-- Pilih Barang --</option>';
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (stok: ${p.current_stock} ${p.unit})`;
    opt.dataset.currentStock = p.current_stock;
    opt.dataset.unit = p.unit;
    productSelect.appendChild(opt);
  });
}

// Toggle field groups berdasarkan movement_type yang dipilih
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
});

// Live preview selisih opname saat user ketik jumlah fisik
document.getElementById('opnamePhysicalCount').addEventListener('input', () => {
  const selectedOption = productSelect.selectedOptions[0];
  if (!selectedOption || !selectedOption.value) return;

  const currentStock = parseFloat(selectedOption.dataset.currentStock);
  const physicalCount = parseFloat(document.getElementById('opnamePhysicalCount').value);

  if (isNaN(physicalCount)) {
    opnamePreview.textContent = '';
    return;
  }

  const selisih = physicalCount - currentStock;
  const arah = selisih > 0 ? 'lebih' : selisih < 0 ? 'kurang' : 'sama';
  opnamePreview.textContent = `Selisih: ${selisih > 0 ? '+' : ''}${selisih} (${arah}). Stok akan disesuaikan dari ${currentStock} → ${physicalCount}.`;
  opnamePreview.className = 'opname-preview ' + (selisih === 0 ? 'preview-neutral' : (selisih > 0 ? 'preview-plus' : 'preview-minus'));
});

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
  const productId = productSelect.value;
  const quantity = parseFloat(document.getElementById('outQuantity').value);
  const reason = document.getElementById('outReason').value;

  if (!productId || isNaN(quantity) || quantity <= 0) {
    throw new Error('Pilih barang dan isi jumlah dengan benar.');
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
  const productId = productSelect.value;
  const physicalCount = parseFloat(document.getElementById('opnamePhysicalCount').value);
  const opnameNote = document.getElementById('opnameNote').value.trim() || null;

  if (!productId || isNaN(physicalCount) || physicalCount < 0) {
    throw new Error('Pilih barang dan isi jumlah fisik dengan benar.');
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

