(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let catalog = [];
  let activeProductId = null;
  let currentUser = null;
  let toastTimer = null;

  const prices = () => Object.fromEntries(catalog.map(item => [item.id, Number(item.price)]));

  function money(value) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[c]));
  }

  function showPendingApproval(rentalId){
    $("pendingOrderId").textContent = rentalId ? `#${rentalId}` : "-";
    $("pendingModal").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function showToast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: {
        ...(options.body !== undefined ? {"Content-Type": "application/json"} : {}),
        ...(options.headers || {})
      },
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || "Terjadi kesalahan.");
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function dateToday() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function dateDiffInclusive(start, end) {
    if (!start || !end) return 0;
    const s = Date.parse(`${start}T00:00:00`);
    const e = Date.parse(`${end}T00:00:00`);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
    return Math.floor((e - s) / 86400000) + 1;
  }

  function formatDate(date) {
    if (!date) return "-";
    const d = new Date(`${date}T00:00:00`);
    return new Intl.DateTimeFormat("id-ID", {day:"2-digit",month:"short",year:"numeric"}).format(d);
  }

  function openModal(id) {
    const modal = $(id);
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    const modal = $(id);
    modal.hidden = true;
    if (![...document.querySelectorAll(".modal:not([hidden])")].length) {
      document.body.style.overflow = "";
    }
  }

  function setDateDefaults(prefix) {
    const start = $(`${prefix}StartDate`);
    const ret = $(`${prefix}ReturnDate`);
    const today = dateToday();
    start.min = today;
    ret.min = today;
    if (!start.value) start.value = today;
    if (!ret.value || ret.value < start.value) {
      const d = new Date(`${today}T00:00:00`);
      d.setDate(d.getDate() + 1);
      ret.value = d.toISOString().slice(0, 10);
    }
    updateDateConstraints(prefix);
  }

  function updateDateConstraints(prefix) {
    const start = $(`${prefix}StartDate`);
    const ret = $(`${prefix}ReturnDate`);
    ret.min = start.value || dateToday();
    if (ret.value && start.value && ret.value < start.value) ret.value = start.value;
  }

  function selectedItems(containerId) {
    return [...$(containerId).querySelectorAll(".item-row")].flatMap(row => {
      const check = row.querySelector(".item-check");
      if (!check?.checked || check.disabled) return [];
      const id = Number(check.value);
      const qty = Number(row.querySelector(".qty-value")?.textContent || 0);
      return qty > 0 ? [{catalogId: id, quantity: qty}] : [];
    });
  }

  function setQty(containerId, id, value) {
    const row = $(containerId).querySelector(`.item-row[data-id="${CSS.escape(String(id))}"]`);
    if (!row) return;
    const item = catalog.find(x => Number(x.id) === Number(id));
    const check = row.querySelector(".item-check");
    const val = row.querySelector(".qty-value");
    const minus = row.querySelector('[data-qty="minus"]');
    const plus = row.querySelector('[data-qty="plus"]');
    const stock = Number(item?.stock || 0);
    let qty = Math.max(1, Math.min(stock, Math.floor(Number(value) || 1)));
    if (!check.checked || stock <= 0) qty = 0;

    val.textContent = String(qty);
    minus.disabled = !check.checked || qty <= 1;
    plus.disabled = !check.checked || qty >= stock;
  }

  function toggleItem(containerId, id, checked) {
    const row = $(containerId).querySelector(`.item-row[data-id="${CSS.escape(String(id))}"]`);
    if (!row) return;
    const check = row.querySelector(".item-check");
    check.checked = checked;
    setQty(containerId, id, checked ? 1 : 0);
    row.classList.toggle("selected", checked);
  }

  function renderItemPicker(containerId, selectedId = null, preserved = {}) {
    const container = $(containerId);
    if (!container) return;

    container.innerHTML = catalog.map((item, i) => {
      const stock = Number(item.stock || 0);
      const selected = Number(item.id) === Number(selectedId) || preserved[item.id]?.selected;
      const qty = selected ? Math.max(1, Math.min(stock, Number(preserved[item.id]?.qty || 1))) : 0;
      const disabled = stock <= 0;
      const iconHtml = item.photo
        ? `<img src="${item.photo}" alt="">`
        : esc(item.icon || "🎒");
      return `
        <div class="item-row ${disabled ? "disabled" : ""}" data-id="${item.id}">
          <span class="item-icon">${iconHtml}</span>
          <span class="item-copy">
            <strong>${esc(item.name)}</strong>
            <small>${money(item.price)}/hari</small>
            <span class="stock-note">Stok tersedia: ${stock} unit</span>
          </span>
          <span class="qty-wrap">
            <button type="button" class="qty-btn" data-qty="minus" ${!selected || qty<=1 ? "disabled" : ""}>−</button>
            <span class="qty-value">${selected ? qty : 0}</span>
            <button type="button" class="qty-btn" data-qty="plus" ${!selected || qty>=stock || disabled ? "disabled" : ""}>+</button>
          </span>
          <input class="item-check" type="checkbox" value="${item.id}" ${selected ? "checked" : ""} ${disabled ? "disabled" : ""} aria-label="Pilih ${esc(item.name)}">
        </div>
      `;
    }).join("");

    container.querySelectorAll(".item-check").forEach(check => {
      check.addEventListener("change", () => {
        toggleItem(containerId, Number(check.value), check.checked);
        updateTotals(containerId);
      });
    });

    container.querySelectorAll(".qty-btn").forEach(btn => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        const row = btn.closest(".item-row");
        const id = Number(row.dataset.id);
        const check = row.querySelector(".item-check");
        if (!check.checked) {
          check.checked = true;
        }
        const current = Number(row.querySelector(".qty-value").textContent || 1);
        const delta = btn.dataset.qty === "plus" ? 1 : -1;
        setQty(containerId, id, current + delta);
        row.classList.add("selected");
        updateTotals(containerId);
      });
    });
  }

  function updateTotals(containerId) {
    const isRegister = containerId === "registerItems";
    const prefix = isRegister ? "reg" : "booking";
    const start = $(`${prefix}StartDate`).value;
    const ret = $(`${prefix}ReturnDate`).value;
    const days = dateDiffInclusive(start, ret);
    const byId = prices();
    const items = selectedItems(containerId);
    const totalUnits = items.reduce((sum, x) => sum + x.quantity, 0);
    const total = items.reduce((sum, x) => sum + (byId[x.catalogId] || 0) * x.quantity * days, 0);

    $(`${isRegister ? "register" : "booking"}Total`).textContent = money(total);
    $(`${isRegister ? "register" : "booking"}Summary`).textContent =
      `${items.length} jenis • ${totalUnits} unit${days ? ` • ${days} hari` : ""}`;

    if (isRegister) {
      $("dateSummary").textContent = days ? `${days} hari` : "Pilih tanggal";
    }
  }

  function renderCatalog() {
    const grid = $("equipmentGrid");
    if (!catalog.length) {
      grid.innerHTML = `<div class="loading-card">Belum ada alat aktif.</div>`;
      return;
    }

    grid.innerHTML = catalog.map((item, i) => {
      const photo = item.photo
        ? `<img class="rental-photo" src="${item.photo}" alt="${esc(item.name)}">`
        : `<div class="visual-emoji">${esc(item.icon || "🎒")}</div>`;
      const stock = Number(item.stock || 0);
      return `
        <article class="rental-card">
          <div class="rental-visual tone-${i % 4}">
            <span class="rental-badge">${esc(String(item.category || "ALAT").toUpperCase())}</span>
            ${photo}
          </div>
          <div class="rental-body">
            <div class="meta">
              <span>${esc(String(item.category || "ALAT").toUpperCase())}</span>
              <span class="${stock > 0 ? "available" : ""}">● ${stock > 0 ? `Tersedia ${stock}` : "Stok Habis"}</span>
            </div>
            <h3>${esc(item.name)}</h3>
            <p>${esc(item.description)}</p>
            <div class="rental-bottom">
              <div><span class="price-label">Mulai dari</span><span class="price">${money(item.price)} <small>/ hari</small></span></div>
              <button class="rent-btn" data-rent="${item.id}" ${stock <= 0 ? "disabled" : ""}>${stock > 0 ? "Sewa Sekarang" : "Stok Habis"}</button>
            </div>
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll("[data-rent]").forEach(btn => {
      btn.addEventListener("click", () => beginRental(Number(btn.dataset.rent)));
    });
  }

  async function beginRental(productId) {
    activeProductId = productId;
    if (!currentUser) {
      switchAuth("register");
      renderItemPicker("registerItems", productId);
      setDateDefaults("reg");
      updateTotals("registerItems");
      $("registerMessage").textContent = "";
      openModal("authModal");
      return;
    }

    location.assign(`customer.html?product=${encodeURIComponent(productId)}`);
  }

  function switchAuth(mode) {
    document.querySelectorAll(".auth-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.authTab === mode));
    $("registerPanel").hidden = mode !== "register";
    $("loginPanel").hidden = mode !== "login";
  }

  function showAccountPanel() {
    const panel = $("accountPanel");
    if (!currentUser) {
      panel.innerHTML = `<div class="empty-state"><div class="empty-icon">↗</div><h3>Belum login</h3><p>Masuk untuk melihat pesananmu.</p></div>`;
      $("navAccount").textContent = "Masuk / Daftar";
      $("accountPrimary").textContent = "Masuk / Daftar";
      return;
    }

    $("navAccount").textContent = "Akun Saya";
    $("accountPrimary").textContent = "Akun Aktif";

    const rentals = Array.isArray(currentUser.rentals) ? currentUser.rentals : [];
    const rows = rentals.length ? rentals.map(r => {
      const status = r.status === "Dikembalikan" ? "done" : (r.status === "Diperpanjang" ? "warn" : "ok");
      const items = r.items.map(x => `${esc(x.equipment)} × ${x.quantity}`).join(", ");
      return `<article class="member-rental">
        <div class="member-row"><strong>Pesanan #${r.id}</strong><span class="status ${status}">${esc(r.status)}</span></div>
        <div class="member-items">${items}</div>
        <div class="member-meta">${formatDate(r.startDate)} — ${formatDate(r.returnDate)} · ${money(r.totalPrice)}</div>
      </article>`;
    }).join("") : `<p class="member-meta">Belum ada riwayat sewa.</p>`;

    panel.innerHTML = `
      <div class="account-head">
        <div><h3>Halo, ${esc(currentUser.name)}</h3><p>${esc(currentUser.email)} · ${esc(currentUser.phone)}</p></div>
        <button class="logout" id="logoutBtn">Keluar</button>
      </div>
      <div class="member-list">${rows}</div>
    `;
    $("logoutBtn").addEventListener("click", logout);
  }

  async function loadSession() {
    try {
      const data = await api("/api/me");
      if (data.authenticated && data.kind === "customer") {
        currentUser = {...data, rentals: data.rentals || []};
        const params = new URLSearchParams(location.search);
        const product = params.get("product");
        location.replace(product ? `customer.html?product=${encodeURIComponent(product)}` : "customer.html");
        return;
      }
      currentUser = null;
      showAccountPanel();
    } catch {
      currentUser = null;
      showAccountPanel();
    }
  }

  async function loadCatalog() {
    const data = await api("/api/catalog");
    catalog = Array.isArray(data.catalog) ? data.catalog : [];
    renderCatalog();
  }

  async function onRegister(event) {
    event.preventDefault();
    $("registerMessage").textContent = "";

    const items = selectedItems("registerItems");
    const startDate = $("regStartDate").value;
    const returnDate = $("regReturnDate").value;

    if (!items.length) {
      $("registerMessage").textContent = "Pilih minimal satu alat.";
      return;
    }
    if (!dateDiffInclusive(startDate, returnDate)) {
      $("registerMessage").textContent = "Tanggal sewa tidak valid.";
      return;
    }

    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: $("regName").value.trim(),
          email: $("regEmail").value.trim(),
          phone: $("regPhone").value.trim(),
          password: $("regPassword").value,
          startDate,
          returnDate,
          items
        })
      });
      closeModal("authModal");
      showPendingApproval(data.rental?.rentalId);
      event.target.reset();
    } catch (err) {
      $("registerMessage").textContent = err.message;
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    $("loginMessage").textContent = "";
    try {
      await api("/api/auth/login", {
        method:"POST",
        body: JSON.stringify({
          email: $("loginEmail").value.trim(),
          password: $("loginPassword").value
        })
      });
      const data = await api("/api/me");
      currentUser = {...data, rentals:data.rentals || []};
      closeModal("authModal");
      const customerUrl = activeProductId
        ? `customer.html?product=${encodeURIComponent(activeProductId)}`
        : "customer.html";
      location.assign(customerUrl);
    } catch (err) {
      $("loginMessage").textContent = err.message;
    }
  }

  async function onBooking(event) {
    event.preventDefault();
    $("bookingMessage").textContent = "";
    const items = selectedItems("bookingItems");
    const startDate = $("bookingStartDate").value;
    const returnDate = $("bookingReturnDate").value;

    if (!items.length) {
      $("bookingMessage").textContent = "Pilih minimal satu alat.";
      return;
    }
    if (!dateDiffInclusive(startDate, returnDate)) {
      $("bookingMessage").textContent = "Tanggal sewa tidak valid.";
      return;
    }

    try {
      const data = await api("/api/rentals", {
        method:"POST",
        body:JSON.stringify({startDate,returnDate,items})
      });
      closeModal("bookingModal");
      showToast(`Sewa berhasil dibuat. Pesanan #${data.rental.rentalId}.`);
      await loadCatalog();
      await loadSession();
    } catch (err) {
      $("bookingMessage").textContent = err.message;
    }
  }

  async function logout() {
    await api("/api/auth/logout", {method:"POST"});
    currentUser = null;
    showAccountPanel();
    showToast("Kamu sudah keluar.");
  }

  document.addEventListener("click", (event) => {
    const toggle = event.target.closest(".password-toggle");
    if (toggle) {
      const input = document.getElementById(toggle.dataset.passwordTarget);
      if (input) {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        toggle.textContent = show ? "Sembunyikan" : "Tampilkan";
        toggle.setAttribute("aria-pressed", show ? "true" : "false");
      }
      return;
    }

    const close = event.target.closest("[data-close]");
    if (close) closeModal(close.dataset.close);
    if (event.target.classList.contains("auth-tab")) switchAuth(event.target.dataset.authTab);

    if (event.target.id === "navAccount" || event.target.id === "accountPrimary") {
      if (currentUser) {
        location.assign("customer.html");
      } else {
        switchAuth("register");
        activeProductId = null;
        renderItemPicker("registerItems");
        setDateDefaults("reg");
        updateTotals("registerItems");
        openModal("authModal");
      }
    }
  });

  $("registerForm").addEventListener("submit", onRegister);
  $("loginForm").addEventListener("submit", onLogin);
  $("bookingForm").addEventListener("submit", onBooking);

  ["regStartDate","regReturnDate","bookingStartDate","bookingReturnDate"].forEach(id => {
    $(id).addEventListener("change", () => {
      if (id.startsWith("reg")) {
        updateDateConstraints("reg");
        updateTotals("registerItems");
      } else {
        updateDateConstraints("booking");
        updateTotals("bookingItems");
      }
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal:not([hidden])").forEach(m => closeModal(m.id));
    }
  });

  (async function init() {
    try {
      await Promise.all([loadCatalog(), loadSession()]);
    } catch (err) {
      $("equipmentGrid").innerHTML = `<div class="loading-card">Server belum aktif. Jalankan <code>node server.js</code> lalu muat ulang.</div>`;
    }
  })();
})();
