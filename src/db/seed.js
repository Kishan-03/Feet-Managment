/**
 * Creates the schema and loads the data that is currently hard-coded in
 * app.js / drivers-data.js.  Safe to re-run: it only seeds empty tables.
 *   node src/db/seed.js           -> create + seed if empty
 *   node src/db/seed.js --reset   -> wipe everything, then seed
 */
const bcrypt = require("bcryptjs");
const { db, migrate } = require("./index");
const config = require("../config");

const RESET = process.argv.includes("--reset");

migrate();

if (RESET) {
  const tables = [
    "audit_log", "fuel_entries", "yard_queue", "dock_schedule", "documents",
    "trips", "salary_history", "salaries", "route_stops", "routes",
    "vehicles", "drivers", "admins",
  ];
  db.exec("PRAGMA foreign_keys = OFF");
  tables.forEach((t) => db.prepare(`DELETE FROM ${t}`).run());
  db.prepare("DELETE FROM sqlite_sequence").run();
  db.exec("PRAGMA foreign_keys = ON");
  console.log("Wiped existing data.");
}

const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

// ---------------------------------------------------------------- admins
if (count("admins") === 0) {
  db.prepare(
    `INSERT INTO admins (username, password_hash, display_name) VALUES (?, ?, ?)`
  ).run(config.seedAdminUser, bcrypt.hashSync(config.seedAdminPassword, 10), "Fleet Admin");
  console.log(`Admin created: ${config.seedAdminUser} / ${config.seedAdminPassword}`);
}

// -------------------------------------------------------------- vehicles
const VEHICLES = [
  { plate: "MH 12 AX 4581", driver: "R. Deshmukh", status: "healthy",  note: "Inbound to Dock 3 · 18 min",   mileage: 5, tank: 200, driverId: "0001" },
  { plate: "KA 05 TR 7812", driver: "S. Nair",     status: "warning",  note: "Oil change due tomorrow",       mileage: 5.5, tank: 180, driverId: "0002" },
  { plate: "DL 01 FR 2280", driver: "A. Khatri",   status: "critical", note: "Brake inspection flagged",      mileage: 4.8, tank: 200 },
  { plate: "GJ 18 LM 5524", driver: "P. Vasava",   status: "healthy",  note: "Inbound to Dock 1 · 9 min",     mileage: 5.2, tank: 190 },
  { plate: "RJ 14 KT 4107", driver: "M. Solanki",  status: "warning",  note: "Tire pressure low, rear left",  mileage: 4.5, tank: 210 },
  { plate: "TN 09 BV 3390", driver: "K. Murugan",  status: "healthy",  note: "On schedule, NH44",             mileage: 5, tank: 200 },
  { plate: "UP 32 GT 8823", driver: "V. Yadav",    status: "critical", note: "Engine temp alert active",      mileage: 4.6, tank: 200 },
  { plate: "WB 06 CF 1256", driver: "D. Sarkar",   status: "healthy",  note: "Returning to yard",             mileage: 5.3, tank: 190 },
];

