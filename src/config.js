require("dotenv").config();
const path = require("path");

module.exports = {
  port: Number(process.env.PORT || 4000),
  dbFile: process.env.DB_FILE || path.join(__dirname, "..", "data", "fleet.db"),
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  tokenTtl: process.env.TOKEN_TTL || "12h",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  seedAdminUser: process.env.ADMIN_USER || "admin",
  seedAdminPassword: process.env.ADMIN_PASSWORD || "Kishan",
};
