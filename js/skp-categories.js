// ============================================
// SKP-CATEGORIES.JS
// Daftar tetap kategori tindakan Ranah Pelayanan sesuai
// Kebijakan Pengelolaan Kecukupan SKP Dokter Gigi (Kolegium Dokter Gigi
// Indonesia / Kemenkes, KMK HK.01.07/MENKES/1561/2024).
//
// Daftar ini SENGAJA dikodekan sebagai konstanta (bukan tabel database)
// karena isinya berasal dari peraturan resmi pemerintah, bukan data yang
// tumbuh dinamis seperti nama produk klinik. Dipakai bersama oleh:
//   1. Prompt Gemini AI (skp-ai-helper / Edge Function) -- daftar ini
//      dikirim ke AI sebagai referensi pemetaan istilah bebas
//      ("composite filling") ke nama resmi ("Tumpatan Kelas I").
//   2. Dropdown kategori di preview editable (skp.js) -- supaya user
//      bisa koreksi manual kalau AI salah pilih kategori.
//
// PENTING: Kategori "Pemeriksaan/Diagnosis" TIDAK ada di daftar ini.
// Nilainya dihitung terpisah dari field "Jumlah Pasien" manual (lihat
// hitungSkpPemeriksaan() di bawah), bukan dari hasil ekstraksi AI foto/PDF.
// ============================================

const SKP_TIER_VALUE = {
  sederhana: 0.5,
  menengah: 1,
  lanjut: 1.5
};

const SKP_TIER_LABEL = {
  sederhana: 'Tingkat Sederhana',
  menengah: 'Tingkat Menengah',
  lanjut: 'Tingkat Lanjut'
};

