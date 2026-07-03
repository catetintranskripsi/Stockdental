// ============================================
// APP LOGIC - Form Input Barang Manual
// Percakapan 4 - FORM SUBMIT LOGIC (pakai clinic_id dari session)
// ============================================

let CURRENT_CLINIC_ID = null;
let CURRENT_USER_ID = null;

const form = document.getElementById('formStockIn');
const statusDiv = document.getElementById('statusMessage');
const submitBtn = document.getElementById('submitBtn');

// Dipanggil dari auth.js setelah user berhasil login
async function onUserLoggedIn() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  CURRENT_USER_ID = user.id;

  // Ambil clinic_id dari tabel users berdasarkan auth user id
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
  console.log('Clinic ID siap:', CURRENT_CLINIC_ID);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!CURRENT_CLINIC_ID) {
    showStatus('Data klinik belum siap, coba refresh halaman.', 'error');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Menyimpan...';

  try {
    const productName = document.getElementById('productName').value.trim();
    const category = document.getElementById('category').value.trim();
    const quantity = parseFloat(document.getElementById('quantity').value);
    const unit = document.getElementById('unit').value.trim() || 'pcs';
    const expiryDate = document.getElementById('expiryDate').value || null;
    const storageLocation = document.getElementById('storageLocation').value.trim();
    const minimumStock = parseFloat(document.getElementById('minimumStock').value) || 0;

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

    const { error: insertStockError } = await supabaseClient
      .from('stock_in_history')
      .insert({
        clinic_id: CURRENT_CLINIC_ID,
        product_id: productId,
        quantity: quantity,
        expiry_date: expiryDate,
        source_type: 'manual',
        notes: ''
      });

    if (insertStockError) throw insertStockError;

    showStatus('Barang berhasil disimpan!', 'success');
    form.reset();
    document.getElementById('unit').value = 'pcs';

  } catch (error) {
    console.error('Error:', error);
    showStatus('Gagal menyimpan: ' + error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Simpan Barang';
  }
});

function showStatus(message, type) {
  statusDiv.textContent = message;
  statusDiv.className = type === 'success' ? 'status-success' : 'status-error';
  setTimeout(() => {
    statusDiv.className = '';
    statusDiv.textContent = '';
  }, 4000);
}
