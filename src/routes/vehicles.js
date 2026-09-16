const express = require("express");
const { db, audit } = require("../db");
const { requireAdmin, requireAny } = require("../middleware/auth");
const { wrap, required, ApiError, num } = require("../middleware/error");

const router = express.Router();

const toApi = (v) => ({
  id: v.id,
  plate: v.plate,
  driverId: v.driver_id,
  driver: v.driver_name,
  status: v.status,
  note: v.note,
  mileage: v.mileage,
  tankCapacity: v.tank_capacity,
});

// GET /api/vehicles?status=healthy|warning|critical
router.get(
  "/",
  requireAny,
  wrap((req, res) => {
    const { status } = req.query;
    const rows = status && status !== "all"
      ? db.prepare(`SELECT * FROM vehicles WHERE status = ? ORDER BY plate`).all(status)
      : db.prepare(`SELECT * FROM vehicles ORDER BY plate`).all();
    res.json(rows.map(toApi));
  })
);

// GET /api/vehicles/:plate
router.get(
  "/:plate",
  requireAny,
  wrap((req, res) => {
    const v = db.prepare(`SELECT * FROM vehicles WHERE plate = ?`).get(req.params.plate);
    if (!v) throw new ApiError(404, "Vehicle not found");
    res.json(toApi(v));
  })
);

// POST /api/vehicles
router.post(
  "/",
  requireAdmin,
  wrap((req, res) => {
    required(req.body, ["plate"]);
    const b = req.body;
    const info = db
      .prepare(
        `INSERT INTO vehicles (plate, driver_id, driver_name, status, note, mileage, tank_capacity)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(b.plate).toUpperCase(),
        b.driverId || null,
        b.driver || null,
        b.status || "healthy",
        b.note || null,
        num(b.mileage, 5),
        num(b.tankCapacity, 200)
      );
    audit(req.user.username, "vehicle.create", "vehicles", info.lastInsertRowid, b.plate);
    res.status(201).json(toApi(db.prepare(`SELECT * FROM vehicles WHERE id = ?`).get(info.lastInsertRowid)));
  })
);

// PATCH /api/vehicles/:plate  — health status, note, driver, fuel profile
router.patch(
  "/:plate",
  requireAdmin,
  wrap((req, res) => {
    const v = db.prepare(`SELECT * FROM vehicles WHERE plate = ?`).get(req.params.plate);
    if (!v) throw new ApiError(404, "Vehicle not found");
    const b = req.body;
    if (b.status && !["healthy", "warning", "critical"].includes(b.status)) {
      throw new ApiError(400, "status must be healthy, warning or critical");
    }
    db.prepare(
      `UPDATE vehicles SET
         status = COALESCE(?, status),
         note = COALESCE(?, note),
         driver_name = COALESCE(?, driver_name),
         driver_id = COALESCE(?, driver_id),
         mileage = COALESCE(?, mileage),
         tank_capacity = COALESCE(?, tank_capacity),
         updated_at = datetime('now')
       WHERE plate = ?`
    ).run(
      b.status ?? null,
      b.note ?? null,
      b.driver ?? null,
      b.driverId ?? null,
      b.mileage != null ? Number(b.mileage) : null,
      b.tankCapacity != null ? Number(b.tankCapacity) : null,
      req.params.plate
    );
    audit(req.user.username, "vehicle.update", "vehicles", v.id, JSON.stringify(b));
    res.json(toApi(db.prepare(`SELECT * FROM vehicles WHERE plate = ?`).get(req.params.plate)));
  })
);

// POST /api/vehicles/:plate/assign-driver  { driver, driverId? }
router.post(
  "/:plate/assign-driver",
  requireAdmin,
  wrap((req, res) => {
    required(req.body, ["driver"]);
    const v = db.prepare(`SELECT * FROM vehicles WHERE plate = ?`).get(req.params.plate);
    if (!v) throw new ApiError(404, "Vehicle not found");
    db.prepare(`UPDATE vehicles SET driver_name = ?, driver_id = ?, updated_at = datetime('now') WHERE plate = ?`)
      .run(req.body.driver, req.body.driverId || null, req.params.plate);
    audit(req.user.username, "vehicle.assign_driver", "vehicles", v.id, `${req.body.driver} -> ${req.params.plate}`);
    res.json(toApi(db.prepare(`SELECT * FROM vehicles WHERE plate = ?`).get(req.params.plate)));
  })
);

// DELETE /api/vehicles/:plate
router.delete(
  "/:plate",
  requireAdmin,
  wrap((req, res) => {
    const info = db.prepare(`DELETE FROM vehicles WHERE plate = ?`).run(req.params.plate);
    if (!info.changes) throw new ApiError(404, "Vehicle not found");
    audit(req.user.username, "vehicle.delete", "vehicles", null, req.params.plate);
    res.json({ ok: true });
  })
);

module.exports = router;
