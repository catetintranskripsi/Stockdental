// ============================================
// AUTOCOMPLETE HELPER (dipakai bersama)
// Percakapan [Perbaikan Dropdown Foto/Suara/Edit Inventaris]
//
// Diambil dari js/app.js (dulu bernama setupSimpleAutocomplete di sana,
// hanya bisa dipakai untuk elemen statis dengan id tetap). Di sini
// fungsinya digeneralisasi supaya bisa dipakai untuk:
// - elemen statis dengan id tetap (dipanggil via ID, seperti app.js)
// - elemen dinamis yang lahir berkali-kali lewat innerHTML (dipanggil
//   via elemen langsung, dipakai foto.js/suara.js/inventaris.js)
//
// CATATAN: file ini HARUS di-load SEBELUM app.js, foto.js, suara.js,
// dan inventaris.js di tag <script> masing-masing halaman.
// ============================================

// uniqueMerge: gabung starter list + histori, hilangkan duplikat
// (case-insensitive). Dipakai oleh app.js DAN file lain untuk
// menyusun ALL_CATEGORIES / ALL_LOCATIONS / ALL_UNITS / ALL_PRODUCT_NAMES.
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

// setupSimpleAutocomplete: versi FLEKSIBEL, terima langsung elemen
// <input> dan <div> hasil (bukan cuma id string), supaya bisa dipakai
// untuk elemen yang baru lahir dari innerHTML (dynamic render).
//
// Parameter:
// - inputEl: elemen <input> (DOM element, bukan id)
// - resultsEl: elemen <div> tempat hasil ditampilkan (DOM element)
// - getOptionsFn: fungsi yang return array string pilihan
// - onSelect: (opsional) callback dipanggil setelah user pilih salah satu,
//   berguna kalau ada logic tambahan seperti updateMetadataPlaceholders() di app.js
function setupSimpleAutocompleteOnElement(inputEl, resultsEl, getOptionsFn, onSelect) {
  function render(filterText) {
    const keyword = filterText.trim().toLowerCase();
    const options = getOptionsFn();

    const filtered = keyword === ''
      ? options.slice(0, 50)
      : options.filter(function(v) { return v.toLowerCase().includes(keyword); }).slice(0, 50);

    resultsEl.innerHTML = '';

    if (filtered.length === 0) {
      resultsEl.style.display = 'none';
      return;
    }

    filtered.forEach(function(value) {
      const item = document.createElement('div');
      item.className = 'product-search-item';
      item.textContent = value;

      item.addEventListener('click', function() {
        inputEl.value = value;
        resultsEl.style.display = 'none';
        if (typeof onSelect === 'function') {
          onSelect(value);
        }
      });

      resultsEl.appendChild(item);
    });

    resultsEl.style.display = 'block';
  }

  inputEl.addEventListener('focus', function() {
    render('');
  });

  inputEl.addEventListener('input', function() {
    render(inputEl.value);
  });

  document.addEventListener('click', function(e) {
    const isClickInside = inputEl.contains(e.target) || resultsEl.contains(e.target);
    if (!isClickInside) {
      resultsEl.style.display = 'none';
    }
  });
}

// setupSimpleAutocomplete: versi LAMA (berbasis id string), dipertahankan
// supaya app.js tidak perlu diubah sama sekali -- cukup ganti sumber
// fungsi ini dari app.js ke file shared ini.
function setupSimpleAutocomplete(inputId, resultsId, getOptionsFn) {
  const input = document.getElementById(inputId);
  const resultsDiv = document.getElementById(resultsId);

  setupSimpleAutocompleteOnElement(input, resultsDiv, getOptionsFn, function() {
    if (inputId === 'productName' && typeof updateMetadataPlaceholders === 'function') {
      updateMetadataPlaceholders();
    }
  });
}
