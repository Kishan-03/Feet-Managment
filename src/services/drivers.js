/**
 * Builds the nested driver record the frontend already knows how to render
 * (the same shape drivers-data.js kept in localStorage), and handles the
 * transactional writes for editing a driver.
 */
const bcrypt = require("bcryptjs");
const { db } = require("../db");
const { ApiError, num } = require("../middleware/error");

function netPay(s) {
  const gross = num(s.base) + num(s.trip_bonus ?? s.tripBonus) + num(s.fuel_allowance ?? s.fuelAllowance);
  const deductions = num(s.advance) + num(s.pf);
  return gross - deductions;
}

function getDriver(id, { includePin = false } = {}) {
  const d = db.prepare(`SELECT * FROM drivers WHERE id = ?`).get(id);
  if (!d) return null;

  const route = db.prepare(`SELECT * FROM routes WHERE driver_id = ?`).get(id);
  const stops = route
    ? db
        .prepare(`SELECT time, place, note, status FROM route_stops WHERE route_id = ? ORDER BY position, id`)
        .all(route.id)
    : [];

  const salary =
    db.prepare(`SELECT * FROM salaries WHERE driver_id = ?`).get(id) ||
    { base: 0, trip_bonus: 0, fuel_allowance: 0, advance: 0, pf: 0 };

  const history = db
    .prepare(`SELECT month, amount FROM salary_history WHERE driver_id = ? ORDER BY id DESC`)
    .all(id);

  const trips = db
    .prepare(`SELECT id, date, route, km, earning FROM trips WHERE driver_id = ? ORDER BY id DESC`)
    .all(id);

  const documents = db
    .prepare(`SELECT id, name, meta, status, status_text AS statusText, expires_on AS expiresOn
              FROM documents WHERE driver_id = ? ORDER BY id`)
    .all(id);

  return {
    id: d.id,
    name: d.name,
    plate: d.plate,
    phone: d.phone,
    active: !!d.active,
    ...(includePin ? { pinSet: !!d.pin_hash } : {}),
    route: {
      distance: route ? route.distance : null,
      vehicle: route ? route.vehicle : d.plate,
      stops,
    },
    salary: {
      base: salary.base,
      tripBonus: salary.trip_bonus,
      fuelAllowance: salary.fuel_allowance,
      advance: salary.advance,
      pf: salary.pf,
      net: netPay(salary),
      history,
    },
    trips: trips.map((t) => ({ ...t, km: `${t.km} km` })),
    documents,
  };
}

function listDrivers() {
  return db
    .prepare(`SELECT id FROM drivers ORDER BY id`)
    .all()
    .map((r) => getDriver(r.id));
}

/** Creates or fully replaces a driver record in one transaction. */
const upsertDriver = db.transaction((payload, { isNew }) => {
  const id = String(payload.id).trim();
  const exists = db.prepare(`SELECT id FROM drivers WHERE id = ?`).get(id);

  if (isNew && exists) throw new ApiError(409, `Driver ${id} already exists`);
  if (!isNew && !exists) throw new ApiError(404, `Driver ${id} not found`);

  if (isNew) {
    if (!payload.pin) throw new ApiError(400, "A PIN is required for a new driver");
    db.prepare(`INSERT INTO drivers (id, name, plate, pin_hash, phone) VALUES (?, ?, ?, ?, ?)`)
      .run(id, payload.name, payload.plate || null, bcrypt.hashSync(String(payload.pin), 10), payload.phone || null);
  } else {
    db.prepare(
      `UPDATE drivers SET name = COALESCE(?, name), plate = COALESCE(?, plate),
       phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ?`
    ).run(payload.name ?? null, payload.plate ?? null, payload.phone ?? null, id);
    if (payload.pin) {
      db.prepare(`UPDATE drivers SET pin_hash = ? WHERE id = ?`).run(bcrypt.hashSync(String(payload.pin), 10), id);
    }
  }

  // ---- salary
  if (payload.salary) {
    const s = payload.salary;
    db.prepare(
      `INSERT INTO salaries (driver_id, base, trip_bonus, fuel_allowance, advance, pf)
       VALUES (@id, @base, @tripBonus, @fuelAllowance, @advance, @pf)
       ON CONFLICT(driver_id) DO UPDATE SET
         base = @base, trip_bonus = @tripBonus, fuel_allowance = @fuelAllowance,
         advance = @advance, pf = @pf, updated_at = datetime('now')`
    ).run({
      id,
      base: num(s.base),
      tripBonus: num(s.tripBonus),
      fuelAllowance: num(s.fuelAllowance),
      advance: num(s.advance),
      pf: num(s.pf),
    });

    if (Array.isArray(s.history)) {
      db.prepare(`DELETE FROM salary_history WHERE driver_id = ?`).run(id);
      const ins = db.prepare(`INSERT INTO salary_history (driver_id, month, amount) VALUES (?, ?, ?)`);
      s.history.forEach((h) => ins.run(id, h.month, num(h.amount)));
    }
  }

  // ---- route + stops
  if (payload.route) {
    db.prepare(
      `INSERT INTO routes (driver_id, distance, vehicle) VALUES (@id, @distance, @vehicle)
       ON CONFLICT(driver_id) DO UPDATE SET
         distance = @distance, vehicle = @vehicle, updated_at = datetime('now')`
    ).run({ id, distance: payload.route.distance || null, vehicle: payload.route.vehicle || payload.plate || null });

    if (Array.isArray(payload.route.stops)) {
      const routeId = db.prepare(`SELECT id FROM routes WHERE driver_id = ?`).get(id).id;
      db.prepare(`DELETE FROM route_stops WHERE route_id = ?`).run(routeId);
      const ins = db.prepare(
        `INSERT INTO route_stops (route_id, position, time, place, note, status) VALUES (?, ?, ?, ?, ?, ?)`
      );
      payload.route.stops.forEach((st, i) =>
        ins.run(routeId, i, st.time || null, st.place || "Unnamed stop", st.note || null, st.status || "upcoming")
      );
    }
  }

  // ---- documents
  if (Array.isArray(payload.documents)) {
    db.prepare(`DELETE FROM documents WHERE driver_id = ?`).run(id);
    const ins = db.prepare(
      `INSERT INTO documents (driver_id, name, meta, status, status_text, expires_on) VALUES (?, ?, ?, ?, ?, ?)`
    );
    payload.documents.forEach((d) =>
      ins.run(id, d.name, d.meta || null, d.status || "valid", d.statusText || null, d.expiresOn || null)
    );
  }

  // Keep the vehicle table in step with the driver's assigned plate.
  if (payload.plate) {
    db.prepare(`UPDATE vehicles SET driver_id = NULL WHERE driver_id = ?`).run(id);
    db.prepare(`UPDATE vehicles SET driver_id = ?, driver_name = ? WHERE plate = ?`)
      .run(id, payload.name || null, payload.plate);
  }

  return getDriver(id);
});

module.exports = { getDriver, listDrivers, upsertDriver, netPay };
