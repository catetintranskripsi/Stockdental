// ============================================
// Percakapan [Batas Jumlah Barang & Kunci Akun Expired] - UPGRADE PAGE
// Kerangka sederhana: tampilkan status langganan klinik saat ini +
// daftar harga dari subscription_plans (bukan hardcode di sini, supaya
// gampang diubah lewat UPDATE ke tabel, sesuai pola project ini).
//
// Tombol beli masih PLACEHOLDER -- alur pembayaran QRIS + webhook
// dibuat di sesi Payment Gateway Integration terpisah.
// ============================================

const currentStatusBox = document.getElementById('currentStatusBox');
const plansContainer = document.getElementById('plansContainer');

// Dipanggil oleh auth-check.js setelah user terverifikasi login
async function onPageReady() {
  await Promise.all([
    loadCurrentStatus(),
    loadPlans()
  ]);
}

async function loadCurrentStatus() {
  const { data, error } = await supabaseClient
    .from('subscriptions')
    .select('tier, status, expires_at')
    .eq('clinic_id', CURRENT_CLINIC_ID)
    .single();

  if (error || !data) {
    currentStatusBox.textContent = 'Status: Free';
    return;
  }

  if (data.tier === 'premium' && data.status === 'active') {
    const expiryText = data.expires_at
      ? `Berlaku sampai ${formatTanggalUpgrade(data.expires_at)}`
      : 'Berlaku selamanya';
    currentStatusBox.innerHTML = `<strong>Status saat ini: Premium ✅</strong><br>${expiryText}`;
  } else if (data.status === 'expired') {
    currentStatusBox.innerHTML = `<strong>Status saat ini: Premium (sudah berakhir)</strong><br>Perpanjang untuk pakai semua fitur lagi.`;
  } else {
    currentStatusBox.innerHTML = `<strong>Status saat ini: Free</strong>`;
  }
}

async function loadPlans() {
  const { data, error } = await supabaseClient
    .from('subscription_plans')
    .select('tier, ai_quota_daily, max_products, price_monthly, price_3month, price_yearly')
    .order('price_monthly', { ascending: true });

  if (error || !data) {
    plansContainer.innerHTML = '<p class="error-text">Gagal memuat paket. Coba refresh halaman.</p>';
    return;
  }

  plansContainer.innerHTML = data.map(plan => buildPlanCard(plan)).join('');
}

function buildPlanCard(plan) {
  const isPremium = plan.tier === 'premium';
  const maxProductsText = plan.max_products >= 999999 ? 'Tanpa batas' : `Maks. ${plan.max_products} jenis`;

  if (!isPremium) {
    return `
      <div class="plan-card">
        <div class="plan-title">Free</div>
        <div class="plan-price">Rp 0<small> / selamanya</small></div>
        <ul class="plan-features">
          <li>✓ Input manual: unlimited</li>
          <li>✓ AI foto & suara: ${plan.ai_quota_daily}x/hari</li>
          <li>✓ ${maxProductsText} barang di inventaris</li>
        </ul>
      </div>
    `;
  }

  return `
    <div class="plan-card premium">
      <div class="plan-title">Premium</div>
      <div class="plan-price">Rp ${plan.price_monthly.toLocaleString('id-ID')}<small> / bulan</small></div>
      <ul class="plan-features">
        <li>✓ Input manual: unlimited</li>
        <li>✓ AI foto & suara: ${plan.ai_quota_daily}x/hari + antrian prioritas</li>
        <li>✓ ${maxProductsText} barang di inventaris</li>
        <li>✓ Riwayat data 1 tahun</li>
      </ul>
      <button class="plan-buy-btn" onclick="handleBuyPlaceholder('monthly')">Pilih Bulanan — Rp ${plan.price_monthly.toLocaleString('id-ID')}</button>
      <p class="plan-note">3 bulan: Rp ${plan.price_3month.toLocaleString('id-ID')} · Tahunan: Rp ${plan.price_yearly.toLocaleString('id-ID')}</p>
    </div>
  `;
}

function handleBuyPlaceholder(period) {
  alert('Fitur pembayaran akan segera hadir. Untuk saat ini, hubungi admin StockDental untuk aktivasi Premium manual.');
}

function formatTanggalUpgrade(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}
