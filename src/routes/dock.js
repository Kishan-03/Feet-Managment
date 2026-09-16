const express = require("express");
const { db, audit } = require("../db");
const { requireAdmin, requireAny } = require("../middleware/auth");
const { wrap, required, ApiError } = require("../middleware/error");

const router = express.Router();

const slotToApi = (s) => ({
  id: s.id, time: s.time, plate: s.plate, dock: s.dock,
  load: s.load, tag: s.tag, priority: !!s.priority, date: s.slot_date,
});

// ---------------------------------------------------------------- schedule
// GET /api/dock/schedule?date=YYYY-MM-DD
router.get(
  "/schedule",
  requireAny,
  wrap((req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(`SELECT * FROM dock_schedule WHERE slot_date = ? ORDER BY time`)
      .all(date);
    res.json({ date, bookedCount: rows.length, slots: rows.map(slotToApi) });
  })
);

// POST /api/dock/schedule  — the booking form
router.post(
  "/schedule",
  requireAdmin,
  wrap((req, res) => {
    required(req.body, ["time", "plate", "dock"]);
    const b = req.body;
    const date = b.date || new Date().toISOString().slice(0, 10);

    const clash = db
      .prepare(`SELECT id, plate FROM dock_schedule WHERE slot_date = ? AND dock = ? AND time = ?`)
      .get(date, b.dock, b.time);
    if (clash) throw new ApiError(409, `${b.dock} is already booked at ${b.time} for ${clash.plate}`);

    const info = db
      .prepare(
        `INSERT INTO dock_schedule (time, plate, dock, load, tag, priority, slot_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(b.time, String(b.plate).toUpperCase(), b.dock, b.load || null, b.tag || "On time", b.priority ? 1 : 0, date);

    audit(req.user.username, "dock.book", "dock_schedule", info.lastInsertRowid, `${b.plate} @ ${b.dock} ${b.time}`);
    res.status(201).json(slotToApi(db.prepare(`SELECT * FROM dock_schedule WHERE id = ?`).get(info.lastInsertRowid)));
  })
);

// PATCH /api/dock/schedule/:id  — change time, dock, tag ("Delayed" etc.)
router.patch(
  "/schedule/:id",
  requireAdmin,
  wrap((req, res) => {
    const b = req.body;
    const info = db
      .prepare(
        `UPDATE dock_schedule SET
           time = COALESCE(?, time), dock = COALESCE(?, dock),
           load = COALESCE(?, load), tag = COALESCE(?, tag),
           priority = COALESCE(?, priority)
         WHERE id = ?`
      )
      .run(b.time ?? null, b.dock ?? null, b.load ?? null, b.tag ?? null,
           b.priority == null ? null : (b.priority ? 1 : 0), req.params.id);
    if (!info.changes) throw new ApiError(404, "Slot not found");
    res.json(slotToApi(db.prepare(`SELECT * FROM dock_schedule WHERE id = ?`).get(req.params.id)));
  })
);

// DELETE /api/dock/schedule/:id
router.delete(
  "/schedule/:id",
  requireAdmin,
  wrap((req, res) => {
    const info = db.prepare(`DELETE FROM dock_schedule WHERE id = ?`).run(req.params.id);
    if (!info.changes) throw new ApiError(404, "Slot not found");
    res.json({ ok: true });
  })
);

// ------------------------------------------------------------------- queue
router.get(
  "/queue",
  requireAny,
  wrap((req, res) => {
    const rows = db
      .prepare(`SELECT * FROM yard_queue ORDER BY priority DESC, position, id`)
      .all();
    res.json(rows.map((q) => ({ id: q.id, plate: q.plate, note: q.note, priority: !!q.priority })));
  })
);

router.post(
  "/queue",
  requireAdmin,
  wrap((req, res) => {
    required(req.body, ["plate"]);
    const pos = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM yard_queue`).get().p;
    const info = db
      .prepare(`INSERT INTO yard_queue (plate, note, priority, position) VALUES (?, ?, ?, ?)`)
      .run(String(req.body.plate).toUpperCase(), req.body.note || null, req.body.priority ? 1 : 0, pos);
    res.status(201).json({ id: info.lastInsertRowid });
  })
);

// POST /api/dock/queue/advance — the "Advance queue" button: front goes to back
router.post(
  "/queue/advance",
  requireAdmin,
  wrap((req, res) => {
    const rows = db.prepare(`SELECT id FROM yard_queue ORDER BY priority DESC, position, id`).all();
    if (rows.length > 1) {
      const rotated = [...rows.slice(1), rows[0]];
      const upd = db.prepare(`UPDATE yard_queue SET position = ?, priority = 0 WHERE id = ?`);
      db.transaction(() => rotated.forEach((r, i) => upd.run(i, r.id)))();
    }
    audit(req.user.username, "queue.advance", "yard_queue", null, null);
    res.json(
      db.prepare(`SELECT * FROM yard_queue ORDER BY priority DESC, position, id`)
        .all()
        .map((q) => ({ id: q.id, plate: q.plate, note: q.note, priority: !!q.priority }))
    );
  })
);

// DELETE /api/dock/queue/:id  — vehicle released from the yard
router.delete(
  "/queue/:id",
  requireAdmin,
  wrap((req, res) => {
    const info = db.prepare(`DELETE FROM yard_queue WHERE id = ?`).run(req.params.id);
    if (!info.changes) throw new ApiError(404, "Queue entry not found");
    audit(req.user.username, "queue.release", "yard_queue", req.params.id, null);
    res.json({ ok: true });
  })
);

module.exports = router;
