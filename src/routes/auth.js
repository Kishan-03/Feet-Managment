const express = require("express");
const bcrypt = require("bcryptjs");
const { db, audit } = require("../db");
const { sign, authenticate } = require("../middleware/auth");
const { wrap, required, ApiError } = require("../middleware/error");

const router = express.Router();

// POST /api/auth/admin/login  { username?, password }
router.post(
  "/admin/login",
  wrap((req, res) => {
    required(req.body, ["password"]);
    const username = req.body.username || "admin";
    const admin = db.prepare(`SELECT * FROM admins WHERE username = ?`).get(username);
    if (!admin || !bcrypt.compareSync(String(req.body.password), admin.password_hash)) {
      throw new ApiError(401, "Incorrect username or password");
    }
    audit(username, "admin.login", "admins", admin.id, null);
    res.json({
      token: sign({ sub: String(admin.id), role: "admin", username: admin.username }),
      user: { username: admin.username, displayName: admin.display_name, role: "admin" },
    });
  })
);

// POST /api/auth/driver/login  { id, pin }
router.post(
  "/driver/login",
  wrap((req, res) => {
    required(req.body, ["id", "pin"]);
    const id = String(req.body.id).trim().toUpperCase();
    const driver = db.prepare(`SELECT * FROM drivers WHERE id = ? AND active = 1`).get(id);
    if (!driver || !bcrypt.compareSync(String(req.body.pin), driver.pin_hash)) {
      throw new ApiError(401, "Incorrect driver ID or PIN");
    }
    audit(id, "driver.login", "drivers", id, null);
    res.json({
      token: sign({ sub: driver.id, role: "driver", name: driver.name }),
      user: { id: driver.id, name: driver.name, plate: driver.plate, role: "driver" },
    });
  })
);

// GET /api/auth/me
router.get("/me", authenticate, (req, res) => res.json({ user: req.user }));

// POST /api/auth/admin/password  { currentPassword, newPassword }
router.post(
  "/admin/password",
  authenticate,
  wrap((req, res) => {
    if (req.user.role !== "admin") throw new ApiError(403, "Admins only");
    required(req.body, ["currentPassword", "newPassword"]);
    const admin = db.prepare(`SELECT * FROM admins WHERE id = ?`).get(req.user.sub);
    if (!admin || !bcrypt.compareSync(String(req.body.currentPassword), admin.password_hash)) {
      throw new ApiError(401, "Current password is incorrect");
    }
    db.prepare(`UPDATE admins SET password_hash = ? WHERE id = ?`)
      .run(bcrypt.hashSync(String(req.body.newPassword), 10), admin.id);
    audit(admin.username, "admin.password_change", "admins", admin.id, null);
    res.json({ ok: true });
  })
);

module.exports = router;