// --------------------------------------------------------------- drivers
const DRIVERS = [
  {
    id: "0001", pin: "0603", name: "R. Deshmukh", plate: "MH 12 AX 4581",
    route: {
      distance: "186 km", vehicle: "MH 12 AX 4581",
      stops: [
        { time: "07:30", place: "Depot yard, Bhiwandi",      note: "Vehicle check-out, load verification", status: "done" },
        { time: "09:10", place: "Dock 3, Mumbai warehouse",  note: "Loaded outbound shipment #4471",       status: "done" },
        { time: "11:45", place: "Toll plaza, NH48",          note: "Fuel top-up stop",                     status: "current" },
        { time: "14:20", place: "Vapi distribution hub",     note: "Drop crates 1-14, collect POD",        status: "upcoming" },
        { time: "17:00", place: "Depot yard, Bhiwandi",      note: "Return, vehicle check-in",             status: "upcoming" },
      ],
    },
    salary: { base: 28000, tripBonus: 4200, fuelAllowance: 2500, advance: 3000, pf: 1680 },
    history: [
      { month: "June 2026",  amount: 29820 },
      { month: "May 2026",   amount: 31040 },
      { month: "April 2026", amount: 28960 },
    ],
    trips: [
      { date: "08 Jul", route: "Bhiwandi → Vapi",    km: 186, earning: 420 },
      { date: "05 Jul", route: "Bhiwandi → Surat",   km: 264, earning: 610 },
      { date: "02 Jul", route: "Bhiwandi → Pune",    km: 148, earning: 340 },
      { date: "29 Jun", route: "Bhiwandi → Nashik",  km: 172, earning: 390 },
    ],
    documents: [
      { name: "Driving license",              meta: "LMV + HMV, issued Karnataka", status: "valid",   statusText: "Valid till Mar 2028" },
      { name: "Vehicle RC",                   meta: "MH 12 AX 4581",               status: "valid",   statusText: "Valid till Nov 2027" },
      { name: "Insurance",                    meta: "Comprehensive cover",         status: "warning", statusText: "Renews in 18 days" },
      { name: "Medical fitness certificate",  meta: "Annual requirement",          status: "expired", statusText: "Expired, renew now" },
    ],
  },
  {
    id: "0002", pin: "1708", name: "S. Nair", plate: "KA 05 TR 7812",
    route: {
      distance: "92 km", vehicle: "KA 05 TR 7812",
      stops: [
        { time: "08:00", place: "Depot yard, Whitefield",        note: "Vehicle check-out",                status: "done" },
        { time: "09:30", place: "Dock 2, Bengaluru warehouse",   note: "Loading returns batch",            status: "current" },
        { time: "12:15", place: "Electronic City hub",           note: "Drop returns, collect empties",    status: "upcoming" },
        { time: "15:00", place: "Depot yard, Whitefield",        note: "Return, vehicle check-in",         status: "upcoming" },
      ],
    },
    salary: { base: 26500, tripBonus: 2800, fuelAllowance: 2100, advance: 0, pf: 1590 },
    history: [
      { month: "June 2026",  amount: 29810 },
      { month: "May 2026",   amount: 28200 },
      { month: "April 2026", amount: 29010 },
    ],
    trips: [
      { date: "09 Jul", route: "Whitefield → Electronic City", km: 92,  earning: 210 },
      { date: "07 Jul", route: "Whitefield → Hosur",           km: 124, earning: 280 },
      { date: "03 Jul", route: "Whitefield → Mysuru",          km: 280, earning: 640 },
    ],
    documents: [
      { name: "Driving license",             meta: "LMV + HMV, issued Kerala", status: "valid", statusText: "Valid till Jan 2029" },
      { name: "Vehicle RC",                  meta: "KA 05 TR 7812",            status: "valid", statusText: "Valid till Aug 2027" },
      { name: "Insurance",                   meta: "Comprehensive cover",      status: "valid", statusText: "Valid till Dec 2026" },
      { name: "Medical fitness certificate", meta: "Annual requirement",       status: "valid", statusText: "Valid till Sep 2026" },
    ],
  },
];

const SCHEDULE = [
  { time: "13:00", plate: "MH 12 AX 4581", dock: "Dock 3", load: "Outbound shipment",    tag: "On time",  priority: 0 },
  { time: "13:45", plate: "RJ 14 KT 4107", dock: "Dock 1", load: "Priority dispatch",    tag: "Priority", priority: 1 },
  { time: "14:30", plate: "GJ 18 LM 5524", dock: "Dock 1", load: "Inbound raw material", tag: "On time",  priority: 0 },
  { time: "15:10", plate: "KA 05 TR 7812", dock: "Dock 2", load: "Returns",              tag: "On time",  priority: 0 },
  { time: "16:00", plate: "UP 32 GT 8823", dock: "Dock 4", load: "Outbound shipment",    tag: "Delayed",  priority: 0 },
];

const QUEUE = [
  { plate: "RJ 14 KT 4107", note: "Priority dispatch",   priority: 1 },
  { plate: "UP 32 GT 8823", note: "Awaiting Dock 4",     priority: 1 },
  { plate: "TN 09 BV 3390", note: "Awaiting inspection", priority: 0 },
  { plate: "WB 06 CF 1256", note: "Yard entry queue",    priority: 0 },
  { plate: "KA 05 TR 7812", note: "Yard entry queue",    priority: 0 },
];

