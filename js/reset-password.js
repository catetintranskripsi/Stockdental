// ============================================
// RESET PASSWORD LOGIC
// Halaman ini dibuka dari link di email "Reset Password"
// Supabase otomatis membuat session sementara dari token di URL
// ============================================

const resetFormView = document.getElementById('resetFormView');
const resetInvalidView = document.getElementById('resetInvalidView');
const formResetPassword = document.getElementById('formResetPassword');
const resetStatus = document.getElementById('resetStatus');

// ---------- CEK APAKAH USER DATANG DARI LINK RESET YANG VALID ----------
async function checkResetSession() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();

  if (error || !session) {
    showInvalidLink();
    return;
  }

  // Session ada = link valid, tampilkan form
  resetFormView.style.display = 'block';
  resetInvalidView.style.display = 'none';
}

function showInvalidLink() {
  resetFormView.style.display = 'none';
  resetInvalidView.style.display = 'block';
}

// ---------- SUBMIT PASSWORD BARU ----------
formResetPassword.addEventListener('submit', async (e) => {
  e.preventDefault();
  const resetBtn = document.getElementById('resetPasswordBtn');

  const newPassword = document.getElementById('newPassword').value;
  const newPasswordConfirm = document.getElementById('newPasswordConfirm').value;

  if (newPassword !== newPasswordConfirm) {
    showResetStatus('Password tidak cocok!', 'error');
    return;
  }

  resetBtn.disabled = true;
  resetBtn.textContent = 'Menyimpan...';

  const { error } = await supabaseClient.auth.updateUser({
    password: newPassword
  });

  resetBtn.disabled = false;
  resetBtn.textContent = 'Simpan Password Baru';

  if (error) {
    showResetStatus('Gagal mengubah password: ' + error.message, 'error');
    return;
  }

  showResetStatus('Password berhasil diubah! Mengalihkan ke login...', 'success');

  // Logout dari session sementara, lalu arahkan ke login dengan password baru
  await supabaseClient.auth.signOut();
  setTimeout(() => {
    window.location.href = 'index.html';
  }, 1500);
});

function showResetStatus(message, type) {
  resetStatus.textContent = message;
  resetStatus.className = 'status-message ' + (type === 'success' ? 'status-success' : 'status-error');
  resetStatus.style.display = 'block';
}

// Jalankan pengecekan saat halaman dimuat
checkResetSession();
