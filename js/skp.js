// ============================================
// SKP.JS - Logic halaman Rekap SKP Dokter Gigi
// Fitur bonus Premium, terpisah total dari sistem stok (kuota AI
// terpisah, tabel terpisah: clinic_dentists, skp_monthly_entries,
// skp_activities). Bergantung pada js/skp-categories.js (harus
// dimuat sebelum file ini).
// ============================================

let skpCurrentDentistId = null;
// Catatan: state preview kini disimpan langsung di DOM (baris-baris
// #skpPreviewRows), bukan di variabel array terpisah, supaya proses
// menggabungkan hasil analisis berkali-kali (multi-foto per bulan)
// lebih sederhana -- lihat showPreview()/findPreviewRowByCategory().
let skpPendingSaveData = null; // dipakai saat conflict modal (ganti/edit/batal)

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  // GATE PREMIUM: fitur ini khusus Premium. User Free tetap boleh membuka
  // halaman (penjelasan fitur tampil sebagai etalase), tapi seluruh form
  // dan rekap disembunyikan diganti kartu "upgrade" -- pola sama seperti
  // banner locked di clinic-access.js untuk over-limit 70 barang.
  // Catatan: ini gate tampilan saja. Proteksi sebenarnya untuk AI ada di
  // Edge Function skp-ai-extract (cek tier di sisi server).
  // Kalau tier tidak diketahui (RPC gagal), dianggap Free -- lebih aman
  // menutup fitur daripada membukanya.
  const isPremium = LAST_KNOWN_CLINIC_ACCESS && LAST_KNOWN_CLINIC_ACCESS.tier === 'premium';
  if (!isPremium) {
    showSkpLockedState();
    return;
  }

  await loadDentistDropdown();
  setDefaultPeriodMonth();
  setupSkpEventListeners();
}

function showSkpLockedState() {
  const lockedCard = document.getElementById('skpLockedCard');
  const featureWrap = document.getElementById('skpFeatureWrap');
  if (lockedCard) lockedCard.style.display = 'block';
  if (featureWrap) featureWrap.style.display = 'none';
}

// ============================================
// DROPDOWN DOKTER
// ============================================
async function loadDentistDropdown() {
  const { data: dentists, error } = await supabaseClient
    .from('clinic_dentists')
    .select('id, name, str_number, sip_number, sip_start_date, sip_end_date')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    console.error('Gagal memuat daftar dokter:', error);
    return;
  }

  const selectEl = document.getElementById('skpDentistSelect');
  const emptyStateEl = document.getElementById('skpEmptyState');
  const contentEl = document.getElementById('skpDentistContent');

  selectEl.innerHTML = '<option value="">-- Pilih Dokter Gigi --</option>';

  if (!dentists || dentists.length === 0) {
    emptyStateEl.style.display = 'block';
    contentEl.style.display = 'none';
    return;
  }

  emptyStateEl.style.display = 'none';
  contentEl.style.display = 'block';

  dentists.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.name;
    selectEl.appendChild(opt);
  });

  // Simpan data dokter di memori supaya tidak perlu fetch ulang tiap ganti pilihan
  window._skpDentistCache = dentists;
}

function setDefaultPeriodMonth() {
  const input = document.getElementById('skpPeriodMonth');
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  input.value = `${yyyy}-${mm}`;

  // Filter rekap: default "bulan pertama" = bulan ini, durasi 6 bulan
  // (jadi tampilan awal langsung menampilkan sesuatu, bukan kosong).
  const startInput = document.getElementById('skpPeriodStartMonth');
  if (startInput) startInput.value = `${yyyy}-${mm}`;
}