// One of each situation the fuel rules are meant to catch.
const FUEL = [
  { plate: "MH 12 AX 4581", station: "Indian Oil",        receiptNo: "IOC48213", litres: 120, price: 105, distance: 525, date: "25 Aug", time: "11:30 AM" },
  { plate: "KA 05 TR 7812", station: "Bharat Petroleum",  receiptNo: "BPL77410", litres: 125, price: 104, distance: 660, date: "24 Aug", time: "09:10 AM" },
  { plate: "DL 01 FR 2280", station: "HP Petrol Pump",    receiptNo: "HP33021",  litres: 105, price: 106, distance: 432, date: "23 Aug", time: "02:15 PM" },
  { plate: "GJ 18 LM 5524", station: "Indian Oil",        receiptNo: "IOC55190", litres: 60,  price: 105, distance: 0,   date: "22 Aug", time: "06:40 PM" },
  { plate: "RJ 14 KT 4107", station: "Shell",             receiptNo: "SHL10432", litres: 95,  price: 107, distance: 410, date: "21 Aug", time: "10:05 AM" },
  // NOTE: duplicate of IOC48213 above. The UNIQUE index rejects it, so it is
  // seeded with a suffix; flip DEMO_DUPLICATE to false to skip it entirely.
  { plate: "UP 32 GT 8823", station: "Indian Oil",        receiptNo: "IOC48213-DUP", litres: 80, price: 105, distance: 300, date: "20 Aug", time: "08:20 AM" },
];

const seedAll = db.transaction(() => {
  if (count("drivers") === 0) {
    const insDriver = db.prepare(
      `INSERT INTO drivers (id, name, plate, pin_hash) VALUES (?, ?, ?, ?)`
    );
    const insRoute = db.prepare(
      `INSERT INTO routes (driver_id, distance, vehicle) VALUES (?, ?, ?)`
    );
    const insStop = db.prepare(
      `INSERT INTO route_stops (route_id, position, time, place, note, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insSalary = db.prepare(
      `INSERT INTO salaries (driver_id, base, trip_bonus, fuel_allowance, advance, pf)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insHist = db.prepare(
      `INSERT INTO salary_history (driver_id, month, amount) VALUES (?, ?, ?)`
    );
    const insTrip = db.prepare(
      `INSERT INTO trips (driver_id, plate, date, route, km, earning) VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insDoc = db.prepare(
      `INSERT INTO documents (driver_id, name, meta, status, status_text) VALUES (?, ?, ?, ?, ?)`
    );

    for (const d of DRIVERS) {
      insDriver.run(d.id, d.name, d.plate, bcrypt.hashSync(d.pin, 10));
      const routeId = insRoute.run(d.id, d.route.distance, d.route.vehicle).lastInsertRowid;
      d.route.stops.forEach((s, i) => insStop.run(routeId, i, s.time, s.place, s.note, s.status));
      insSalary.run(d.id, d.salary.base, d.salary.tripBonus, d.salary.fuelAllowance, d.salary.advance, d.salary.pf);
      d.history.forEach((h) => insHist.run(d.id, h.month, h.amount));
      d.trips.forEach((t) => insTrip.run(d.id, d.plate, t.date, t.route, t.km, t.earning));
      d.documents.forEach((doc) => insDoc.run(d.id, doc.name, doc.meta, doc.status, doc.statusText));
    }
    console.log(`Seeded ${DRIVERS.length} drivers with route, payroll, trips and documents.`);
  }

  if (count("vehicles") === 0) {
    const ins = db.prepare(
      `INSERT INTO vehicles (plate, driver_id, driver_name, status, note, mileage, tank_capacity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    VEHICLES.forEach((v) =>
      ins.run(v.plate, v.driverId || null, v.driver, v.status, v.note, v.mileage, v.tank)
    );
    console.log(`Seeded ${VEHICLES.length} vehicles.`);
  }

  if (count("dock_schedule") === 0) {
    const ins = db.prepare(
      `INSERT INTO dock_schedule (time, plate, dock, load, tag, priority) VALUES (?, ?, ?, ?, ?, ?)`
    );
    SCHEDULE.forEach((s) => ins.run(s.time, s.plate, s.dock, s.load, s.tag, s.priority));
    console.log(`Seeded ${SCHEDULE.length} dock slots.`);
  }

  if (count("yard_queue") === 0) {
    const ins = db.prepare(
      `INSERT INTO yard_queue (plate, note, priority, position) VALUES (?, ?, ?, ?)`
    );
    QUEUE.forEach((q, i) => ins.run(q.plate, q.note, q.priority, i));
    console.log(`Seeded ${QUEUE.length} queue entries.`);
  }

  if (count("fuel_entries") === 0) {
    const ins = db.prepare(
      `INSERT INTO fuel_entries (plate, station, receipt_no, litres, price, distance, date, time, logged_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed')`
    );
    FUEL.forEach((f) => ins.run(f.plate, f.station, f.receiptNo, f.litres, f.price, f.distance, f.date, f.time));
    console.log(`Seeded ${FUEL.length} fuel entries.`);
  }
});

seedAll();
console.log("Database ready at", config.dbFile);
