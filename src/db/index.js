const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const config = require("../config");

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

const db = new Database(config.dbFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  db.exec(schema);
}

function audit(actor, action, entity, entityId, detail) {
  db.prepare(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail)
     VALUES (?, ?, ?, ?, ?)`
  ).run(actor || "system", action, entity || null, entityId != null ? String(entityId) : null, detail || null);
}

module.exports = { db, migrate, audit };