// ============================================
// EVENT LISTENERS
// ============================================
function setupSkpEventListeners() {
  document.getElementById('skpDentistSelect').addEventListener('change', async (e) => {
    skpCurrentDentistId = e.target.value || null;
    if (skpCurrentDentistId) {
      await onDentistSelected();
    } else {
      document.getElementById('skpDentistHeader').style.display = 'none';
      document.getElementById('skpActivityList').innerHTML = '<p class="loading-text">Pilih dokter untuk melihat rekap...</p>';
    }
  });

  document.getElementById('skpManageDentistBtn').addEventListener('click', openDentistModal);
  document.getElementById('skpEmptyAddDentistBtn').addEventListener('click', openDentistModal);
  document.getElementById('skpDentistModalCloseBtn').addEventListener('click', closeDentistModal);
  document.getElementById('skpDentistFormCancelBtn').addEventListener('click', resetDentistForm);
  document.getElementById('skpDentistFormSaveBtn').addEventListener('click', saveDentistForm);

  document.getElementById('skpManualToggle').addEventListener('click', () => {
    const textarea = document.getElementById('skpManualText');
    const isHidden = textarea.style.display === 'none';
    textarea.style.display = isHidden ? 'block' : 'none';
  });

  document.getElementById('skpFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    document.getElementById('skpUploadFilename').textContent = file ? file.name : 'Belum ada file dipilih';
  });

  document.getElementById('skpAnalyzeBtn').addEventListener('click', handleAnalyze);
  document.getElementById('skpPreviewAddRow').addEventListener('click', () => addPreviewRow('', 1));
  document.getElementById('skpSaveBtn').addEventListener('click', handleSaveClick);

  document.getElementById('skpPeriodStartMonth').addEventListener('change', () => loadRecap());
  document.getElementById('skpPeriodDuration').addEventListener('change', () => loadRecap());
  document.getElementById('skpExportPdfBtn').addEventListener('click', openExportModal);

  // Modal konflik
  document.getElementById('skpConflictReplaceBtn').addEventListener('click', () => resolveConflict('replace'));
  document.getElementById('skpConflictEditBtn').addEventListener('click', () => resolveConflict('edit'));
  document.getElementById('skpConflictCancelBtn').addEventListener('click', () => resolveConflict('cancel'));

  // Modal export
  document.getElementById('skpExportModeFaskes').addEventListener('click', () => selectExportMode('faskes'));
  document.getElementById('skpExportModeMandiri').addEventListener('click', () => selectExportMode('mandiri'));
  document.getElementById('skpExportCancelBtn').addEventListener('click', closeExportModal);
  document.getElementById('skpExportConfirmBtn').addEventListener('click', handleExportPdf);
}

async function onDentistSelected() {
  document.getElementById('skpDentistHeader').style.display = 'block';
  document.getElementById('skpAnalyzeStatus').style.display = 'none';
  resetPreview(); // penting: kosongkan baris preview dokter sebelumnya, kalau ada
  await loadRecap();
}

// ============================================
// CRUD DOKTER
// ============================================
function openDentistModal() {
  renderDentistList();
  document.getElementById('skpDentistModal').style.display = 'flex';
}

function closeDentistModal() {
  document.getElementById('skpDentistModal').style.display = 'none';
  resetDentistForm();
}

function renderDentistList() {
  const wrap = document.getElementById('skpDentistListWrap');
  const dentists = window._skpDentistCache || [];

  if (dentists.length === 0) {
    wrap.innerHTML = '<p class="loading-text">Belum ada dokter terdaftar.</p>';
    return;
  }

  wrap.innerHTML = '';
  dentists.forEach(d => {
    const div = document.createElement('div');
    div.className = 'skp-dentist-list-item';
    div.innerHTML = `
      <span>${escapeSkpHtml(d.name)}</span>
      <span class="skp-dentist-list-actions">
        <button type="button" data-action="edit" data-id="${d.id}">✏️</button>
        <button type="button" data-action="delete" data-id="${d.id}">🗑️</button>
      </span>
    `;
    wrap.appendChild(div);
  });

  wrap.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => loadDentistIntoForm(btn.dataset.id));
  });
  wrap.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => deleteDentist(btn.dataset.id));
  });
}

function loadDentistIntoForm(id) {
  const d = (window._skpDentistCache || []).find(x => x.id === id);
  if (!d) return;

  document.getElementById('skpDentistFormId').value = d.id;
  document.getElementById('skpDentistFormName').value = d.name || '';
  document.getElementById('skpDentistFormStr').value = d.str_number || '';
  document.getElementById('skpDentistFormSip').value = d.sip_number || '';
  document.getElementById('skpDentistFormSipStart').value = d.sip_start_date || '';
  document.getElementById('skpDentistFormSipEnd').value = d.sip_end_date || '';
  document.getElementById('skpDentistFormTitle').textContent = 'Edit Dokter';
}

function resetDentistForm() {
  document.getElementById('skpDentistFormId').value = '';
  document.getElementById('skpDentistFormName').value = '';
  document.getElementById('skpDentistFormStr').value = '';
  document.getElementById('skpDentistFormSip').value = '';
  document.getElementById('skpDentistFormSipStart').value = '';
  document.getElementById('skpDentistFormSipEnd').value = '';
  document.getElementById('skpDentistFormTitle').textContent = 'Tambah Dokter Baru';
  document.getElementById('skpDentistFormStatus').style.display = 'none';
}

