/**
 * Driver-portal endpoints. A driver token can only ever read or write its own
 * record — the id comes from the JWT, never from the URL.
 */
const express = require("express");
const bcrypt = require("bcryptjs");
const { db, audit } = require("../db");
const { requireDriver } = require("../middleware/auth");
const { wrap, required, ApiError } = require("../middleware/error");
const { getDriver } = require("../services/drivers");

const router = express.Router();
router.use(requireDriver);

// GET /api/me  — everything driver.html renders
router.get(
  "/",
  wrap((req, res) => {
    const d = getDriver(req.user.sub);
    if (!d) throw new ApiError(404, "Driver record not found");
    res.json(d);
  })
);

router.get("/route", wrap((req, res) => res.json(getDriver(req.user.sub).route)));
router.get("/salary", wrap((req, res) => res.json(getDriver(req.user.sub).salary)));
router.get("/trips", wrap((req, res) => res.json(getDriver(req.user.sub).trips)));
router.get("/documents", wrap((req, res) => res.json(getDriver(req.user.sub).documents)));

// PATCH /api/me/stops/:stopId  { status }  — driver marks a stop done
router.patch(
  "/stops/:stopId",
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
      .run(req.body.status, req.params.stopId, req.user.sub);
    if (!info.changes) throw new ApiError(404, "Stop not found on your route");
    audit(req.user.sub, "stop.update", "route_stops", req.params.stopId, req.body.status);
    res.json(getDriver(req.user.sub).route);
  })
);

// POST /api/me/pin  { currentPin, newPin }
router.post(
  "/pin",
  wrap((req, res) => {
    required(req.body, ["currentPin", "newPin"]);
    if (!/^\d{4,6}$/.test(String(req.body.newPin))) {
      throw new ApiError(400, "New PIN must be 4-6 digits");
    }
    const d = db.prepare(`SELECT pin_hash FROM drivers WHERE id = ?`).get(req.user.sub);
    if (!d || !bcrypt.compareSync(String(req.body.currentPin), d.pin_hash)) {
      throw new ApiError(401, "Current PIN is incorrect");
    }
    db.prepare(`UPDATE drivers SET pin_hash = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(bcrypt.hashSync(String(req.body.newPin), 10), req.user.sub);
    audit(req.user.sub, "driver.pin_change", "drivers", req.user.sub, null);
    res.json({ ok: true });
  })
);

module.exports = router;
