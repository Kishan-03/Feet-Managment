const express = require("express");
const { db } = require("../db");
const { requireAdmin } = require("../middleware/auth");
const { wrap } = require("../middleware/error");
const { analyzeLog } = require("../services/fuelAnalysis");
const { netPay } = require("../services/drivers");

const router = express.Router();

// GET /api/metrics/fleet  — the numbers on the dashboard cards
router.get(
  "/metrics/fleet",
  requireAdmin,
  wrap((req, res) => {
    const rows = db.prepare(`SELECT status FROM vehicles`).all();
    const total = rows.length;
    const healthy = rows.filter((v) => v.status === "healthy").length;
    const warning = rows.filter((v) => v.status === "warning").length;
    const critical = rows.filter((v) => v.status === "critical").length;

    res.json({
      total,
      healthy,
      warning,
      critical,
      maintenanceDue: warning + critical,
      healthyPct: total ? Math.round((healthy / total) * 100) : 0,
      bookedToday: db
        .prepare(`SELECT COUNT(*) AS n FROM dock_schedule WHERE slot_date = date('now')`)
        .get().n,
      inQueue: db.prepare(`SELECT COUNT(*) AS n FROM yard_queue`).get().n,
    });
  })
);

// GET /api/metrics/payroll
router.get(
  "/metrics/payroll",
  requireAdmin,
  wrap((req, res) => {
    const rows = db
      .prepare(`SELECT s.*, d.name FROM salaries s JOIN drivers d ON d.id = s.driver_id`)
      .all();
    const totalNet = rows.reduce((sum, r) => sum + netPay(r), 0);
    const advances = rows.filter((r) => r.advance > 0);
    res.json({
      driverCount: rows.length,
      totalNet,
      advanceCount: advances.length,
      advanceNames: advances.map((r) => r.name.split(" ")[0]),
    });
  })
);

// GET /api/metrics/fuel
router.get(
  "/metrics/fuel",
  requireAdmin,
  wrap((req, res) => res.json(analyzeLog(db).totals))
);

// GET /api/notifications  — vehicle alerts + expiring documents + fuel alerts
router.get(
  "/notifications",
  requireAdmin,
  wrap((req, res) => {
    const items = [];

    db.prepare(`SELECT plate, status, note FROM vehicles WHERE status != 'healthy'`)
      .all()
      .forEach((v) =>
        items.push({
          type: "vehicle",
          severity: v.status === "critical" ? "critical" : "warning",
          title: `${v.status === "critical" ? "Critical" : "Needs attention"}: ${v.plate}`,
          detail: v.note,
        })
      );

    db.prepare(
      `SELECT d.name AS doc, d.status, d.status_text, dr.name AS driver
       FROM documents d JOIN drivers dr ON dr.id = d.driver_id
       WHERE d.status != 'valid'`
    )
      .all()
      .forEach((d) =>
        items.push({
          type: "document",
          severity: d.status === "expired" ? "critical" : "warning",
          title: `${d.doc} — ${d.driver}`,
          detail: d.status_text,
        })
      );

    analyzeLog(db)
      .entries.filter((e) => e.analysis.status === "high")
      .forEach((e) =>
        items.push({
          type: "fuel",
          severity: "critical",
          title: `${e.analysis.statusLabel}: ${e.plate}`,
          detail: e.analysis.note,
        })
      );

    res.json({ count: items.length, items });
  })
);

// GET /api/audit?limit=50
router.get(
  "/audit",
  requireAdmin,
  wrap((req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json(
      db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`).all(limit)
    );
  })
);

module.exports = router;