async function saveDentistForm() {
  const id = document.getElementById('skpDentistFormId').value;
  const name = document.getElementById('skpDentistFormName').value.trim();
  const strNumber = document.getElementById('skpDentistFormStr').value.trim();
  const sipNumber = document.getElementById('skpDentistFormSip').value.trim();
  const sipStart = document.getElementById('skpDentistFormSipStart').value || null;
  const sipEnd = document.getElementById('skpDentistFormSipEnd').value || null;
  const statusEl = document.getElementById('skpDentistFormStatus');

  if (!name) {
    showSkpStatus(statusEl, 'Nama dokter wajib diisi.', 'error');
    return;
  }

  const payload = {
    clinic_id: CURRENT_CLINIC_ID,
    name,
    str_number: strNumber || null,
    sip_number: sipNumber || null,
    sip_start_date: sipStart,
    sip_end_date: sipEnd
  };

  let error;
  if (id) {
    ({ error } = await supabaseClient.from('clinic_dentists').update(payload).eq('id', id));
  } else {
    ({ error } = await supabaseClient.from('clinic_dentists').insert(payload));
  }

  if (error) {
    showSkpStatus(statusEl, 'Gagal menyimpan: ' + error.message, 'error');
    return;
  }

  showSkpStatus(statusEl, 'Berhasil disimpan!', 'success');
  await loadDentistDropdown();
  renderDentistList();
  setTimeout(resetDentistForm, 800);
}

async function deleteDentist(id) {
  if (!confirm('Nonaktifkan dokter ini? Data rekap SKP yang sudah ada tidak akan terhapus.')) return;

  const { error } = await supabaseClient
    .from('clinic_dentists')
    .update({ is_active: false })
    .eq('id', id);

  if (error) {
    alert('Gagal menghapus: ' + error.message);
    return;
  }

  await loadDentistDropdown();
  renderDentistList();
}

