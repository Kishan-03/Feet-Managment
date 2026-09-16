-- =====================================================================
--  FleetOps database schema (SQLite)
--  Every table the admin dashboard and the driver portal need.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Admin users (replaces the hard-coded ADMIN_PASSWORD in app.js)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Drivers (id is the 4-digit login code, e.g. "0001")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  plate        TEXT,
  pin_hash     TEXT NOT NULL,
  phone        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Vehicles + their fuel profile (mileage / tank capacity drive the
-- fuel-fraud rules)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  plate          TEXT NOT NULL UNIQUE,
  driver_id      TEXT REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name    TEXT,
  status         TEXT NOT NULL DEFAULT 'healthy'
                 CHECK (status IN ('healthy','warning','critical')),
  note           TEXT,
  mileage        REAL NOT NULL DEFAULT 5.0,    -- km per litre
  tank_capacity  REAL NOT NULL DEFAULT 200.0,  -- litres
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

-- ---------------------------------------------------------------------
-- A driver's assigned route for the day + its stops
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS routes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id   TEXT NOT NULL UNIQUE REFERENCES drivers(id) ON DELETE CASCADE,
  distance    TEXT,
  vehicle     TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS route_stops (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id    INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  time        TEXT,
  place       TEXT NOT NULL,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('done','current','upcoming'))
);
CREATE INDEX IF NOT EXISTS idx_stops_route ON route_stops(route_id, position);

-- ---------------------------------------------------------------------
-- Payroll: current salary components + paid history
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS salaries (
  driver_id       TEXT PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
  base            REAL NOT NULL DEFAULT 0,
  trip_bonus      REAL NOT NULL DEFAULT 0,
  fuel_allowance  REAL NOT NULL DEFAULT 0,
  advance         REAL NOT NULL DEFAULT 0,
  pf              REAL NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS salary_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id  TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,          -- e.g. "June 2026"
  amount     REAL NOT NULL,
  paid_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_salhist_driver ON salary_history(driver_id);

-- ---------------------------------------------------------------------
-- Completed trips (driver portal "recent trips" + earnings)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id  TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  plate      TEXT,
  date       TEXT NOT NULL,          -- e.g. "08 Jul"
  route      TEXT NOT NULL,          -- e.g. "Bhiwandi → Vapi"
  km         REAL NOT NULL DEFAULT 0,
  earning    REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);

-- ---------------------------------------------------------------------
-- Driver documents (licence, RC, insurance, medical…)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id   TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  meta        TEXT,
  status      TEXT NOT NULL DEFAULT 'valid'
              CHECK (status IN ('valid','warning','expired')),
  status_text TEXT,
  expires_on  TEXT
);
CREATE INDEX IF NOT EXISTS idx_docs_driver ON documents(driver_id);

-- ---------------------------------------------------------------------
-- Dock schedule + yard queue
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dock_schedule (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  time       TEXT NOT NULL,          -- "13:45"
  plate      TEXT NOT NULL,
  dock       TEXT NOT NULL,
  load       TEXT,
  tag        TEXT NOT NULL DEFAULT 'On time',
  priority   INTEGER NOT NULL DEFAULT 0,
  slot_date  TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sched_date ON dock_schedule(slot_date, time);

CREATE TABLE IF NOT EXISTS yard_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plate      TEXT NOT NULL,
  note       TEXT,
  priority   INTEGER NOT NULL DEFAULT 0,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------
-- Fuel log. receipt_no is UNIQUE so the database itself enforces
-- "no duplicate bills" (Rule 2) even if the API is bypassed.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plate       TEXT NOT NULL,
  station     TEXT,
  receipt_no  TEXT NOT NULL,
  litres      REAL NOT NULL CHECK (litres > 0),
  price       REAL NOT NULL CHECK (price > 0),
  distance    REAL NOT NULL DEFAULT 0,
  date        TEXT,
  time        TEXT,
  logged_by   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_receipt
  ON fuel_entries(lower(trim(receipt_no)));
CREATE INDEX IF NOT EXISTS idx_fuel_plate ON fuel_entries(plate);

-- ---------------------------------------------------------------------
-- Audit trail — who changed what (handy for payroll disputes)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