// Setiap entri: { code, label, tier }
// skp_value_per_unit diambil otomatis dari SKP_TIER_VALUE[tier], tidak
// diulang di sini supaya kalau ada perubahan aturan nilai per tier,
// cukup ubah di satu tempat (SKP_TIER_VALUE).
const SKP_CATEGORIES = [
  // ---------- TINGKAT SEDERHANA (0,5 SKP/tindakan) ----------
  { code: 'swab_jaringan_lunak', label: 'Swab jaringan lunak rongga mulut', tier: 'sederhana' },
  { code: 'tumpatan_kelas_1', label: 'Tumpatan Kelas I', tier: 'sederhana' },
  { code: 'tumpatan_kelas_3', label: 'Tumpatan Kelas III', tier: 'sederhana' },
  { code: 'tumpatan_kelas_5', label: 'Tumpatan Kelas V', tier: 'sederhana' },
  { code: 'pencabutan_gigi_sulung', label: 'Pencabutan gigi sulung', tier: 'sederhana' },
  { code: 'topikal_aplikasi_preventif', label: 'Topikal aplikasi bahan preventif', tier: 'sederhana' },
  { code: 'restorasi_preventif', label: 'Restorasi preventif', tier: 'sederhana' },
  { code: 'pulp_capping', label: 'Pulp capping', tier: 'sederhana' },
  { code: 'terapi_hipersensitif_dentin', label: 'Terapi hipersensitif dentin', tier: 'sederhana' },
  { code: 'relining_reparasi_gigi_tiruan', label: 'Relining/reparasi gigi tiruan', tier: 'sederhana' },

  // ---------- TINGKAT MENENGAH (1 SKP/tindakan) ----------
  { code: 'tumpatan_kelas_2', label: 'Tumpatan Kelas II', tier: 'menengah' },
  { code: 'tumpatan_kelas_6', label: 'Tumpatan Kelas VI', tier: 'menengah' },
  { code: 'inlay', label: 'Inlay', tier: 'menengah' },
  { code: 'onlay', label: 'Onlay', tier: 'menengah' },
  { code: 'pencabutan_metode_tertutup', label: 'Pencabutan metode tertutup', tier: 'menengah' },
  { code: 'insisi_drainase', label: 'Insisi/drainase', tier: 'menengah' },
  { code: 'psa_sulung', label: 'Perawatan Saluran Akar gigi sulung (vital/non-vital)', tier: 'menengah' },
  { code: 'psa_permanen_akar_tunggal', label: 'Perawatan Saluran Akar gigi permanen akar tunggal', tier: 'menengah' },
  { code: 'skeling_root_planing', label: 'Skeling/Root Planing', tier: 'menengah' },
  { code: 'kuretase', label: 'Kuretase', tier: 'menengah' },
  { code: 'occlusal_adjustment', label: 'Occlusal adjustment', tier: 'menengah' },
  { code: 'gigi_tiruan_lepasan', label: 'Gigi tiruan lepasan', tier: 'menengah' },

  // ---------- TINGKAT LANJUT (1,5 SKP/tindakan) ----------
  { code: 'odontektomi_kelas_1a', label: 'Odontektomi Kelas I posisi A', tier: 'lanjut' },
  { code: 'alveolektomi', label: 'Alveolektomi', tier: 'lanjut' },
  { code: 'reposisi_sendi_tmj', label: 'Reposisi sendi TMJ', tier: 'lanjut' },
  { code: 'mahkota_logam_sulung', label: 'Perawatan mahkota logam gigi sulung', tier: 'lanjut' },
  { code: 'space_maintainer', label: 'Space maintainer', tier: 'lanjut' },
  { code: 'space_regainer', label: 'Space regainer', tier: 'lanjut' },
  { code: 'psa_permanen_akar_ganda', label: 'Perawatan Saluran Akar gigi permanen akar ganda', tier: 'lanjut' },
  { code: 'pemasangan_pasak', label: 'Pemasangan pasak', tier: 'lanjut' },
  { code: 'mahkota', label: 'Mahkota', tier: 'lanjut' },
  { code: 'pemutihan_gigi', label: 'Pemutihan gigi', tier: 'lanjut' },
  { code: 'splinting', label: 'Splinting', tier: 'lanjut' },
  { code: 'gingivektomi_operkulektomi', label: 'Gingivektomi/operkulektomi', tier: 'lanjut' },
  { code: 'bedah_flap_periodontal', label: 'Bedah flap periodontal', tier: 'lanjut' },
  { code: 'gigi_tiruan_cekat', label: 'Gigi tiruan cekat', tier: 'lanjut' },
  { code: 'perawatan_maloklusi_kelas_1', label: 'Perawatan maloklusi Kelas I', tier: 'lanjut' },
  { code: 'veneer', label: 'Veneer', tier: 'lanjut' }
];

// Helper: ambil nilai SKP per unit untuk 1 kategori (dari tier-nya)
function getSkpValuePerUnit(categoryCode) {
  const cat = SKP_CATEGORIES.find(c => c.code === categoryCode);
  if (!cat) return 0;
  return SKP_TIER_VALUE[cat.tier];
}

// Helper: cari data kategori lengkap dari code
function findSkpCategory(categoryCode) {
  return SKP_CATEGORIES.find(c => c.code === categoryCode) || null;
}

// ============================================
// Kategori Pemeriksaan/Diagnosis -- TERPISAH dari daftar di atas.
// Dihitung otomatis dari field "Jumlah Pasien" manual per bulan, BUKAN
// dari hasil ekstraksi AI foto/PDF. Aturan dari PDF KDG:
//   1-25 pasien/bulan  -> 2 SKP
//   >25 pasien/bulan   -> 3 SKP
// ============================================
function hitungSkpPemeriksaan(patientCount) {
  if (!patientCount || patientCount <= 0) return 0;
  return patientCount <= 25 ? 2 : 3;
}

// Dipakai untuk membangun daftar referensi kategori yang dikirim ke prompt AI
// (Edge Function skp-ai-helper), format ringkas: "code|label" per baris.
function buildCategoryPromptReference() {
  return SKP_CATEGORIES.map(c => `${c.code}|${c.label}|${SKP_TIER_LABEL[c.tier]}`).join('\n');
}
