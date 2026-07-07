// ============================================
// AUTH LOGIC - Login, Signup, Logout, Session
// Percakapan 4 - AUTH
// Fix: bottom nav tetap muncul saat showApp() dipanggil ulang
// ============================================

const loginView = document.getElementById('loginView');
const signupView = document.getElementById('signupView');
const authContainer = document.getElementById('authContainer');
const appContainer = document.getElementById('appContainer');

const formLogin = document.getElementById('formLogin');
const formSignup = document.getElementById('formSignup');
const loginStatus = document.getElementById('loginStatus');
const signupStatus = document.getElementById('signupStatus');
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
        clinic_name: clinicName
      }
    }
  });
  signupBtn.disabled = false;
  signupBtn.textContent = 'Daftar';

  if (error) {
    showAuthStatus(signupStatus, 'Gagal daftar: ' + error.message, 'error');
    return;
  }

  // Kalau project Supabase minta konfirmasi email, kasih tau user
  if (data.user && !data.session) {
    showAuthStatus(signupStatus, 'Berhasil daftar! Cek email untuk konfirmasi sebelum login.', 'success');
  } else {
    showAuthStatus(signupStatus, 'Berhasil daftar! Mengalihkan...', 'success');
    // Kalau langsung dapat session (auto-confirm), langsung ke Ringkasan
    setTimeout(() => {
      window.location.href = 'ringkasan.html';
    }, 1000);
  }
});

// ---------- LOGIN ----------
formLogin.addEventListener('submit', async (e) => {
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
    showApp();
  } else {
    showAuth();
  }
}

// ---------- TAMPILKAN APP (setelah login) ----------
function showApp() {
  authContainer.style.display = 'none';
  appContainer.style.display = 'block';

  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    bottomNav.style.display = 'flex';
  }

  if (typeof onUserLoggedIn === 'function') {
    onUserLoggedIn();
  }
}

// ---------- TAMPILKAN AUTH (belum login / logout) ----------
function showAuth() {
  appContainer.style.display = 'none';
  authContainer.style.display = 'block';
  loginView.style.display = 'block';
  signupView.style.display = 'none';

  // Sembunyikan bottom nav juga saat belum login
  const bottomNav = document.getElementById('bottomNav');
  if (bottomNav) {
    bottomNav.style.display = 'none';
  }
}

function showAuthStatus(el, message, type) {
  el.textContent = message;
  el.className = 'status-message ' + (type === 'success' ? 'status-success' : 'status-error');
  el.style.display = 'block';
}

// Jalankan pengecekan session begitu file ini di-load
checkSession();
