(function(){
  "use strict";

  // The driver portal no longer reads a list of PINs from page source. Login
  // goes to the server, which returns a token scoped to this one driver — the
  // /api/me endpoints take the driver ID from the token, not from the page.
  let currentDriver = null;

  const loginScreen = document.getElementById("driverLoginScreen");
  const loginForm = document.getElementById("driverLoginForm");
  const loginSubmit = document.getElementById("driverLoginSubmit");
  const idInput = document.getElementById("driverIdInput");
  const pinInput = document.getElementById("driverPinInput");
  const loginError = document.getElementById("driverLoginError");
  const loginCard = document.querySelector("#driverLoginScreen .login-card");
  const appShell = document.getElementById("driverAppShell");

  function rejectLogin(message){
    loginError.textContent = message;
    loginError.classList.add("show");
    loginCard.classList.remove("shake");
    void loginCard.offsetWidth;
    loginCard.classList.add("shake");
    pinInput.value = "";
    pinInput.focus();
  }

  async function attemptLogin(){
    const id = idInput.value.trim().toUpperCase();
    const pin = pinInput.value.trim();
    loginSubmit.disabled = true;
    try {
      await FleetAPI.auth.driverLogin(id, pin);
      loginError.classList.remove("show");
      await unlock();
    } catch(err){
      rejectLogin(err.status === 401 ? "Incorrect driver ID or PIN." : err.message);
    } finally {
      loginSubmit.disabled = false;
    }
  }

  loginSubmit.addEventListener("click", attemptLogin);
  loginForm.addEventListener("submit", e => e.preventDefault());
  pinInput.addEventListener("keydown", e => {
    if(e.key === "Enter"){ e.preventDefault(); attemptLogin(); }
  });

  async function unlock(){
    loginScreen.classList.add("hidden");
    appShell.classList.add("unlocked");
    await refresh();
  }

  /** Pulls the whole record and repaints every pane. */
  async function refresh(){
    currentDriver = await FleetAPI.me.profile();
    renderAll();
  }

  // A token from an earlier visit skips the login screen if it still works.
  if(FleetAPI.isLoggedIn()){
    unlock().catch(() => {
      FleetAPI.logout();
      appShell.classList.remove("unlocked");
      loginScreen.classList.remove("hidden");
    });
  }

  document.getElementById("driverLogoutBtn").addEventListener("click", () => {
    FleetAPI.logout();
    appShell.classList.remove("unlocked");
    loginScreen.classList.remove("hidden");
    idInput.value = "";
    pinInput.value = "";
    currentDriver = null;
  });

  // ---------- CURRENCY ----------
  const inr = n => "\u20B9" + Number(n || 0).toLocaleString("en-IN");

  function escapeHtml(str){
    return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    })[c]);
  }

  // ---------- RENDER ----------
  function renderAll(){
    document.getElementById("sideDriverName").textContent = currentDriver.name;
    document.getElementById("sideDriverPlate").textContent = currentDriver.plate || "—";
    renderRoute();
    renderSalary();
    renderTrips();
    renderDocuments();
  }

  function renderRoute(){
    const r = currentDriver.route;
    document.getElementById("routeDistance").textContent = r.distance || "—";
    document.getElementById("routeVehicle").textContent = r.vehicle || currentDriver.plate || "—";
    const remaining = r.stops.filter(s => s.status !== "done").length;
    document.getElementById("routeStopsLeft").textContent = remaining;
    document.getElementById("routeStopsNote").textContent = remaining ? "Stay on schedule" : "All stops complete";

    const el = document.getElementById("routeTimeline");
    el.innerHTML = "";
    r.stops.forEach(s => {
      const row = document.createElement("div");
      row.className = "route-stop " + s.status;
      const tagText = s.status === "done" ? "Completed" : s.status === "current" ? "In progress" : "Upcoming";
      row.innerHTML = `
        <span class="route-stop-time">${escapeHtml(s.time)}</span>
        <span class="route-stop-rail"><span class="route-stop-dot"></span><span class="route-stop-line"></span></span>
        <div class="route-stop-body">
          <strong>${escapeHtml(s.place)}</strong>
          <span>${escapeHtml(s.note)}</span>
        </div>
        <span class="route-stop-tag">${tagText}</span>
      `;
      el.appendChild(row);
    });
    if(!r.stops.length){
      el.innerHTML = `<div class="route-stop-body" style="padding:16px;">No stops assigned yet.</div>`;
    }
  }

  function renderSalary(){
    // Net pay is worked out by the server; this only displays the breakdown.
    const s = currentDriver.salary;
    const deductions = s.advance + s.pf;

    document.getElementById("salaryNet").textContent = inr(s.net);
    document.getElementById("salaryBase").textContent = inr(s.base);
    document.getElementById("salaryDeductions").textContent = inr(deductions);

    const list = document.getElementById("payslipList");
    list.innerHTML = `
      <div class="payslip-row"><span>Base salary</span><span class="amount">${inr(s.base)}</span></div>
      <div class="payslip-row"><span>Trip bonus</span><span class="amount">${inr(s.tripBonus)}</span></div>
      <div class="payslip-row"><span>Fuel allowance</span><span class="amount">${inr(s.fuelAllowance)}</span></div>
      <div class="payslip-row deduction"><span>Advance recovery</span><span class="amount">-${inr(s.advance)}</span></div>
      <div class="payslip-row deduction"><span>Provident fund</span><span class="amount">-${inr(s.pf)}</span></div>
      <div class="payslip-row total"><span>Net pay</span><span class="amount">${inr(s.net)}</span></div>
    `;

    const hist = document.getElementById("salaryHistory");
    hist.innerHTML = "";
    s.history.forEach(h => {
      const row = document.createElement("div");
      row.className = "salary-history-row";
      row.innerHTML = `<span class="month">${escapeHtml(h.month)}</span><span class="amount">${inr(h.amount)}</span>`;
      hist.appendChild(row);
    });
  }

  function renderTrips(){
    const el = document.getElementById("tripList");
    el.innerHTML = "";
    currentDriver.trips.forEach(t => {
      const row = document.createElement("div");
      row.className = "trip-row";
      row.innerHTML = `
        <span class="trip-date">${escapeHtml(t.date)}</span>
        <div>
          <strong>${escapeHtml(t.route)}</strong>
          <small>${escapeHtml(t.km)}</small>
        </div>
        <span class="trip-earning">${inr(t.earning)}</span>
      `;
      el.appendChild(row);
    });
    if(!currentDriver.trips.length){
      el.innerHTML = `<div class="trip-row"><div><strong>No trips logged yet</strong></div></div>`;
    }
  }

  function renderDocuments(){
    const el = document.getElementById("docList");
    el.innerHTML = "";
    currentDriver.documents.forEach(d => {
      const row = document.createElement("div");
      row.className = "doc-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(d.name)}</strong>
          <small>${escapeHtml(d.meta)}</small>
        </div>
        <span class="doc-status ${d.status}">${escapeHtml(d.statusText)}</span>
      `;
      el.appendChild(row);
    });
    if(!currentDriver.documents.length){
      el.innerHTML = `<div class="doc-row"><div><strong>No documents on file</strong></div></div>`;
    }
  }

  // ---------- NAV ----------
  const panes = document.querySelectorAll(".driver-pane");
  const navItems = document.querySelectorAll(".driver-nav-item");
  const paneTitle = document.getElementById("driverPageTitle");
  const titles = {route:"Today's route", salary:"Salary", trips:"Trip history", documents:"Documents", help:"Help & Support"};

  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const target = item.dataset.pane;
      navItems.forEach(n => n.classList.toggle("active", n === item));
      panes.forEach(p => p.classList.toggle("active", p.id === "pane-" + target));
      paneTitle.textContent = titles[target];
      window.scrollTo({top:0, behavior:"instant"});
    });
  });

  // Payroll edits made in the admin portal used to arrive via a storage event.
  // With a server there is no shared storage, so poll for changes instead, and
  // refresh immediately whenever the driver returns to the tab.
  setInterval(() => {
    if(currentDriver) refresh().catch(() => {});
  }, 30000);

  document.addEventListener("visibilitychange", () => {
    if(!document.hidden && currentDriver) refresh().catch(() => {});
  });

  // ---------- CLOCK ----------
  const clockEl = document.getElementById("driverClock");
  function tickClock(){
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit",second:"2-digit"});
  }
  tickClock();
  setInterval(tickClock, 1000);

})();
