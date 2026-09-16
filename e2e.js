/**
 * Loads index.html and driver.html in jsdom against the live server and drives
 * the real UI: login, render, edit health, book a dock, log fuel, edit payroll.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const BASE = "http://localhost:4000";
const PUB = path.join(__dirname, "public");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(label, ok, extra = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${extra}`); }
}

async function openPage(file) {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => console.log("    [jsdom]", e.message));
  const dom = await JSDOM.fromFile(path.join(PUB, file), {
    url: BASE + "/" + file,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  // jsdom has no fetch; hand the page the real one.
  dom.window.fetch = (url, opts) => fetch(String(url).startsWith("http") ? url : BASE + url, opts);
  dom.window.confirm = () => true;
  // Inject the two scripts by hand so they see the patched fetch.
  const run = (f) => {
    const el = dom.window.document.createElement("script");
    el.textContent = fs.readFileSync(path.join(PUB, f), "utf8");
    dom.window.document.body.appendChild(el);
  };
  return { dom, run };
}

async function testAdmin() {
  console.log("\n=== ADMIN DASHBOARD (index.html) ===");
  const { dom, run } = await openPage("index.html");
  const w = dom.window, d = w.document;
  run("api.js");
  run("app.js");
  await wait(100);

  // --- wrong password
  d.getElementById("loginPassword").value = "wrong";
  d.getElementById("loginSubmit").click();
  await wait(400);
  check("wrong password is rejected", d.getElementById("loginError").classList.contains("show"));
  check("app stays locked", !d.getElementById("appShell").classList.contains("unlocked"));

  // --- correct password
  d.getElementById("loginPassword").value = "Kishan";
  d.getElementById("loginSubmit").click();
  await wait(1200);
  check("correct password unlocks the app", d.getElementById("appShell").classList.contains("unlocked"));

  // --- data rendered from the database
  const vehicleRows = d.querySelectorAll("#vehicleList .vehicle-row");
  check("vehicle list rendered from DB", vehicleRows.length === 8, `(got ${vehicleRows.length})`);
  check("vehicle text came from DB", d.getElementById("vehicleList").textContent.includes("MH 12 AX 4581"));
  check("schedule rendered", d.querySelectorAll("#scheduleList .schedule-row").length === 5);
  check("queue rendered", d.querySelectorAll("#queueLanes .queue-lane").length === 5);
  check("driver payroll list rendered", d.querySelectorAll("#driverAdminList .driver-admin-row").length === 2);
  check("fuel log rendered", d.querySelectorAll("#fuelList .fuel-row").length === 6);
  check("fleet metric computed server-side", d.getElementById("maintDueCount").textContent.trim() === "4",
        `(got "${d.getElementById("maintDueCount").textContent}")`);
  check("payroll total shown", /₹/.test(d.getElementById("payrollTotal").textContent));
  check("notifications populated", d.querySelectorAll("#notifDynamic .notif-item").length > 0);

  // --- filter
  d.getElementById("vehicleFilter").value = "critical";
  d.getElementById("vehicleFilter").dispatchEvent(new w.Event("change"));
  await wait(50);
  check("status filter works", d.querySelectorAll("#vehicleList .vehicle-row").length === 2);
  d.getElementById("vehicleFilter").value = "all";
  d.getElementById("vehicleFilter").dispatchEvent(new w.Event("change"));

  // --- edit vehicle health, persisted
  d.querySelector('#vehicleList .vehicle-edit-btn[data-plate="WB 06 CF 1256"]').click();
  await wait(50);
  d.getElementById("healthStatus").value = "critical";
  d.getElementById("healthNote").value = "Clutch slipping";
  d.getElementById("healthForm").dispatchEvent(new w.Event("submit"));
  await wait(800);
  check("health edit reflected in UI", d.getElementById("vehicleList").textContent.includes("Clutch slipping"));
  check("health edit hit the server (metric moved)", d.getElementById("maintDueCount").textContent.trim() === "5",
        `(got "${d.getElementById("maintDueCount").textContent}")`);

  // --- book a dock slot
  const form = d.getElementById("bookingForm");
  const field = n => form.querySelector(`[name="${n}"]`);
  field("vehicle").value = "TN 09 BV 3390";
  field("time").value = "18:15";
  form.dispatchEvent(new w.Event("submit"));
  await wait(800);
  check("dock booking persisted", d.querySelectorAll("#scheduleList .schedule-row").length === 6);
  check("booked count updated", d.getElementById("bookedCount").textContent.trim() === "6");

  // --- double-booking refused by the server
  field("vehicle").value = "UP 32 GT 8823";
  field("time").value = "18:15";
  form.dispatchEvent(new w.Event("submit"));
  await wait(800);
  check("double booking refused", d.querySelectorAll("#scheduleList .schedule-row").length === 6);
  check("clash surfaced as a toast", d.getElementById("toastContainer").textContent.includes("already booked"));

  // --- advance queue
  const firstBefore = d.querySelector("#queueLanes .lane-plate").textContent;
  d.getElementById("advanceQueue").click();
  await wait(600);
  check("advance queue rotates", d.querySelector("#queueLanes .lane-plate").textContent !== firstBefore);

  // --- fuel: rule 1 (tank capacity)
  const setFuel = (receipt, litres, distance) => {
    d.getElementById("fuelVehicle").value = "MH 12 AX 4581";
    d.getElementById("fuelStation").value = "Indian Oil";
    d.getElementById("fuelReceipt").value = receipt;
    d.getElementById("fuelLitres").value = String(litres);
    d.getElementById("fuelPrice").value = "105";
    d.getElementById("fuelDistance").value = String(distance);
    d.getElementById("fuelDate").value = "16 Sep";
    d.getElementById("fuelTime").value = "10:00";
    d.getElementById("fuelForm").dispatchEvent(new w.Event("submit"));
  };

  setFuel("E2E-OVER", 400, 500);
  await wait(700);
  check("Rule 1: overflow rejected in UI", d.getElementById("fuelFormError").classList.contains("show"));
  check("Rule 1: message mentions tank capacity", /tank capacity/i.test(d.getElementById("fuelFormError").textContent));
  check("Rule 1: nothing added", d.querySelectorAll("#fuelList .fuel-row").length === 6);

  // --- fuel: rule 2 (duplicate receipt, case-insensitive)
  setFuel("ioc48213", 100, 500);
  await wait(700);
  check("Rule 2: duplicate rejected", /already been logged/i.test(d.getElementById("fuelFormError").textContent));
  check("Rule 2: nothing added", d.querySelectorAll("#fuelList .fuel-row").length === 6);

  // --- fuel: rule 4 (high risk) accepted and flagged
  setFuel("E2E-HIGH", 150, 500);
  await wait(900);
  check("Rule 4: high-risk entry stored", d.querySelectorAll("#fuelList .fuel-row").length === 7);
  check("Rule 4: flagged high risk", d.querySelector("#fuelList .fuel-row").className.includes("high"));
  check("Rule 4: shows the variance", /\+\d/.test(d.querySelector("#fuelList .fuel-row").textContent));

  // --- fuel: normal entry
  setFuel("E2E-OK", 100, 520);
  await wait(900);
  check("normal entry stored", d.querySelectorAll("#fuelList .fuel-row").length === 8);
  check("normal entry not flagged", d.querySelector("#fuelList .fuel-row").className.includes("normal"));

  // --- fuel filter
  d.getElementById("fuelFilter").value = "high";
  d.getElementById("fuelFilter").dispatchEvent(new w.Event("change"));
  await wait(50);
  check("fuel filter narrows the list", d.querySelectorAll("#fuelList .fuel-row").length < 8);
  d.getElementById("fuelFilter").value = "all";
  d.getElementById("fuelFilter").dispatchEvent(new w.Event("change"));

  // --- assign driver
  d.getElementById("quickAction").click();
  await wait(50);
  d.getElementById("assignVehicle").value = "DL 01 FR 2280";
  d.getElementById("assignDriverName").value = "N. Test";
  d.getElementById("assignForm").dispatchEvent(new w.Event("submit"));
  await wait(800);
  check("driver assignment persisted", d.getElementById("vehicleList").textContent.includes("N. Test"));

  // --- payroll: edit salary, PIN left blank
  d.querySelector('#driverAdminList .driver-edit-btn[data-id="0001"]').click();
  await wait(50);
  check("edit modal opens", d.getElementById("driverEditOverlay").classList.contains("open"));
  check("PIN field blank (hash never leaves server)", d.getElementById("editDriverPin").value === "");
  check("route stops loaded into editor", d.querySelectorAll("#editRouteStops .dyn-row").length === 5);
  check("documents loaded into editor", d.querySelectorAll("#editDocuments .dyn-row").length === 4);
  d.getElementById("editBase").value = "30000";
  d.getElementById("editBase").dispatchEvent(new w.Event("input"));
  check("net preview recalculates", d.getElementById("editNetPreview").textContent.includes("32,020"),
        `(got "${d.getElementById("editNetPreview").textContent}")`);
  d.getElementById("driverEditForm").dispatchEvent(new w.Event("submit"));
  await wait(1000);
  check("salary saved to DB", d.getElementById("driverAdminList").textContent.includes("32,020"));

  // --- payroll: record payment clears the advance
  d.querySelector('#driverAdminList .driver-edit-btn[data-id="0001"]').click();
  await wait(50);
  d.getElementById("recordPaymentBtn").click();
  await wait(1400);
  check("advance cleared after payment", d.getElementById("editAdvance").value === "0");
  check("payment added to history", d.querySelectorAll("#editSalaryHistoryList .dyn-row").length === 4);
  d.getElementById("driverEditClose").click();

  // --- add a new driver
  d.getElementById("addDriverBtn").click();
  await wait(50);
  check("suggested next ID", d.getElementById("editDriverId").value === "0003");
  d.getElementById("editDriverPin").value = "12";   // too short
  d.getElementById("driverEditForm").dispatchEvent(new w.Event("submit"));
  await wait(200);
  check("short PIN rejected client-side", d.getElementById("driverEditError").classList.contains("show"));
  d.getElementById("editDriverPin").value = "7777";
  d.getElementById("editDriverName").value = "E. Tester";
  d.getElementById("editDriverPlate").value = "GJ 01 TS 0001";
  d.getElementById("editBase").value = "25000";
  d.getElementById("addStopBtn").click();
  d.querySelector("#editRouteStops .stop-place").value = "Ahmedabad depot";
  d.querySelector("#editRouteStops .stop-time").value = "08:00";
  d.getElementById("driverEditForm").dispatchEvent(new w.Event("submit"));
  await wait(1200);
  check("new driver created", d.querySelectorAll("#driverAdminList .driver-admin-row").length === 3);
  check("new driver shown", d.getElementById("driverAdminList").textContent.includes("E. Tester"));

  w.close();
  return true;
}

async function testDriverPortal() {
  console.log("\n=== DRIVER PORTAL (driver.html) ===");
  const { dom, run } = await openPage("driver.html");
  const w = dom.window, d = w.document;
  run("api.js");
  run("driver.js");
  await wait(100);

  // --- wrong PIN
  d.getElementById("driverIdInput").value = "0002";
  d.getElementById("driverPinInput").value = "0000";
  d.getElementById("driverLoginSubmit").click();
  await wait(500);
  check("wrong PIN rejected", d.getElementById("driverLoginError").classList.contains("show"));
  check("portal stays locked", !d.getElementById("driverAppShell").classList.contains("unlocked"));

  // --- correct PIN
  d.getElementById("driverPinInput").value = "1708";
  d.getElementById("driverLoginSubmit").click();
  await wait(1000);
  check("correct PIN unlocks portal", d.getElementById("driverAppShell").classList.contains("unlocked"));
  check("driver name from DB", d.getElementById("sideDriverName").textContent === "S. Nair");
  check("plate from DB", d.getElementById("sideDriverPlate").textContent === "KA 05 TR 7812");
  check("route stops rendered", d.querySelectorAll("#routeTimeline .route-stop").length === 4);
  check("stops remaining computed", d.getElementById("routeStopsLeft").textContent.trim() === "3");
  check("payslip rendered", d.getElementById("payslipList").textContent.includes("Net pay"));
  check("net pay from server", d.getElementById("salaryNet").textContent.includes("29,810"),
        `(got "${d.getElementById("salaryNet").textContent}")`);
  check("salary history rendered", d.querySelectorAll("#salaryHistory .salary-history-row").length === 3);
  check("trips rendered", d.querySelectorAll("#tripList .trip-row").length === 3);
  check("documents rendered", d.querySelectorAll("#docList .doc-row").length === 4);

  // --- the new driver created by the admin test can log in
  d.getElementById("driverLogoutBtn").click();
  await wait(100);
  d.getElementById("driverIdInput").value = "0003";
  d.getElementById("driverPinInput").value = "7777";
  d.getElementById("driverLoginSubmit").click();
  await wait(900);
  check("driver added in admin can sign in", d.getElementById("sideDriverName").textContent === "E. Tester");
  check("their route came through", d.getElementById("routeTimeline").textContent.includes("Ahmedabad depot"));

  // --- cross-portal: admin's salary edit is visible to driver 0001
  d.getElementById("driverLogoutBtn").click();
  await wait(100);
  d.getElementById("driverIdInput").value = "0001";
  d.getElementById("driverPinInput").value = "0603";
  d.getElementById("driverLoginSubmit").click();
  await wait(900);
  check("admin's base-salary edit visible to the driver",
        d.getElementById("payslipList").textContent.includes("30,000"));
  check("payment recorded by admin appears in history",
        d.querySelectorAll("#salaryHistory .salary-history-row").length === 4);

  w.close();
  return true;
}

(async () => {
  await testAdmin();
  await testDriverPortal();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
