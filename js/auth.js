// ============================================
// AUTH LOGIC - Login, Signup, Logout, Session
// Percakapan 4 - AUTH (awal)
// Percakapan 6 - tambah clinic_name di signup, redirect ke ringkasan.html
// ============================================

const loginView = document.getElementById('loginView');
const signupView = document.getElementById('signupView');
const forgotPasswordView = document.getElementById('forgotPasswordView');
const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');

const formLogin = document.getElementById('formLogin');
const formSignup = document.getElementById('formSignup');
const formForgotPassword = document.getElementById('formForgotPassword');
const loginStatus = document.getElementById('loginStatus');
const signupStatus = document.getElementById('signupStatus');
const forgotPasswordStatus = document.getElementById('forgotPasswordStatus');
const logoutBtn = document.getElementById('logoutBtn');

// ---------- SWITCH ANTARA LOGIN & SIGNUP ----------
document.getElementById('showSignup').addEventListener('click', (e) => {
  e.preventDefault();
  loginView.style.display = 'none';
  signupView.style.display = 'block';
});

document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  signupView.style.display = 'none';
  loginView.style.display = 'block';
});

document.getElementById('showForgotPassword').addEventListener('click', (e) => {
  e.preventDefault();
  loginView.style.display = 'none';
  forgotPasswordView.style.display = 'block';
});

document.getElementById('backToLoginFromForgot').addEventListener('click', (e) => {
  e.preventDefault();
  forgotPasswordView.style.display = 'none';
  loginView.style.display = 'block';
});

// ---------- SIGNUP ----------
formSignup.addEventListener('submit', async (e) => {
  e.preventDefault();
  const signupBtn = document.getElementById('signupBtn');

  const clinicName = document.getElementById('signupClinicName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

  if (!clinicName) {
    showAuthStatus(signupStatus, 'Nama klinik/rumah sakit wajib diisi!', 'error');
    return;
  }

  if (password !== passwordConfirm) {
    showAuthStatus(signupStatus, 'Password tidak cocok!', 'error');
    return;
  }

  signupBtn.disabled = true;
  signupBtn.textContent = 'Mendaftar...';

  const { data, error } = await supabaseClient.auth.signUp({
    email: email,
    password: password,
    options: {
      data: {
        clinic_name: clinicName,
        display_name: clinicName
      }
    }
  });

  signupBtn.disabled = false;
  signupBtn.textContent = 'Daftar';

  if (error) {
    showAuthStatus(signupStatus, 'Gagal daftar: ' + error.message, 'error');
    return;
  }

  if (data.user && !data.session) {
    showAuthStatus(signupStatus, 'Berhasil daftar! Cek email untuk konfirmasi sebelum login.', 'success');
  } else {
    showAuthStatus(signupStatus, 'Berhasil daftar! Mengalihkan...', 'success');
    setTimeout(() => {
      window.location.href = 'ringkasan.html';
    }, 1000);
  }
});

// ---------- FORGOT PASSWORD ----------
formForgotPassword.addEventListener('submit', async (e) => {
  e.preventDefault();
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');

  const email = document.getElementById('forgotEmail').value.trim();

  forgotPasswordBtn.disabled = true;
  forgotPasswordBtn.textContent = 'Mengirim...';

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/reset-password.html'
  });

  forgotPasswordBtn.disabled = false;
  forgotPasswordBtn.textContent = 'Kirim Link Reset';

  if (error) {
    showAuthStatus(forgotPasswordStatus, 'Gagal mengirim: ' + error.message, 'error');
    return;
  }

  showAuthStatus(forgotPasswordStatus, 'Link reset password sudah dikirim! Cek email kamu (termasuk folder spam) - email akan datang dari Supabase, bukan dari StockDental.', 'success');
});

// ---------- LOGIN ----------
formLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  const loginBtn = document.getElementById('loginBtn');

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  loginBtn.disabled = true;
  loginBtn.textContent = 'Login...';

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: email,
    password: password
  });

  loginBtn.disabled = false;
  loginBtn.textContent = 'Login';

  if (error) {
    showAuthStatus(loginStatus, 'Gagal login: ' + error.message, 'error');
    return;
  }

  showAuthStatus(loginStatus, 'Login berhasil!', 'success');
  window.location.href = 'ringkasan.html';
});

// ---------- LOGOUT ----------
logoutBtn.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  showAuth();
});

// ---------- CEK SESSION SAAT PAGE LOAD ----------
async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  if (session) {
    await showApp();
  } else {
    showAuth();
  }
}

// ---------- TAMPILKAN APP (setelah login) ----------
async function showApp() {
  authContainer.style.display = 'none';
  appContainer.style.display = 'block';

  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    bottomNav.style.display = 'flex';
  }

  if (typeof onUserLoggedIn === 'function') {
    await onUserLoggedIn();
  }
}

// ---------- TAMPILKAN AUTH (belum login / logout) ----------
function showAuth() {
  appContainer.style.display = 'none';
  authContainer.style.display = 'block';
  loginView.style.display = 'block';
  signupView.style.display = 'none';
  forgotPasswordView.style.display = 'none';

  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    bottomNav.style.display = 'none';
  }

  loadPublicTestimonials();
}

// ---------- TESTIMONI PUBLIK DI HALAMAN LOGIN ----------
// Ambil testimoni yang sudah di-approve (RPC get_public_testimonials,
// aman dipanggil tanpa login karena RLS hanya izinkan baca status
// 'approved'). Kalau kosong/gagal, section disembunyikan saja.
async function loadPublicTestimonials() {
  const wrapEl = document.getElementById('testimonialCarousel');
  if (!wrapEl) return;

  const { data, error } = await supabaseClient.rpc('get_public_testimonials');

  if (error || !data || data.length === 0) {
    wrapEl.style.display = 'none';
    return;
  }

  wrapEl.style.display = 'block';
  wrapEl.innerHTML = data.map(t => `
    <div class="testimonial-slide">
      <div class="testimonial-slide-stars">${'★'.repeat(t.rating)}${'☆'.repeat(5 - t.rating)}</div>
      <p class="testimonial-slide-text">"${escapeAuthHtml(t.comment)}"</p>
      <p class="testimonial-slide-clinic">${escapeAuthHtml(t.clinic_name)}</p>
    </div>
  `).join('');
}

// Escape sederhana untuk cegah HTML injection dari komentar/nama klinik
function escapeAuthHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function showAuthStatus(el, message, type) {
  el.textContent = message;
  el.className = 'status-message ' + (type === 'success' ? 'status-success' : 'status-error');
  el.style.display = 'block';
}

// Jalankan pengecekan session
checkSession();
