const express = require("express");
const { db, audit } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { wrap, required, ApiError, num } = require("../middleware/error");
const { getDriver, listDrivers, upsertDriver, netPay } = require("../services/drivers");

const router = express.Router();

// GET /api/drivers  — full records, the shape the dashboard renders
router.get("/", requireAdmin, wrap((req, res) => res.json(listDrivers())));

// GET /api/drivers/:id
router.get(
  "/:id",
  requireAdmin,
  wrap((req, res) => {
    const d = getDriver(req.params.id);
    if (!d) throw new ApiError(404, "Driver not found");
    res.json(d);
  })
);

// POST /api/drivers  — create (id + pin + name required)
router.post(
  "/",
  requireAdmin,
  wrap((req, res) => {
    required(req.body, ["id", "pin", "name"]);
    const driver = upsertDriver(req.body, { isNew: true });
    audit(req.user.username, "driver.create", "drivers", driver.id, driver.name);
    res.status(201).json(driver);
  })
);

// PUT /api/drivers/:id  — update any part of the record
router.put(
  "/:id",
  requireAdmin,
  wrap((req, res) => {
    const driver = upsertDriver({ ...req.body, id: req.params.id }, { isNew: false });
    audit(req.user.username, "driver.update", "drivers", driver.id, driver.name);
    res.json(driver);
  })
);

// DELETE /api/drivers/:id  — cascades route, salary, trips, documents
router.delete(
  "/:id",
  requireAdmin,
  wrap((req, res) => {
    const d = db.prepare(`SELECT name FROM drivers WHERE id = ?`).get(req.params.id);
    if (!d) throw new ApiError(404, "Driver not found");
    db.prepare(`DELETE FROM drivers WHERE id = ?`).run(req.params.id);
    audit(req.user.username, "driver.delete", "drivers", req.params.id, d.name);
    res.json({ ok: true });
  })
);

// POST /api/drivers/:id/record-payment  { month? }
// Files the current net pay into salary history and clears the advance.
router.post(
  "/:id/record-payment",
  requireAdmin,
  wrap((req, res) => {
    const salary = db.prepare(`SELECT * FROM salaries WHERE driver_id = ?`).get(req.params.id);
    if (!salary) throw new ApiError(404, "No payroll record for this driver");

    const amount = netPay(salary);
    const month =
      req.body.month ||
      new Date().toLocaleString("en-IN", { month: "long", year: "numeric" });

    const run = db.transaction(() => {
      db.prepare(`INSERT INTO salary_history (driver_id, month, amount) VALUES (?, ?, ?)`)
        .run(req.params.id, month, amount);
      db.prepare(`UPDATE salaries SET advance = 0, updated_at = datetime('now') WHERE driver_id = ?`)
        .run(req.params.id);
    });
    run();

    audit(req.user.username, "payroll.record_payment", "drivers", req.params.id, `${month}: ${amount}`);
    res.json({ ok: true, month, amount, driver: getDriver(req.params.id) });
  })
);

// POST /api/drivers/:id/trips  — log a completed trip
router.post(
  "/:id/trips",
  requireAdmin,
  wrap((req, res) => {
    required(req.body, ["date", "route"]);
    const d = db.prepare(`SELECT plate FROM drivers WHERE id = ?`).get(req.params.id);
    if (!d) throw new ApiError(404, "Driver not found");
    const info = db
      .prepare(`INSERT INTO trips (driver_id, plate, date, route, km, earning) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(req.params.id, req.body.plate || d.plate, req.body.date, req.body.route, num(req.body.km), num(req.body.earning));
    audit(req.user.username, "trip.create", "trips", info.lastInsertRowid, req.body.route);
    res.status(201).json(getDriver(req.params.id));
  })
);

// DELETE /api/drivers/:id/trips/:tripId
router.delete(
  "/:id/trips/:tripId",
  requireAdmin,
  wrap((req, res) => {
    const info = db.prepare(`DELETE FROM trips WHERE id = ? AND driver_id = ?`)
      .run(req.params.tripId, req.params.id);
    if (!info.changes) throw new ApiError(404, "Trip not found");
    res.json({ ok: true });
  })
);

// PATCH /api/drivers/:id/stops/:stopId  { status }  — advance a stop
router.patch(
  "/:id/stops/:stopId",
  requireAdmin,
  wrap((req, res) => {
    required(req.body, ["status"]);
    if (!["done", "current", "upcoming"].includes(req.body.status)) {
      throw new ApiError(400, "status must be done, current or upcoming");
    }
    const info = db
      .prepare(
        `UPDATE route_stops SET status = ?
         WHERE id = ? AND route_id = (SELECT id FROM routes WHERE driver_id = ?)`
      )
      .run(req.body.status, req.params.stopId, req.params.id);
    if (!info.changes) throw new ApiError(404, "Stop not found for this driver");
    res.json(getDriver(req.params.id));
  })
);

module.exports = router;