// ============================================
// ANALISIS AI (foto/PDF/teks manual)
// ============================================
async function handleAnalyze() {
  const fileInput = document.getElementById('skpFileInput');
  const manualText = document.getElementById('skpManualText').value.trim();
  const statusEl = document.getElementById('skpAnalyzeStatus');
  const btn = document.getElementById('skpAnalyzeBtn');

  if (!fileInput.files[0] && !manualText) {
    showSkpStatus(statusEl, 'Upload foto/PDF atau isi teks manual dulu.', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Menganalisis...';
  showSkpStatus(statusEl, 'AI sedang membaca laporan...', 'info');

  try {
    let items;

    if (fileInput.files[0]) {
      items = await analyzeWithAI(fileInput.files[0]);
    } else {
      items = parseManualText(manualText);
    }

    if (!items || items.length === 0) {
      showSkpStatus(statusEl, 'Tidak ada tindakan yang bisa dikenali. Coba foto/teks lain, atau tambah manual di preview.', 'error');
      showPreview([]); // tetap tampilkan preview kosong supaya user bisa tambah manual
      return;
    }

    showSkpStatus(statusEl, `Berhasil! Ditemukan ${items.length} jenis tindakan dari file ini. Digabung ke preview di bawah -- upload file lain kalau masih ada, atau langsung Simpan kalau sudah lengkap.`, 'success');
    showPreview(items); // menggabungkan ke preview yang sudah ada, bukan mereset

    // Kosongkan file input & teks manual supaya jelas siap dipakai lagi
    // untuk foto/PDF berikutnya (satu bulan bisa terdiri dari beberapa file).
    fileInput.value = '';
    document.getElementById('skpUploadFilename').textContent = 'Belum ada file dipilih';
    document.getElementById('skpManualText').value = '';

  } catch (err) {
    console.error('Analyze error:', err);
    showSkpStatus(statusEl, 'Gagal menganalisis: ' + (err.message || 'Terjadi kesalahan.'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Analisis dengan AI';
  }
}

async function analyzeWithAI(file) {
  const base64 = await fileToBase64(file);
  const { data: { session } } = await supabaseClient.auth.getSession();

  const response = await fetch(`${SUPABASE_URL}/functions/v1/skp-ai-extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': SUPABASE_ANON_KEY
    },
    body: JSON.stringify({
      file_base64: base64,
      mime_type: file.type
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || 'Gagal menghubungi server AI.');
  }

  return result.items || [];
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Parsing teks manual sederhana: cocokkan kata kunci label kategori
// (case-insensitive, partial match) dengan angka terdekat di kalimat yang sama.
// Ini BUKAN AI -- pencarian teks biasa, jadi hasilnya kasar. User tetap
// diarahkan ke preview editable untuk koreksi.
function parseManualText(text) {
  const lines = text.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean);
  const found = [];

  lines.forEach(line => {
    const lower = line.toLowerCase();
    const numberMatch = line.match(/\d+/);
    const quantity = numberMatch ? parseInt(numberMatch[0], 10) : 1;

    let bestMatch = null;
    SKP_CATEGORIES.forEach(cat => {
      const labelLower = cat.label.toLowerCase();
      // Cek kecocokan kata kunci sederhana (bukan fuzzy matching)
      const keywords = labelLower.split(/[\s/]+/).filter(w => w.length > 3);
      const matchCount = keywords.filter(kw => lower.includes(kw)).length;
      if (matchCount > 0 && (!bestMatch || matchCount > bestMatch.score)) {
        bestMatch = { code: cat.code, score: matchCount };
      }
    });

    if (bestMatch) {
      found.push({ category_code: bestMatch.code, quantity });
    }
  });

  return found;
}

// ============================================
// PREVIEW EDITABLE
// ============================================
// Menggabungkan hasil analisis baru ke preview yang SUDAH ADA (bukan
// mereset), supaya user bisa upload beberapa foto/PDF untuk melengkapi
// data satu bulan sebelum klik Simpan. Kalau kategori yang sama sudah
// ada baris-nya di preview, quantity-nya DIJUMLAHKAN ke baris itu;
// kalau belum ada, baris baru ditambahkan.
function showPreview(newItems) {
  const container = document.getElementById('skpPreviewRows');

  newItems.forEach(newItem => {
    const existingRow = findPreviewRowByCategory(newItem.category_code);
    if (existingRow) {
      const qtyInput = existingRow.querySelector('.skp-preview-quantity');
      const currentQty = parseInt(qtyInput.value, 10) || 0;
      qtyInput.value = currentQty + newItem.quantity;
    } else {
      addPreviewRow(newItem.category_code, newItem.quantity);
    }
  });

  document.getElementById('skpPreviewSection').style.display = 'block';
}

// Cari baris preview yang kategorinya sudah dipilih sama dengan categoryCode
function findPreviewRowByCategory(categoryCode) {
  const rows = document.querySelectorAll('#skpPreviewRows .skp-preview-row');
  for (const row of rows) {
    const select = row.querySelector('.skp-preview-category');
    if (select.value === categoryCode) return row;
  }
  return null;
}

// Kosongkan seluruh preview (dipakai saat ganti dokter atau setelah simpan sukses)
function resetPreview() {
  document.getElementById('skpPreviewRows').innerHTML = '';
  document.getElementById('skpPreviewSection').style.display = 'none';
}

function addPreviewRow(selectedCode, quantity) {
  const container = document.getElementById('skpPreviewRows');
  const row = document.createElement('div');
  row.className = 'skp-preview-row';

  // Diurutkan alfabetis berdasarkan nama tindakan (bukan per-tier seperti
  // urutan asli di SKP_CATEGORIES) supaya mudah dicari user di dropdown.
  // Urutan asli SKP_CATEGORIES di skp-categories.js sengaja tidak diubah
  // (dipakai juga sebagai referensi di prompt AI), pengurutan hanya
  // dilakukan di sini saat membangun opsi dropdown.
  const sortedCategories = [...SKP_CATEGORIES].sort((a, b) => a.label.localeCompare(b.label));

  const optionsHtml = sortedCategories.map(cat =>
    `<option value="${cat.code}" ${cat.code === selectedCode ? 'selected' : ''}>${escapeSkpHtml(cat.label)} (${SKP_TIER_VALUE[cat.tier]} SKP)</option>`
  ).join('');

  row.innerHTML = `
    <select class="skp-preview-category">
      <option value="">-- Pilih Kategori --</option>
      ${optionsHtml}
    </select>
    <input type="number" class="skp-preview-quantity" min="1" value="${quantity || 1}">
    <button type="button" class="skp-preview-remove">✕</button>
  `;

  row.querySelector('.skp-preview-remove').addEventListener('click', () => row.remove());

  container.appendChild(row);
}

function collectPreviewData() {
  const rows = document.querySelectorAll('#skpPreviewRows .skp-preview-row');
  const data = [];

  rows.forEach(row => {
    const code = row.querySelector('.skp-preview-category').value;
    const qty = parseInt(row.querySelector('.skp-preview-quantity').value, 10);
    if (code && qty > 0) {
      const cat = findSkpCategory(code);
      if (cat) {
        data.push({
          category_code: code,
          category_label: cat.label,
          tier: cat.tier,
          skp_value_per_unit: SKP_TIER_VALUE[cat.tier],
          quantity: qty
        });
      }
    }
  });

  return data;
}

// ============================================
// SIMPAN (dengan cek konflik bulan)
// ============================================
async function handleSaveClick() {
  if (!skpCurrentDentistId) {
    alert('Pilih dokter dulu.');
    return;
  }

  const periodMonthInput = document.getElementById('skpPeriodMonth').value; // format YYYY-MM
  if (!periodMonthInput) {
    alert('Pilih periode bulan dulu.');
    return;
  }

  const patientCount = parseInt(document.getElementById('skpPatientCount').value, 10) || 0;
  const activities = collectPreviewData();

  if (activities.length === 0) {
    alert('Belum ada tindakan valid di preview. Pilih kategori dan isi jumlah dulu.');
    return;
  }

  const periodMonth = `${periodMonthInput}-01`;

  skpPendingSaveData = { periodMonth, patientCount, activities };

  // Cek apakah bulan ini sudah ada data
  const { data: checkResult, error: checkErr } = await supabaseClient
    .rpc('check_skp_month_exists', {
      p_dentist_id: skpCurrentDentistId,
      p_period_month: periodMonth
    });

  if (checkErr) {
    alert('Gagal memeriksa data: ' + checkErr.message);
    return;
  }

  const exists = checkResult && checkResult.length > 0 && checkResult[0].exists_flag;

  if (exists) {
    const monthLabel = formatMonthLabel(periodMonth);
    document.getElementById('skpConflictMessage').textContent =
      `Data bulan ${monthLabel} untuk dokter ini sudah ada (${checkResult[0].patient_count} pasien tercatat). Pilih tindakan:`;
    document.getElementById('skpConflictModal').style.display = 'flex';
  } else {
    await executeSave();
  }
}

async function resolveConflict(action) {
  document.getElementById('skpConflictModal').style.display = 'none';

  if (action === 'replace') {
    await executeSave();
  } else if (action === 'edit') {
    // Arahkan user ke rincian bulan itu di card (mereka edit manual dari sana)
    alert('Silakan scroll ke card tindakan di bawah, cari rincian bulan yang dimaksud, lalu gunakan tombol edit di baris tersebut.');
    skpPendingSaveData = null;
  } else {
    skpPendingSaveData = null;
  }
}

async function executeSave() {
  if (!skpPendingSaveData) return;

  const statusEl = document.getElementById('skpSaveStatus');
  const btn = document.getElementById('skpSaveBtn');
  btn.disabled = true;
  showSkpStatus(statusEl, 'Menyimpan...', 'info');

  const { periodMonth, patientCount, activities } = skpPendingSaveData;

  const { error } = await supabaseClient.rpc('replace_skp_monthly_data', {
    p_dentist_id: skpCurrentDentistId,
    p_period_month: periodMonth,
    p_patient_count: patientCount,
    p_activities: activities
  });

  btn.disabled = false;

  if (error) {
    showSkpStatus(statusEl, 'Gagal menyimpan: ' + error.message, 'error');
    return;
  }

  showSkpStatus(statusEl, 'Berhasil disimpan ke rekap!', 'success');
  skpPendingSaveData = null;

  // Reset form input setelah sukses -- termasuk KOSONGKAN baris preview
  // (bukan cuma disembunyikan), supaya sesi input bulan berikutnya mulai
  // dari nol, tidak ikut menjumlahkan sisa baris dari bulan sebelumnya.
  document.getElementById('skpFileInput').value = '';
  document.getElementById('skpUploadFilename').textContent = 'Belum ada file dipilih';
  document.getElementById('skpManualText').value = '';
  resetPreview();

  await loadRecap();
}

// ============================================
// REKAP & CARD TINDAKAN
// ============================================
async function loadRecap() {
  if (!skpCurrentDentistId) return;

  const { startMonth, endMonth } = getMonthRange();
  renderPeriodSummary(startMonth, endMonth);

  const dentist = (window._skpDentistCache || []).find(d => d.id === skpCurrentDentistId);
  if (dentist) {
    document.getElementById('skpHeaderName').textContent = dentist.name;
    const strSip = [
      dentist.str_number ? `STR: ${dentist.str_number}` : null,
      dentist.sip_number ? `SIP: ${dentist.sip_number}` : null
    ].filter(Boolean).join(' · ');
    document.getElementById('skpHeaderMeta').textContent = strSip || 'STR/SIP belum diisi';
  }

  const [recapResult, patientResult] = await Promise.all([
    supabaseClient.rpc('get_skp_recap', {
      p_dentist_id: skpCurrentDentistId,
      p_start_month: startMonth,
      p_end_month: endMonth
    }),
    supabaseClient.rpc('get_skp_patient_summary', {
      p_dentist_id: skpCurrentDentistId,
      p_start_month: startMonth,
      p_end_month: endMonth
    })
  ]);

  if (recapResult.error) {
    console.error('Gagal memuat rekap:', recapResult.error);
    document.getElementById('skpActivityList').innerHTML = '<p class="loading-text">Gagal memuat rekap.</p>';
    return;
  }

  const activities = recapResult.data || [];
  const patientSummary = (patientResult.data && patientResult.data[0]) || { total_patient_count: 0, monthly_breakdown: [] };

  renderActivityCards(activities, patientSummary);
  renderHeaderStats(activities, patientSummary);
}

function renderHeaderStats(activities, patientSummary) {
  const totalActivities = activities.reduce((sum, a) => sum + Number(a.total_quantity), 0);
  const totalSkpFromActivities = activities.reduce((sum, a) => sum + Number(a.total_skp), 0);
  const totalSkpFromPatients = hitungSkpPemeriksaan(Number(patientSummary.total_patient_count));
  const totalSkp = totalSkpFromActivities + totalSkpFromPatients;

  document.getElementById('skpHeaderPatients').textContent = patientSummary.total_patient_count;
  document.getElementById('skpHeaderActivities').textContent = totalActivities;
  document.getElementById('skpHeaderTotalSkp').textContent = totalSkp.toFixed(1);
}

function renderActivityCards(activities, patientSummary) {
  const container = document.getElementById('skpActivityList');
  container.innerHTML = '';

  // Card khusus Pemeriksaan/Diagnosis (dari jumlah pasien manual)
  const patientCount = Number(patientSummary.total_patient_count);
  if (patientCount > 0) {
    const skpFromPatients = hitungSkpPemeriksaan(patientCount);
    const card = document.createElement('div');
    card.className = 'skp-activity-card';
    card.innerHTML = `
      <p class="skp-activity-name">Pemeriksaan/Diagnosis</p>
      <p class="skp-activity-unit-value">Dihitung dari jumlah pasien (1-25 pasien/bulan = 2 SKP, >25 = 3 SKP)</p>
      <div class="skp-activity-totals">
        <div class="skp-activity-total-item">
          <strong>${patientCount}</strong>
          <span>Total Pasien</span>
        </div>
        <div class="skp-activity-total-item">
          <strong>${skpFromPatients}</strong>
          <span>Total SKP</span>
        </div>
      </div>
      ${renderMonthlyBreakdownHtml(patientSummary.monthly_breakdown, 'patient_count', 'pasien')}
    `;
    attachMonthlyToggle(card);
    container.appendChild(card);
  }

  if (activities.length === 0 && patientCount === 0) {
    container.innerHTML = '<p class="loading-text">Belum ada data untuk periode ini.</p>';
    return;
  }

  activities.forEach(act => {
    const card = document.createElement('div');
    card.className = 'skp-activity-card';
    card.innerHTML = `
      <p class="skp-activity-name">${escapeSkpHtml(act.category_label)}</p>
      <p class="skp-activity-unit-value">${act.skp_value_per_unit} SKP per tindakan</p>
      <div class="skp-activity-totals">
        <div class="skp-activity-total-item">
          <strong>${act.total_quantity}</strong>
          <span>Jumlah Tindakan</span>
        </div>
        <div class="skp-activity-total-item">
          <strong>${Number(act.total_skp).toFixed(1)}</strong>
          <span>Total SKP</span>
        </div>
      </div>
      ${renderMonthlyBreakdownHtml(act.monthly_breakdown, 'quantity', 'tindakan')}
    `;
    attachMonthlyToggle(card);
    container.appendChild(card);
  });
}

function renderMonthlyBreakdownHtml(breakdown, qtyField, unitLabel) {
  if (!breakdown || breakdown.length === 0) return '';

  const rows = breakdown.map(b => `
    <div class="skp-monthly-row">
      <span>${formatMonthLabel(b.period_month)}: ${b[qtyField]} ${unitLabel}</span>
    </div>
  `).join('');

  return `
    <button type="button" class="skp-activity-monthly-toggle">Lihat rincian per bulan (${breakdown.length})</button>
    <div class="skp-monthly-breakdown">${rows}</div>
  `;
}

function attachMonthlyToggle(cardEl) {
  const toggleBtn = cardEl.querySelector('.skp-activity-monthly-toggle');
  const breakdownEl = cardEl.querySelector('.skp-monthly-breakdown');
  if (!toggleBtn || !breakdownEl) return;

  toggleBtn.addEventListener('click', () => {
    breakdownEl.classList.toggle('show');
  });
}

// ============================================
// EXPORT PDF
// ============================================
let skpExportMode = 'faskes';

function openExportModal() {
  document.getElementById('skpExportModal').style.display = 'flex';
}

function closeExportModal() {
  document.getElementById('skpExportModal').style.display = 'none';
}

function selectExportMode(mode) {
  skpExportMode = mode;
  document.getElementById('skpExportModeFaskes').classList.toggle('selected', mode === 'faskes');
  document.getElementById('skpExportModeMandiri').classList.toggle('selected', mode === 'mandiri');
}

async function handleExportPdf() {
  const statusEl = document.getElementById('skpExportStatus');
  showSkpStatus(statusEl, 'Membuat PDF...', 'info');

  try {
    const { startMonth, endMonth } = getMonthRange();

    const [recapResult, patientResult, clinicResult] = await Promise.all([
      supabaseClient.rpc('get_skp_recap', { p_dentist_id: skpCurrentDentistId, p_start_month: startMonth, p_end_month: endMonth }),
      supabaseClient.rpc('get_skp_patient_summary', { p_dentist_id: skpCurrentDentistId, p_start_month: startMonth, p_end_month: endMonth }),
      supabaseClient.from('clinics').select('name, address').eq('id', CURRENT_CLINIC_ID).single()
    ]);

    const dentist = (window._skpDentistCache || []).find(d => d.id === skpCurrentDentistId);
    const activities = recapResult.data || [];
    const patientSummary = (patientResult.data && patientResult.data[0]) || { total_patient_count: 0 };
    const clinic = clinicResult.data || {};

    await generateSkpPdf({
      dentist,
      clinic,
      activities,
      patientCount: Number(patientSummary.total_patient_count),
      mode: skpExportMode,
      startMonth,
      endMonth
    });

    showSkpStatus(statusEl, 'PDF berhasil dibuat!', 'success');
    setTimeout(closeExportModal, 1000);

  } catch (err) {
    console.error('Export PDF error:', err);
    showSkpStatus(statusEl, 'Gagal membuat PDF: ' + err.message, 'error');
  }
}

async function generateSkpPdf({ dentist, clinic, activities, patientCount, mode, startMonth, endMonth }) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;
  const marginLeft = 50;

  // Kop surat (mode faskes) atau tanpa kop (mode mandiri)
  if (mode === 'faskes') {
    page.drawText(clinic.name || 'Nama Klinik', { x: marginLeft, y, size: 14, font: fontBold });
    y -= 18;
    if (clinic.address) {
      page.drawText(clinic.address, { x: marginLeft, y, size: 10, font });
      y -= 20;
    }
    page.drawLine({ start: { x: marginLeft, y }, end: { x: 545, y }, thickness: 1, color: rgb(0, 0, 0) });
    y -= 24;
  } else {
    y -= 10;
  }

  page.drawText('REKAP KEGIATAN RANAH PELAYANAN', { x: marginLeft, y, size: 13, font: fontBold });
  y -= 24;

  page.drawText(`Nama Dokter Gigi: ${dentist ? dentist.name : '-'}`, { x: marginLeft, y, size: 10, font });
  y -= 16;
  page.drawText(`Nomor STR: ${dentist && dentist.str_number ? dentist.str_number : '-'}`, { x: marginLeft, y, size: 10, font });
  y -= 16;
  page.drawText(`Nomor SIP: ${dentist && dentist.sip_number ? dentist.sip_number : '-'}`, { x: marginLeft, y, size: 10, font });
  y -= 16;
  page.drawText(`Periode: ${formatMonthLabel(startMonth)} - ${formatMonthLabel(endMonth)}`, { x: marginLeft, y, size: 10, font });
  y -= 28;

  // Tabel header
  const col1 = marginLeft, col2 = 320, col3 = 420, col4 = 490;
  page.drawText('Kegiatan', { x: col1, y, size: 10, font: fontBold });
  page.drawText('Nilai SKP/tindakan', { x: col2, y, size: 10, font: fontBold });
  page.drawText('Jumlah', { x: col3, y, size: 10, font: fontBold });
  page.drawText('Total SKP', { x: col4, y, size: 10, font: fontBold });
  y -= 6;
  page.drawLine({ start: { x: marginLeft, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  y -= 16;

  // Baris Pemeriksaan/Diagnosis
  if (patientCount > 0) {
    const skpPemeriksaan = hitungSkpPemeriksaan(patientCount);
    page.drawText('Pemeriksaan/Diagnosis', { x: col1, y, size: 9, font });
    page.drawText('-', { x: col2, y, size: 9, font });
    page.drawText(`${patientCount} pasien`, { x: col3, y, size: 9, font });
    page.drawText(String(skpPemeriksaan), { x: col4, y, size: 9, font });
    y -= 16;
  }

  let grandTotalSkp = patientCount > 0 ? hitungSkpPemeriksaan(patientCount) : 0;

  activities.forEach(act => {
    if (y < 80) return; // guard sederhana, versi awal tidak handle multi-page
    page.drawText(act.category_label, { x: col1, y, size: 9, font });
    page.drawText(String(act.skp_value_per_unit), { x: col2, y, size: 9, font });
    page.drawText(String(act.total_quantity), { x: col3, y, size: 9, font });
    page.drawText(Number(act.total_skp).toFixed(1), { x: col4, y, size: 9, font });
    y -= 16;
    grandTotalSkp += Number(act.total_skp);
  });

  y -= 10;
  page.drawLine({ start: { x: marginLeft, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
  y -= 20;
  page.drawText(`TOTAL SKP: ${grandTotalSkp.toFixed(1)}`, { x: col1, y, size: 11, font: fontBold });

  // Kolom tanda tangan
  y -= 60;
  if (mode === 'faskes') {
    page.drawText('Penanggung Jawab', { x: 380, y, size: 9, font });
    y -= 50;
    page.drawText('(_____________________)', { x: 380, y, size: 9, font });
  } else {
    page.drawText('(Materai Rp10.000)', { x: 380, y, size: 8, font });
    y -= 50;
    page.drawText(`drg. ${dentist ? dentist.name : '_____________________'}`, { x: 380, y, size: 9, font });
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Rekap-SKP-${dentist ? dentist.name.replace(/\s+/g, '-') : 'dokter'}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================
// HELPERS
// ============================================
// Filter periode berbasis "bulan awal yang dipilih user + durasi", BUKAN
// "mundur N bulan dari hari ini" -- supaya user bisa jangkau periode lama
// (misal data 3 tahun lalu), tidak terbatas cuma yang baru-baru ini.
function getMonthRange() {
  const startInput = document.getElementById('skpPeriodStartMonth').value; // 'YYYY-MM'
  const durationMonths = parseInt(document.getElementById('skpPeriodDuration').value, 10);

  if (!startInput) {
    // Guard: kalau somehow kosong, fallback ke bulan ini saja
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return { startMonth: `${ym}-01`, endMonth: `${ym}-01` };
  }

  const [y, m] = startInput.split('-').map(Number);
  const startMonth = `${y}-${String(m).padStart(2, '0')}-01`;

  const endDate = new Date(y, (m - 1) + (durationMonths - 1), 1);
  const endMonth = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-01`;

  return { startMonth, endMonth };
}

function renderPeriodSummary(startMonth, endMonth) {
  const el = document.getElementById('skpPeriodSummary');
  if (!el) return;
  el.textContent = `Menampilkan: ${formatMonthLabel(startMonth)} - ${formatMonthLabel(endMonth)}`;
}

function formatMonthLabel(dateStr) {
  const d = new Date(dateStr + (dateStr.length === 7 ? '-01' : ''));
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function showSkpStatus(el, message, type) {
  el.textContent = message;
  el.className = 'status-message ' + (type === 'success' ? 'status-success' : type === 'error' ? 'status-error' : '');
  el.style.display = 'block';
}

function escapeSkpHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}
