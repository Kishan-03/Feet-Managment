const jwt = require("jsonwebtoken");
const config = require("../config");

function sign(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.tokenTtl });
}

function readToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

function authenticate(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not allowed for this role" });
    }
    next();
  };
}

const requireAdmin = [authenticate, requireRole("admin")];
const requireDriver = [authenticate, requireRole("driver")];
const requireAny = [authenticate, requireRole("admin", "driver")];

module.exports = { sign, authenticate, requireRole, requireAdmin, requireDriver, requireAny };
