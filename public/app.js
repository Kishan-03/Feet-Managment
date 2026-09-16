(function(){
  "use strict";

  // Every array that used to be hard-coded in this file is now a cache of what
  // the server sent back. Nothing here is the source of truth any more.
  let vehicles = [];
  let schedule = [];
  let queue = [];
  let driverRecords = {};   // keyed by driver id, same shape the UI expected
  let fuelAnalysis = { entries: [], totals: {litres:0, cost:0, alerts:0, highRisk:0} };
  let currentVehicleFilter = "all";

  const inr = n => "\u20B9" + Number(n || 0).toLocaleString("en-IN");

  function escapeHtml(str){
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[c]);
  }

  // ---------- ADMIN LOGIN GATE ----------
  // The password is checked by the server now and the session is a JWT, so
  // there is nothing useful left in this file for someone reading the source.
  const loginScreen = document.getElementById("loginScreen");
  const loginForm = document.getElementById("loginForm");
  const loginSubmit = document.getElementById("loginSubmit");
  const loginPassword = document.getElementById("loginPassword");
  const loginError = document.getElementById("loginError");
  const loginCard = document.querySelector(".login-card");
  const appShell = document.getElementById("appShell");

  function rejectLogin(message){
    loginError.textContent = message;
    loginError.classList.add("show");
    loginCard.classList.remove("shake");
    void loginCard.offsetWidth; // restart animation
    loginCard.classList.add("shake");
    loginPassword.value = "";
    loginPassword.focus();
  }

  async function attemptLogin(){
    loginSubmit.disabled = true;
    try {
      await FleetAPI.auth.adminLogin(loginPassword.value);
      loginError.classList.remove("show");
      await unlock();
    } catch(err){
      rejectLogin(err.status === 401 ? "Incorrect password. Try again." : err.message);
    } finally {
      loginSubmit.disabled = false;
    }
  }

  loginSubmit.addEventListener("click", attemptLogin);
  loginForm.addEventListener("submit", e => e.preventDefault());
  loginPassword.addEventListener("keydown", e => {
    if(e.key === "Enter"){
      e.preventDefault();
      attemptLogin();
    }
  });

  async function unlock(){
    loginScreen.classList.add("hidden");
    appShell.classList.add("unlocked");
    try {
      await loadEverything();
    } catch(err){
      toast("Could not reach the server", err.message);
    }
  }

  document.getElementById("adminLogoutBtn").addEventListener("click", () => {
    FleetAPI.logout();
    appShell.classList.remove("unlocked");
    loginScreen.classList.remove("hidden");
    loginPassword.value = "";
  });

  // A token left over from a previous tab skips the login screen, but only if
  // the server still accepts it.
  if(FleetAPI.isLoggedIn()){
    FleetAPI.auth.me().then(unlock).catch(() => FleetAPI.logout());
  }

  // ---------- LOADERS ----------
  // One call per screen, all fired together on unlock and again after a write.
  async function loadEverything(){
    await Promise.all([
      loadVehicles(),
      loadSchedule(),
      loadQueue(),
      loadDrivers(),
      loadFuel()
    ]);
    await refreshMetrics();
    runFlapAnimation();
  }

  async function loadVehicles(){
    vehicles = await FleetAPI.vehicles.list("all");
    renderVehicles(currentVehicleFilter);
    populateFuelVehicles();
  }

  async function loadSchedule(){
    const data = await FleetAPI.dock.schedule();
    schedule = data.slots;
    document.getElementById("bookedCount").textContent = data.bookedCount;
    renderSchedule();
  }

  async function loadQueue(){
    queue = await FleetAPI.dock.queue();
    renderQueue();
  }

  async function loadDrivers(){
    const list = await FleetAPI.drivers.list();
    driverRecords = {};
    list.forEach(d => { driverRecords[d.id] = d; });
    renderDriverAdminList();
  }

  async function loadFuel(){
    fuelAnalysis = await FleetAPI.fuel.list();
    renderFuelDashboard(fuelFilterEl ? fuelFilterEl.value : "all");
  }

  // ---------- FLEET METRICS + NOTIFICATIONS (computed server-side) ----------
  const maintDueCountEl = document.getElementById("maintDueCount");
  const maintDueNoteEl = document.getElementById("maintDueNote");
  const healthyPctEl = document.getElementById("healthyPct");
  const notifDynamicEl = document.getElementById("notifDynamic");
  const notifBadgeEl = document.getElementById("notifBadge");

  async function refreshMetrics(){
    const [fleet, payroll, notifs] = await Promise.all([
      FleetAPI.metrics.fleet(),
      FleetAPI.metrics.payroll(),
      FleetAPI.metrics.notifications()
    ]);

    maintDueCountEl.textContent = fleet.maintenanceDue;
    maintDueNoteEl.textContent = fleet.critical === 1 ? "1 critical reminder" : `${fleet.critical} critical reminders`;
    healthyPctEl.textContent = fleet.healthyPct + "%";

    document.getElementById("payrollDriverCount").textContent = payroll.driverCount;
    document.getElementById("payrollTotal").textContent = inr(payroll.totalNet);
    document.getElementById("payrollAdvanceCount").textContent = payroll.advanceCount;
    document.getElementById("payrollAdvanceNote").textContent = payroll.advanceCount
      ? payroll.advanceNames.join(", ")
      : "None outstanding";

    // The dropdown now covers vehicle health, expiring documents and fuel alerts.
    notifDynamicEl.innerHTML = notifs.items.map(n => `
      <div class="notif-item">
        <strong>${escapeHtml(n.title)}</strong>
        <span>${escapeHtml(n.detail)}</span>
      </div>
    `).join("");
    notifBadgeEl.textContent = notifs.count;
    notifBadgeEl.style.display = notifs.count ? "" : "none";
  }

  // ---------- RENDER: vehicle list ----------
  const vehicleListEl = document.getElementById("vehicleList");
  function renderVehicles(filter){
    currentVehicleFilter = filter || "all";
    vehicleListEl.innerHTML = "";
    vehicles
      .filter(v => currentVehicleFilter === "all" || v.status === currentVehicleFilter)
      .forEach(v => {
        const row = document.createElement("div");
        row.className = "vehicle-row";
        row.innerHTML = `
          <span class="vehicle-dot ${v.status}"></span>
          <div>
            <span class="vehicle-plate">${escapeHtml(v.plate)}</span>
            <div class="vehicle-meta">${escapeHtml(v.driver || "Unassigned")} · ${escapeHtml(v.note)}</div>
          </div>
          <span class="vehicle-tag ${v.status}">${v.status}</span>
          <button class="icon-button vehicle-edit-btn" type="button" data-plate="${escapeHtml(v.plate)}" title="Edit health" aria-label="Edit health for ${escapeHtml(v.plate)}">✎</button>
        `;
        vehicleListEl.appendChild(row);
      });
    if(!vehicleListEl.children.length){
      vehicleListEl.innerHTML = `<div class="vehicle-meta" style="padding:20px;text-align:center;">No vehicles match this filter.</div>`;
    }
    vehicleListEl.querySelectorAll(".vehicle-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => openHealthEditor(btn.dataset.plate));
    });
  }
  document.getElementById("vehicleFilter").addEventListener("change", e => renderVehicles(e.target.value));

  // ---------- EDIT VEHICLE HEALTH ----------
  const healthOverlay = document.getElementById("healthOverlay");
  const healthForm = document.getElementById("healthForm");
  const healthPlateEl = document.getElementById("healthPlate");
  const healthStatusEl = document.getElementById("healthStatus");
  const healthNoteEl = document.getElementById("healthNote");
  let editingPlate = null;

  function openHealthEditor(plate){
    const vehicle = vehicles.find(v => v.plate === plate);
    if(!vehicle) return;
    editingPlate = plate;
    healthPlateEl.value = vehicle.plate;
    healthStatusEl.value = vehicle.status;
    healthNoteEl.value = vehicle.note || "";
    healthOverlay.classList.add("open");
  }

  document.getElementById("healthClose").addEventListener("click", () => healthOverlay.classList.remove("open"));
  healthOverlay.addEventListener("click", e => { if(e.target === healthOverlay) healthOverlay.classList.remove("open"); });

  healthForm.addEventListener("submit", async e => {
    e.preventDefault();
    if(!editingPlate) return;
    try {
      const updated = await FleetAPI.vehicles.updateHealth(
        editingPlate,
        healthStatusEl.value,
        healthNoteEl.value.trim() || undefined
      );
      await loadVehicles();
      await refreshMetrics();
      healthOverlay.classList.remove("open");
      toast("Health updated", `${updated.plate} marked as ${updated.status}.`);
    } catch(err){
      toast("Could not save", err.message);
    }
  });

  // ---------- RENDER: dock schedule ----------
  const scheduleListEl = document.getElementById("scheduleList");
  function renderSchedule(){
    scheduleListEl.innerHTML = "";
    schedule
      .slice()
      .sort((a,b) => a.time.localeCompare(b.time))
      .forEach(s => {
        const row = document.createElement("div");
        row.className = "schedule-row";
        row.innerHTML = `
          <span class="schedule-time">${escapeHtml(s.time)}</span>
          <div>
            <strong>${escapeHtml(s.plate)}</strong>
            <small>${escapeHtml(s.dock)} · ${escapeHtml(s.load)}</small>
          </div>
          <span class="schedule-tag ${s.priority ? "priority" : ""}">${escapeHtml(s.tag)}</span>
        `;
        scheduleListEl.appendChild(row);
      });
    if(!scheduleListEl.children.length){
      scheduleListEl.innerHTML = `<div class="vehicle-meta" style="padding:20px;text-align:center;">No dock slots booked today.</div>`;
    }
  }

  // ---------- RENDER: queue lanes ----------
  const queueLanesEl = document.getElementById("queueLanes");
  function renderQueue(){
    queueLanesEl.innerHTML = "";
    queue.forEach((q, i) => {
      const lane = document.createElement("div");
      lane.className = "queue-lane" + (q.priority ? " priority" : "");
      lane.innerHTML = `
        <span class="lane-index">${i+1}</span>
        <span class="lane-plate">${escapeHtml(q.plate)}</span>
        <span class="lane-badge">${q.priority ? "PRIORITY" : "STANDARD"} · ${escapeHtml(q.note)}</span>
      `;
      queueLanesEl.appendChild(lane);
    });
    document.getElementById("queueCount").textContent = queue.length;
    document.getElementById("queueCount").dataset.flap = queue.length;
  }

  document.getElementById("advanceQueue").addEventListener("click", async () => {
    try {
      queue = await FleetAPI.dock.advanceQueue();
      renderQueue();
    } catch(err){
      toast("Could not advance queue", err.message);
    }
  });

  // ---------- BOOKING FORM ----------
  document.getElementById("bookingForm").addEventListener("submit", async e => {
    e.preventDefault();
    const form = e.target;
    const field = name => form.querySelector(`[name="${name}"]`);
    const vehicle = field("vehicle").value.trim();
    if(!vehicle) return;
    const dock = field("dock").value;
    try {
      await FleetAPI.dock.book({
        time: field("time").value,
        plate: vehicle.toUpperCase(),
        dock: dock,
        load: field("load").value
      });
      await loadSchedule();
      await refreshMetrics();
      form.reset();
      field("time").value = "14:30";
      toast("Slot booked", `${vehicle.toUpperCase()} is booked into ${dock}.`);
    } catch(err){
      // The server refuses a double-booking of the same dock at the same time.
      toast("Booking rejected", err.message);
    }
  });

  // ---------- NAVIGATION ----------
  const views = document.querySelectorAll(".view");
  const pageTitle = document.getElementById("pageTitle");
  const backButton = document.getElementById("backHome");

  function navigateTo(target){
    views.forEach(v => v.classList.toggle("active", v.id === target + "View"));
    const activeView = document.getElementById(target + "View");
    if(activeView){ pageTitle.textContent = activeView.dataset.title; }
    backButton.classList.toggle("visible", target !== "home");
    window.scrollTo({top:0, behavior:"instant"});
  }

  document.querySelectorAll(".home-card").forEach(card => {
    card.addEventListener("click", () => navigateTo(card.dataset.view));
  });

  document.getElementById("brandHome").addEventListener("click", () => navigateTo("home"));
  backButton.addEventListener("click", () => navigateTo("home"));

  // ---------- MAP PINS ----------
  document.querySelectorAll(".vehicle-pin").forEach(pin => {
    pin.addEventListener("click", () => {
      document.getElementById("calloutPlate").textContent = pin.dataset.truck;
      document.getElementById("calloutEta").textContent = pin.dataset.eta;
    });
  });

  // ---------- SEGMENTED CONTROL (visual only) ----------
  document.querySelectorAll(".segmented-control").forEach(group => {
    group.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        group.querySelectorAll("button").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  });

  // ---------- TOASTS ----------
  const toastContainer = document.getElementById("toastContainer");
  function toast(title, message){
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(message)}`;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity .25s ease";
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  // ---------- SEARCH ----------
  const searchWrap = document.querySelector(".search-wrap");
  const searchToggle = document.getElementById("searchToggle");
  const searchInput = document.getElementById("searchInput");

  searchToggle.addEventListener("click", () => {
    const isOpen = searchWrap.classList.toggle("open");
    searchToggle.classList.toggle("active", isOpen);
    searchToggle.setAttribute("aria-expanded", String(isOpen));
    if(isOpen){ searchInput.focus(); }
    else { searchInput.value = ""; runSearch(""); }
  });

  function runSearch(term){
    term = term.trim().toLowerCase();
    const fleetActive = document.getElementById("fleetView").classList.contains("active");
    if(fleetActive){
      document.querySelectorAll("#vehicleList .vehicle-row").forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
      });
    } else {
      document.querySelectorAll("#scheduleList .schedule-row").forEach(row => {
        row.style.display = row.textContent.toLowerCase().includes(term) ? "" : "none";
      });
    }
  }
  searchInput.addEventListener("input", e => runSearch(e.target.value));

  // ---------- NOTIFICATIONS ----------
  const notifToggle = document.getElementById("notifToggle");
  const notifDropdown = document.getElementById("notifDropdown");

  notifToggle.addEventListener("click", e => {
    e.stopPropagation();
    const isOpen = notifDropdown.classList.toggle("open");
    notifToggle.classList.toggle("active", isOpen);
    notifToggle.setAttribute("aria-expanded", String(isOpen));
    if(isOpen){ notifBadgeEl.style.display = "none"; }
  });
  document.addEventListener("click", e => {
    if(!notifDropdown.contains(e.target) && e.target !== notifToggle){
      notifDropdown.classList.remove("open");
      notifToggle.classList.remove("active");
    }
    if(!searchWrap.contains(e.target)){
      if(!searchInput.value){
        searchWrap.classList.remove("open");
        searchToggle.classList.remove("active");
      }
    }
  });

  // ---------- ASSIGN DRIVER MODAL ----------
  const assignOverlay = document.getElementById("assignOverlay");
  const assignVehicleSelect = document.getElementById("assignVehicle");
  const assignForm = document.getElementById("assignForm");

  function populateAssignVehicles(){
    assignVehicleSelect.innerHTML = vehicles
      .map(v => `<option value="${escapeHtml(v.plate)}">${escapeHtml(v.plate)} — ${escapeHtml(v.driver || "Unassigned")}</option>`)
      .join("");
  }

  document.getElementById("quickAction").addEventListener("click", () => {
    populateAssignVehicles();
    assignOverlay.classList.add("open");
    document.getElementById("assignDriverName").focus();
  });
  document.getElementById("assignClose").addEventListener("click", () => assignOverlay.classList.remove("open"));
  assignOverlay.addEventListener("click", e => { if(e.target === assignOverlay) assignOverlay.classList.remove("open"); });

  assignForm.addEventListener("submit", async e => {
    e.preventDefault();
    const plate = assignVehicleSelect.value;
    const driverName = document.getElementById("assignDriverName").value.trim();
    if(!driverName) return;
    // If the name matches a driver account, link the vehicle to that account too.
    const match = Object.values(driverRecords).find(d => d.name.toLowerCase() === driverName.toLowerCase());
    try {
      await FleetAPI.vehicles.assignDriver(plate, driverName, match ? match.id : undefined);
      await loadVehicles();
      assignOverlay.classList.remove("open");
      assignForm.reset();
      toast("Driver assigned", `${driverName} assigned to ${plate}.`);
    } catch(err){
      toast("Could not assign", err.message);
    }
  });

  // ---------- LIVE CLOCK ----------
  const clockEl = document.getElementById("clock");
  function tickClock(){
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit",second:"2-digit"});
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------- DRIVER PAYROLL (ADMIN) ----------
  function driverNet(rec){
    // The server sends salary.net; the arithmetic below is only a fallback.
    if(rec.salary && rec.salary.net != null) return rec.salary.net;
    const s = rec.salary;
    return (s.base + s.tripBonus + s.fuelAllowance) - (s.advance + s.pf);
  }

  function initials(name){
    return name.split(" ").map(p => p.replace(/[.]/g,"")).filter(Boolean).slice(0,2).map(p => p[0]).join("").toUpperCase();
  }

  function renderDriverAdminList(){
    const el = document.getElementById("driverAdminList");
    if(!el) return;
    el.innerHTML = "";
    const ids = Object.keys(driverRecords);
    ids.forEach(id => {
      const rec = driverRecords[id];
      const row = document.createElement("div");
      row.className = "driver-admin-row";
      row.innerHTML = `
        <span class="driver-admin-avatar">${initials(rec.name)}</span>
        <div>
          <span class="driver-admin-name">${escapeHtml(rec.name)}</span>
          <div class="driver-admin-meta">${escapeHtml(id)} &middot; ${escapeHtml(rec.plate || "—")}${rec.salary.advance ? " &middot; advance pending" : ""}</div>
        </div>
        <span class="driver-admin-net">${inr(driverNet(rec))}<small>net this month</small></span>
        <div class="driver-admin-actions">
          <button class="icon-button driver-edit-btn" type="button" data-id="${escapeHtml(id)}" title="Edit driver" aria-label="Edit ${escapeHtml(rec.name)}">✎</button>
          <button class="icon-button driver-delete-btn" type="button" data-id="${escapeHtml(id)}" title="Remove driver" aria-label="Remove ${escapeHtml(rec.name)}">🗑</button>
        </div>
      `;
      el.appendChild(row);
    });
    if(!ids.length){
      el.innerHTML = `<div class="vehicle-meta" style="padding:20px;text-align:center;">No driver records yet.</div>`;
    }
    el.querySelectorAll(".driver-edit-btn").forEach(btn => {
      btn.addEventListener("click", () => openDriverEditor(btn.dataset.id));
    });
    el.querySelectorAll(".driver-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => removeDriver(btn.dataset.id));
    });
  }

  async function removeDriver(id){
    const rec = driverRecords[id];
    if(!rec) return;
    const ok = window.confirm(`Remove ${rec.name} (${id})? They will no longer be able to sign in to the Driver Portal.`);
    if(!ok) return;
    try {
      await FleetAPI.drivers.remove(id);
      await loadDrivers();
      await refreshMetrics();
      if(driverEditOverlay) driverEditOverlay.classList.remove("open");
      toast("Driver removed", `${rec.name} (${id}) was deleted and can no longer log in.`);
    } catch(err){
      toast("Could not remove", err.message);
    }
  }

  const driverEditOverlay = document.getElementById("driverEditOverlay");
  const driverEditForm = document.getElementById("driverEditForm");
  const driverEditTitleEl = document.getElementById("driverEditTitle");
  const driverEditErrorEl = document.getElementById("driverEditError");
  const editDriverIdEl = document.getElementById("editDriverId");
  const editDriverPinEl = document.getElementById("editDriverPin");
  const editDriverNameEl = document.getElementById("editDriverName");
  const editDriverPlateEl = document.getElementById("editDriverPlate");
  const editBaseEl = document.getElementById("editBase");
  const editTripBonusEl = document.getElementById("editTripBonus");
  const editFuelAllowanceEl = document.getElementById("editFuelAllowance");
  const editAdvanceEl = document.getElementById("editAdvance");
  const editPfEl = document.getElementById("editPf");
  const editNetPreviewEl = document.getElementById("editNetPreview");
  const recordPaymentBtnEl = document.getElementById("recordPaymentBtn");
  const deleteDriverBtnEl = document.getElementById("deleteDriverBtn");
  const editRouteDistanceEl = document.getElementById("editRouteDistance");
  const editRouteVehicleEl = document.getElementById("editRouteVehicle");
  const editRouteStopsEl = document.getElementById("editRouteStops");
  const editDocumentsEl = document.getElementById("editDocuments");
  const editSalaryHistoryListEl = document.getElementById("editSalaryHistoryList");
  let editingDriverId = null;
  let driverEditorMode = "edit"; // "edit" | "add"

  // ---------- DRIVER EDIT MODAL TABS ----------
  function setActiveDriverEditTab(tab){
    document.querySelectorAll(".driver-edit-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.querySelectorAll(".driver-edit-tab-panel").forEach(p => p.classList.toggle("active", p.dataset.tabPanel === tab));
  }
  document.querySelectorAll(".driver-edit-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => setActiveDriverEditTab(btn.dataset.tab));
  });

  // ---------- DYNAMIC ROW BUILDERS (route stops / documents / salary history) ----------
  function createDynRow(fieldsHtml, removeLabel){
    const row = document.createElement("div");
    row.className = "dyn-row";
    row.innerHTML = `
      <div class="dyn-row-fields">${fieldsHtml}</div>
      <button type="button" class="icon-button dyn-row-remove" title="${removeLabel}" aria-label="${removeLabel}">×</button>
    `;
    row.querySelector(".dyn-row-remove").addEventListener("click", () => row.remove());
    return row;
  }

  function createStopRow(stop){
    stop = stop || {};
    const row = createDynRow(`
      <input type="text" class="stop-time" placeholder="Time e.g. 07:30">
      <input type="text" class="stop-place" placeholder="Place">
      <input type="text" class="stop-note" placeholder="Note">
      <select class="stop-status">
        <option value="upcoming">Upcoming</option>
        <option value="current">In progress</option>
        <option value="done">Completed</option>
      </select>
    `, "Remove stop");
    row.querySelector(".stop-time").value = stop.time || "";
    row.querySelector(".stop-place").value = stop.place || "";
    row.querySelector(".stop-note").value = stop.note || "";
    row.querySelector(".stop-status").value = stop.status || "upcoming";
    return row;
  }

  function createDocRow(doc){
    doc = doc || {};
    const row = createDynRow(`
      <input type="text" class="doc-name" placeholder="Document name">
      <input type="text" class="doc-meta" placeholder="Meta e.g. issued state">
      <select class="doc-status-select">
        <option value="valid">Valid</option>
        <option value="warning">Warning</option>
        <option value="expired">Expired</option>
      </select>
      <input type="text" class="doc-statustext" placeholder="Status text e.g. Valid till Mar 2028">
    `, "Remove document");
    row.querySelector(".doc-name").value = doc.name || "";
    row.querySelector(".doc-meta").value = doc.meta || "";
    row.querySelector(".doc-status-select").value = doc.status || "valid";
    row.querySelector(".doc-statustext").value = doc.statusText || "";
    return row;
  }

  function createHistoryRow(entry){
    entry = entry || {};
    const row = createDynRow(`
      <input type="text" class="hist-month" placeholder="Month e.g. June 2026">
      <input type="number" class="hist-amount" placeholder="Amount" min="0" step="10">
    `, "Remove month");
    row.querySelector(".hist-month").value = entry.month || "";
    row.querySelector(".hist-amount").value = entry.amount != null ? entry.amount : "";
    return row;
  }

  function renderRouteStopsEditor(stops){
    editRouteStopsEl.innerHTML = "";
    (stops || []).forEach(s => editRouteStopsEl.appendChild(createStopRow(s)));
  }
  function renderDocumentsEditor(docs){
    editDocumentsEl.innerHTML = "";
    (docs || []).forEach(d => editDocumentsEl.appendChild(createDocRow(d)));
  }
  function renderHistoryEditor(history){
    editSalaryHistoryListEl.innerHTML = "";
    (history || []).forEach(h => editSalaryHistoryListEl.appendChild(createHistoryRow(h)));
  }

  document.getElementById("addStopBtn").addEventListener("click", () => {
    editRouteStopsEl.appendChild(createStopRow());
  });
  document.getElementById("addDocBtn").addEventListener("click", () => {
    editDocumentsEl.appendChild(createDocRow());
  });
  document.getElementById("addHistoryBtn").addEventListener("click", () => {
    editSalaryHistoryListEl.appendChild(createHistoryRow());
  });

  function readRouteStopsFromDom(){
    return Array.from(editRouteStopsEl.querySelectorAll(".dyn-row")).map(row => ({
      time: row.querySelector(".stop-time").value.trim(),
      place: row.querySelector(".stop-place").value.trim(),
      note: row.querySelector(".stop-note").value.trim(),
      status: row.querySelector(".stop-status").value
    })).filter(s => s.place || s.time || s.note);
  }
  function readDocumentsFromDom(){
    return Array.from(editDocumentsEl.querySelectorAll(".dyn-row")).map(row => ({
      name: row.querySelector(".doc-name").value.trim(),
      meta: row.querySelector(".doc-meta").value.trim(),
      status: row.querySelector(".doc-status-select").value,
      statusText: row.querySelector(".doc-statustext").value.trim()
    })).filter(d => d.name);
  }
  function readHistoryFromDom(){
    return Array.from(editSalaryHistoryListEl.querySelectorAll(".dyn-row")).map(row => ({
      month: row.querySelector(".hist-month").value.trim(),
      amount: Number(row.querySelector(".hist-amount").value) || 0
    })).filter(h => h.month);
  }

  function showDriverEditError(message){
    driverEditErrorEl.textContent = message;
    driverEditErrorEl.classList.add("show");
  }
  function clearDriverEditError(){
    driverEditErrorEl.classList.remove("show");
  }

  function nextSuggestedDriverId(){
    const nums = Object.keys(driverRecords)
      .map(id => parseInt(id, 10))
      .filter(n => !isNaN(n));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return String(next).padStart(4, "0");
  }

  function refreshNetPreview(){
    const net = (Number(editBaseEl.value)||0) + (Number(editTripBonusEl.value)||0) + (Number(editFuelAllowanceEl.value)||0)
      - (Number(editAdvanceEl.value)||0) - (Number(editPfEl.value)||0);
    editNetPreviewEl.textContent = inr(net);
  }
  [editBaseEl, editTripBonusEl, editFuelAllowanceEl, editAdvanceEl, editPfEl].forEach(input => {
    if(input) input.addEventListener("input", refreshNetPreview);
  });

  function openDriverEditor(id){
    const rec = driverRecords[id];
    if(!rec) return;
    driverEditorMode = "edit";
    editingDriverId = id;
    clearDriverEditError();
    driverEditTitleEl.textContent = "Edit driver";
    editDriverIdEl.value = id;
    editDriverIdEl.readOnly = true;
    // PINs are hashed on the server and never sent back, so this field stays
    // blank; leaving it blank on save keeps the existing PIN.
    editDriverPinEl.value = "";
    editDriverPinEl.placeholder = "Leave blank to keep current PIN";
    editDriverNameEl.value = rec.name;
    editDriverPlateEl.value = rec.plate || "";
    editBaseEl.value = rec.salary.base;
    editTripBonusEl.value = rec.salary.tripBonus;
    editFuelAllowanceEl.value = rec.salary.fuelAllowance;
    editAdvanceEl.value = rec.salary.advance;
    editPfEl.value = rec.salary.pf;
    const route = rec.route || {distance:"", vehicle:rec.plate, stops:[]};
    editRouteDistanceEl.value = route.distance || "";
    editRouteVehicleEl.value = route.vehicle || rec.plate || "";
    renderRouteStopsEditor(route.stops);
    renderDocumentsEditor(rec.documents);
    renderHistoryEditor(rec.salary.history);
    recordPaymentBtnEl.style.display = "";
    deleteDriverBtnEl.style.display = "";
    refreshNetPreview();
    setActiveDriverEditTab("profile");
    driverEditOverlay.classList.add("open");
  }

  function openDriverCreator(){
    driverEditorMode = "add";
    editingDriverId = null;
    clearDriverEditError();
    driverEditTitleEl.textContent = "Add driver";
    driverEditForm.reset();
    editDriverIdEl.value = nextSuggestedDriverId();
    editDriverIdEl.readOnly = false;
    editDriverPinEl.value = "";
    editDriverPinEl.placeholder = "4-digit PIN";
    editBaseEl.value = 0;
    editTripBonusEl.value = 0;
    editFuelAllowanceEl.value = 0;
    editAdvanceEl.value = 0;
    editPfEl.value = 0;
    editRouteDistanceEl.value = "";
    editRouteVehicleEl.value = "";
    renderRouteStopsEditor([]);
    renderDocumentsEditor([]);
    renderHistoryEditor([]);
    recordPaymentBtnEl.style.display = "none";
    deleteDriverBtnEl.style.display = "none";
    refreshNetPreview();
    setActiveDriverEditTab("profile");
    driverEditOverlay.classList.add("open");
    editDriverIdEl.focus();
  }

  const addDriverBtnEl = document.getElementById("addDriverBtn");
  if(addDriverBtnEl){
    addDriverBtnEl.addEventListener("click", openDriverCreator);
  }

  /** Collects the whole modal into the nested payload the API expects. */
  function readDriverFormPayload(){
    const payload = {
      name: editDriverNameEl.value.trim() || "New driver",
      plate: editDriverPlateEl.value.trim() || "—",
      salary: {
        base: Number(editBaseEl.value) || 0,
        tripBonus: Number(editTripBonusEl.value) || 0,
        fuelAllowance: Number(editFuelAllowanceEl.value) || 0,
        advance: Number(editAdvanceEl.value) || 0,
        pf: Number(editPfEl.value) || 0,
        history: readHistoryFromDom()
      },
      route: {
        distance: editRouteDistanceEl.value.trim() || "—",
        vehicle: editRouteVehicleEl.value.trim() || editDriverPlateEl.value.trim() || "—",
        stops: readRouteStopsFromDom()
      },
      documents: readDocumentsFromDom()
    };
    const pin = editDriverPinEl.value.trim();
    if(pin) payload.pin = pin;
    return payload;
  }

  if(driverEditOverlay){
    document.getElementById("driverEditClose").addEventListener("click", () => driverEditOverlay.classList.remove("open"));
    driverEditOverlay.addEventListener("click", e => { if(e.target === driverEditOverlay) driverEditOverlay.classList.remove("open"); });

    driverEditForm.addEventListener("submit", async e => {
      e.preventDefault();
      clearDriverEditError();

      const id = editDriverIdEl.value.trim().toUpperCase();
      const pin = editDriverPinEl.value.trim();

      if(!id){
        showDriverEditError("Enter a Driver ID.");
        return;
      }
      // A new driver must have a PIN; on an edit, blank means "keep the old one".
      if(driverEditorMode === "add" && !/^[0-9]{4}$/.test(pin)){
        showDriverEditError("PIN must be exactly 4 digits.");
        return;
      }
      if(pin && !/^[0-9]{4}$/.test(pin)){
        showDriverEditError("PIN must be exactly 4 digits, or left blank to keep the current one.");
        return;
      }

      const payload = readDriverFormPayload();

      try {
        if(driverEditorMode === "add"){
          const created = await FleetAPI.drivers.create(Object.assign({}, payload, {id: id, pin: pin}));
          await loadDrivers();
          await refreshMetrics();
          driverEditOverlay.classList.remove("open");
          toast("Driver added", `${created.name} (${created.id}) can now sign in to the Driver Portal.`);
        } else {
          const saved = await FleetAPI.drivers.update(editingDriverId, payload);
          await loadDrivers();
          await refreshMetrics();
          driverEditOverlay.classList.remove("open");
          toast("Driver updated", `${saved.name}'s details${pin ? ", PIN," : ""} and salary were saved.`);
        }
      } catch(err){
        showDriverEditError(err.message);
      }
    });

    recordPaymentBtnEl.addEventListener("click", async () => {
      if(driverEditorMode !== "edit" || !editingDriverId) return;
      try {
        // Save whatever is on screen first, so the payment matches what's shown.
        await FleetAPI.drivers.update(editingDriverId, readDriverFormPayload());
        const result = await FleetAPI.drivers.recordPayment(editingDriverId);
        await loadDrivers();
        await refreshMetrics();
        const rec = driverRecords[editingDriverId];
        editAdvanceEl.value = 0;
        renderHistoryEditor(rec.salary.history);
        refreshNetPreview();
        toast("Payment recorded", `${inr(result.amount)} logged for ${rec.name}. Advance cleared.`);
      } catch(err){
        showDriverEditError(err.message);
      }
    });

    deleteDriverBtnEl.addEventListener("click", () => {
      if(driverEditorMode !== "edit" || !editingDriverId) return;
      removeDriver(editingDriverId);
    });
  }

  // ---------- SIGNATURE: split-flap number reveal ----------
  const flapChars = "0123456789.%kmL /".split("");
  function randomChar(){ return flapChars[Math.floor(Math.random()*flapChars.length)]; }

  let flapDone = false;
  function runFlapAnimation(){
    if(flapDone) return;   // the numbers arrive async now, so run this once
    flapDone = true;
    document.querySelectorAll("[data-flap]").forEach(el => {
      const finalText = el.textContent;
      let frame = 0;
      const totalFrames = 10;
      el.textContent = "";
      const chars = finalText.split("").map(ch => {
        const span = document.createElement("span");
        span.className = "flap";
        span.textContent = ch === " " ? "\u00A0" : ch;
        el.appendChild(span);
        return {span, target: ch};
      });
      const interval = setInterval(() => {
        frame++;
        chars.forEach((c, idx) => {
          if(frame < totalFrames - idx){
            c.span.textContent = /[0-9]/.test(c.target) ? randomChar() : c.target;
          } else {
            c.span.textContent = c.target === " " ? "\u00A0" : c.target;
          }
        });
        if(frame >= totalFrames + chars.length){
          clearInterval(interval);
          chars.forEach(c => c.span.textContent = c.target === " " ? "\u00A0" : c.target);
        }
      }, 45);
    });
  }

  // ==================== FUEL THEFT DETECTION ====================
  // The four rules now run on the server against each vehicle's stored mileage
  // and tank capacity. Every entry arrives with its own `analysis` block, so
  // this file only renders the verdict — it can't be edited to hide a flag.
  const fuelListEl = document.getElementById("fuelList");
  const fuelUsedTotalEl = document.getElementById("fuelUsedTotal");
  const fuelCostTotalEl = document.getElementById("fuelCostTotal");
  const fuelAlertCountEl = document.getElementById("fuelAlertCount");
  const fuelHighRiskCountEl = document.getElementById("fuelHighRiskCount");
  const fuelHighRiskNoteEl = document.getElementById("fuelHighRiskNote");
  const fuelFilterEl = document.getElementById("fuelFilter");

  function renderFuelDashboard(filter){
    filter = filter || "all";
    const entries = fuelAnalysis.entries || [];
    const totals = fuelAnalysis.totals || {litres:0, cost:0, alerts:0, highRisk:0};

    fuelUsedTotalEl.textContent = totals.litres.toLocaleString("en-IN") + " L";
    fuelCostTotalEl.textContent = inr(totals.cost);
    fuelAlertCountEl.textContent = totals.alerts;
    fuelHighRiskCountEl.textContent = totals.highRisk;
    fuelHighRiskNoteEl.textContent = totals.highRisk ? "Needs review now" : "None right now";

    fuelListEl.innerHTML = "";
    const visible = entries.filter(e => filter === "all" || e.analysis.status === filter);
    visible.forEach(entry => {
      const result = entry.analysis;
      const row = document.createElement("div");
      row.className = "fuel-row " + result.status;
      const expectedText = result.expected != null ? result.expected.toFixed(1) + " L" : "—";
      const diffText = result.diffPct != null ? (result.diffPct >= 0 ? "+" : "") + result.diffPct.toFixed(1) + "%" : "—";
      row.innerHTML = `
        <div class="fuel-row-top">
          <div class="fuel-row-vehicle">
            <strong>${escapeHtml(entry.plate)}</strong>
            <span>${escapeHtml(entry.station)} · Receipt ${escapeHtml(entry.receiptNo)} · ${escapeHtml(entry.date)}, ${escapeHtml(entry.time)}</span>
          </div>
          <span class="fuel-status ${result.status}">${escapeHtml(result.statusLabel)}</span>
        </div>
        <div class="fuel-row-stats">
          <div><span>Distance</span><strong>${entry.distance ? entry.distance + " km" : "—"}</strong></div>
          <div><span>Expected</span><strong>${expectedText}</strong></div>
          <div><span>Actual</span><strong>${entry.litres} L</strong></div>
          <div><span>Difference</span><strong>${diffText}</strong></div>
        </div>
        <div class="fuel-row-note">${escapeHtml(result.note)}</div>
      `;
      fuelListEl.appendChild(row);
    });
    if(!visible.length){
      fuelListEl.innerHTML = `<div class="fuel-empty-note">No fuel entries match this filter.</div>`;
    }
  }

  if(fuelFilterEl){
    fuelFilterEl.addEventListener("change", e => renderFuelDashboard(e.target.value));
  }

  // ---------- Fuel entry form ----------
  const fuelVehicleEl = document.getElementById("fuelVehicle");
  const fuelForm = document.getElementById("fuelForm");
  const fuelFormErrorEl = document.getElementById("fuelFormError");
  const fuelFormCardEl = fuelForm ? fuelForm.closest(".booking-panel") : null;

  function populateFuelVehicles(){
    if(!fuelVehicleEl) return;
    const keep = fuelVehicleEl.value;
    fuelVehicleEl.innerHTML = vehicles
      .map(v => `<option value="${escapeHtml(v.plate)}">${escapeHtml(v.plate)} — ${escapeHtml(v.driver || "Unassigned")}</option>`)
      .join("");
    if(keep) fuelVehicleEl.value = keep;
  }

  function showFuelFormError(message){
    fuelFormErrorEl.textContent = message;
    fuelFormErrorEl.classList.add("show");
    if(fuelFormCardEl){
      fuelFormCardEl.classList.remove("shake");
      void fuelFormCardEl.offsetWidth;
      fuelFormCardEl.classList.add("shake");
    }
  }
  function clearFuelFormError(){
    fuelFormErrorEl.classList.remove("show");
  }

  if(fuelForm){
    fuelForm.addEventListener("submit", async e => {
      e.preventDefault();
      clearFuelFormError();

      const plate = fuelVehicleEl.value;
      const station = document.getElementById("fuelStation").value.trim();
      const receiptNo = document.getElementById("fuelReceipt").value.trim();
      const litres = Number(document.getElementById("fuelLitres").value);
      const price = Number(document.getElementById("fuelPrice").value);
      const distance = Number(document.getElementById("fuelDistance").value) || 0;
      const date = document.getElementById("fuelDate").value.trim();
      const time = document.getElementById("fuelTime").value;

      if(!station || !receiptNo || !litres || !price || !date || !time){
        showFuelFormError("Fill in every field except trip distance, which can be left blank.");
        return;
      }

      try {
        // Rules 1 and 2 are enforced here: the server answers 400 or 409 and
        // the entry never reaches the database.
        const saved = await FleetAPI.fuel.log({ plate, station, receiptNo, litres, price, distance, date, time });
        await loadFuel();
        await refreshMetrics();

        const result = saved.analysis;
        if(result.status === "high"){
          toast("Fuel entry flagged", `${plate}: ${result.statusLabel.toLowerCase()} — ${result.note}`);
        } else if(result.status === "warning"){
          toast("Fuel entry logged", `${plate}: usage came in ${result.diffPct.toFixed(1)}% over expected — flagged as a warning.`);
        } else {
          toast("Fuel entry logged", `${plate}: usage looks normal for this trip.`);
        }

        fuelForm.reset();
        fuelVehicleEl.value = plate;
      } catch(err){
        showFuelFormError(err.message);
      }
    });
  }

})();
