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
//
// Dulu semua testimoni ditumpuk sekaligus (block per testimoni) sehingga
// halaman makin panjang ke bawah seiring jumlah testimoni approved
// bertambah. Sekarang jadi carousel auto-rotate (1 slide tampil di satu
// waktu + dot indicator), sama seperti pola kartu "Tips StockDental" di
// ringkasan.html.
const TESTIMONIAL_ROTATE_MS = 6000;
let testimonialData = [];
let testimonialIndex = 0;
let testimonialInterval = null;

async function loadPublicTestimonials() {
  const wrapEl = document.getElementById('testimonialCarousel');
  if (!wrapEl) return;

  const { data, error } = await supabaseClient.rpc('get_public_testimonials');

  if (error || !data || data.length === 0) {
    wrapEl.style.display = 'none';
    return;
  }

  testimonialData = data;
  wrapEl.style.display = 'block';

  // Bangun struktur: 1 slide + dot indicator (dot cuma muncul kalau >1 testimoni)
  wrapEl.innerHTML = `
    <div class="testimonial-slide">
      <div class="testimonial-slide-stars" id="testimonialSlideStars"></div>
      <p class="testimonial-slide-text" id="testimonialSlideText"></p>
      <p class="testimonial-slide-clinic" id="testimonialSlideClinic"></p>
    </div>
    <div class="testimonial-dots" id="testimonialDots"></div>
  `;

  const dotsEl = document.getElementById('testimonialDots');
  if (testimonialData.length > 1) {
    testimonialData.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'testimonial-dot' + (i === 0 ? ' active' : '');
      dotsEl.appendChild(dot);
    });
  }

  testimonialIndex = 0;
  renderTestimonialSlide(0);

  if (testimonialData.length > 1) {
    if (testimonialInterval) clearInterval(testimonialInterval);
    testimonialInterval = setInterval(() => {
      testimonialIndex = (testimonialIndex + 1) % testimonialData.length;
      renderTestimonialSlide(testimonialIndex);
    }, TESTIMONIAL_ROTATE_MS);
  }
}

function renderTestimonialSlide(index) {
  const starsEl = document.getElementById('testimonialSlideStars');
  const textEl = document.getElementById('testimonialSlideText');
  const clinicEl = document.getElementById('testimonialSlideClinic');
  const dotsEl = document.getElementById('testimonialDots');
  if (!starsEl || !textEl || !clinicEl) return;

  const t = testimonialData[index];
  starsEl.textContent = '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating);
  textEl.textContent = `"${t.comment}"`;
  clinicEl.textContent = t.clinic_name;

  if (dotsEl) {
    Array.from(dotsEl.children).forEach((dot, i) => {
      dot.classList.toggle('active', i === index);
    });
  }
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
