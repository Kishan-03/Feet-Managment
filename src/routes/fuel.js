const express = require("express");
const { db, audit } = require("../db");
const { requireAdmin, requireAny } = require("../middleware/auth");
const { wrap, required, ApiError, num } = require("../middleware/error");
const { analyzeLog, analyzeEntry, profileFor, toApi } = require("../services/fuelAnalysis");

const router = express.Router();

// GET /api/fuel  — every entry with its risk analysis + totals
router.get(
  "/",
  requireAny,
  wrap((req, res) => {
    const { entries, totals } = analyzeLog(db);
    const filtered = req.query.plate ? entries.filter((e) => e.plate === req.query.plate) : entries;
    res.json({ entries: filtered, totals });
  })
);

// GET /api/fuel/alerts  — only the entries that need attention
router.get(
  "/alerts",
  requireAdmin,
  wrap((req, res) => {
    const { entries } = analyzeLog(db);
    res.json(entries.filter((e) => e.analysis.status !== "normal"));
  })
);

// POST /api/fuel  — log a fill-up. Rules 1 and 2 reject bad entries here.
router.post(
  "/",
  requireAny,
  wrap((req, res) => {
    required(req.body, ["plate", "receiptNo", "litres", "price"]);
    const b = req.body;
    const plate = String(b.plate).toUpperCase().trim();
    const litres = num(b.litres);
    const price = num(b.price);
    const distance = num(b.distance);

    if (litres <= 0 || price <= 0) throw new ApiError(400, "litres and price must be greater than zero");

    // Rule 1 — tank capacity.
    const profile = profileFor(db, plate);
    if (litres > profile.tankCapacity) {
      throw new ApiError(400, `Entry rejected: ${litres} L exceeds the ${profile.tankCapacity} L tank capacity of ${plate}.`, { rule: "tank_capacity" });
    }

    // Rule 2 — duplicate receipt number.
    const dup = db
      .prepare(`SELECT id, plate FROM fuel_entries WHERE lower(trim(receipt_no)) = lower(trim(?))`)
      .get(b.receiptNo);
    if (dup) {
      throw new ApiError(409, `Entry rejected: receipt ${b.receiptNo} has already been logged for ${dup.plate}.`, { rule: "duplicate_receipt" });
    }

    const now = new Date();
    const info = db
      .prepare(
        `INSERT INTO fuel_entries (plate, station, receipt_no, litres, price, distance, date, time, logged_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        plate,
        b.station || null,
        String(b.receiptNo).trim(),
        litres,
        price,
        distance,
        b.date || now.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        b.time || now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        req.user.username || req.user.sub
      );

    const row = db.prepare(`SELECT * FROM fuel_entries WHERE id = ?`).get(info.lastInsertRowid);
    const all = db.prepare(`SELECT * FROM fuel_entries`).all().map(toApi);
    const entry = toApi(row);
    const analysis = analyzeEntry(entry, all, profile);

    audit(req.user.username || req.user.sub, "fuel.create", "fuel_entries", row.id, `${plate} ${litres}L ${analysis.statusLabel}`);
    res.status(201).json({ ...entry, analysis });
  })
);

// DELETE /api/fuel/:id
router.delete(
  "/:id",
  requireAdmin,
  wrap((req, res) => {
    const info = db.prepare(`DELETE FROM fuel_entries WHERE id = ?`).run(req.params.id);
    if (!info.changes) throw new ApiError(404, "Fuel entry not found");
    audit(req.user.username, "fuel.delete", "fuel_entries", req.params.id, null);
    res.json({ ok: true });
  })
);

module.exports = router;
