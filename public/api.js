/**
 * FleetOps API client.
 * Drop this next to app.js / driver.js and load it FIRST:
 *   <script src="api.js"></script>
 *
 * It replaces drivers-data.js (localStorage) with real server calls.
 * Everything returns a Promise, so the call sites in app.js / driver.js
 * become `await FleetAPI.vehicles.list()` instead of reading a local array.
 */
(function (global) {
  "use strict";

  // Same origin if you serve the HTML from the backend's ./public folder.
  const BASE = global.FLEET_API_BASE || "";
  const TOKEN_KEY = "fleetops_token";

  const getToken = () => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };
  const setToken = (t) => { try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch {} };

  async function request(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  }

  const get = (p) => request("GET", p);
  const post = (p, b) => request("POST", p, b);
  const put = (p, b) => request("PUT", p, b);
  const patch = (p, b) => request("PATCH", p, b);
  const del = (p) => request("DELETE", p);

  const FleetAPI = {
    isLoggedIn: () => !!getToken(),
    logout: () => setToken(null),

    auth: {
      async adminLogin(password, username = "admin") {
        const r = await post("/api/auth/admin/login", { username, password });
        setToken(r.token);
        return r.user;
      },
      async driverLogin(id, pin) {
        const r = await post("/api/auth/driver/login", { id, pin });
        setToken(r.token);
        return r.user;
      },
      me: () => get("/api/auth/me"),
      changeAdminPassword: (currentPassword, newPassword) =>
        post("/api/auth/admin/password", { currentPassword, newPassword }),
    },

    vehicles: {
      list: (status = "all") => get(`/api/vehicles?status=${encodeURIComponent(status)}`),
      get: (plate) => get(`/api/vehicles/${encodeURIComponent(plate)}`),
      create: (v) => post("/api/vehicles", v),
      updateHealth: (plate, status, note) =>
        patch(`/api/vehicles/${encodeURIComponent(plate)}`, { status, note }),
      assignDriver: (plate, driver, driverId) =>
        post(`/api/vehicles/${encodeURIComponent(plate)}/assign-driver`, { driver, driverId }),
      remove: (plate) => del(`/api/vehicles/${encodeURIComponent(plate)}`),
    },

    drivers: {
      list: () => get("/api/drivers"),
      get: (id) => get(`/api/drivers/${id}`),
      create: (record) => post("/api/drivers", record),
      update: (id, record) => put(`/api/drivers/${id}`, record),
      remove: (id) => del(`/api/drivers/${id}`),
      recordPayment: (id, month) => post(`/api/drivers/${id}/record-payment`, { month }),
      addTrip: (id, trip) => post(`/api/drivers/${id}/trips`, trip),
      removeTrip: (id, tripId) => del(`/api/drivers/${id}/trips/${tripId}`),
      setStopStatus: (id, stopId, status) => patch(`/api/drivers/${id}/stops/${stopId}`, { status }),
    },

    dock: {
      schedule: (date) => get(`/api/dock/schedule${date ? `?date=${date}` : ""}`),
      book: (slot) => post("/api/dock/schedule", slot),
      updateSlot: (id, changes) => patch(`/api/dock/schedule/${id}`, changes),
      cancel: (id) => del(`/api/dock/schedule/${id}`),
      queue: () => get("/api/dock/queue"),
      enqueue: (entry) => post("/api/dock/queue", entry),
      advanceQueue: () => post("/api/dock/queue/advance", {}),
      release: (id) => del(`/api/dock/queue/${id}`),
    },

    fuel: {
      list: (plate) => get(`/api/fuel${plate ? `?plate=${encodeURIComponent(plate)}` : ""}`),
      alerts: () => get("/api/fuel/alerts"),
      log: (entry) => post("/api/fuel", entry),
      remove: (id) => del(`/api/fuel/${id}`),
    },

    metrics: {
      fleet: () => get("/api/metrics/fleet"),
      payroll: () => get("/api/metrics/payroll"),
      fuel: () => get("/api/metrics/fuel"),
      notifications: () => get("/api/notifications"),
      audit: (limit = 50) => get(`/api/audit?limit=${limit}`),
    },

    // Driver portal (driver token only)
    me: {
      profile: () => get("/api/me"),
      route: () => get("/api/me/route"),
      salary: () => get("/api/me/salary"),
      trips: () => get("/api/me/trips"),
      documents: () => get("/api/me/documents"),
      completeStop: (stopId) => patch(`/api/me/stops/${stopId}`, { status: "done" }),
      changePin: (currentPin, newPin) => post("/api/me/pin", { currentPin, newPin }),
    },
  };

  global.FleetAPI = FleetAPI;
})(window);
