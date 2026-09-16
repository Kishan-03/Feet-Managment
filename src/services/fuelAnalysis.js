/**
 * The four fuel-fraud rules that used to live in app.js, moved server-side so
 * they can't be edited from the browser.
 *
 *  Rule 1 — litres must not exceed the vehicle's tank capacity (rejected on write)
 *  Rule 2 — a receipt number may not be reused (rejected on write + UNIQUE index)
 *  Rule 3 — fuel logged with no trip distance = unauthorised purchase
 *  Rule 4 — actual vs expected consumption: >15% over = high risk, >5% = warning
 */

const DEFAULT_PROFILE = { mileage: 5, tankCapacity: 200 };

function profileFor(db, plate) {
  const row = db
    .prepare(`SELECT mileage, tank_capacity FROM vehicles WHERE plate = ?`)
    .get(plate);
  if (!row) return { ...DEFAULT_PROFILE };
  return { mileage: row.mileage || DEFAULT_PROFILE.mileage, tankCapacity: row.tank_capacity || DEFAULT_PROFILE.tankCapacity };
}

function analyzeEntry(entry, allEntries, profile) {
  const cost = entry.litres * entry.price;

  // Rule 2 — duplicate receipt number, case-insensitive.
  const isDuplicate = allEntries.some(
    (e) =>
      e.id !== entry.id &&
      String(e.receiptNo).trim().toLowerCase() === String(entry.receiptNo).trim().toLowerCase()
  );
  if (isDuplicate) {
    return {
      cost, expected: null, diffPct: null,
      status: "high",
      statusLabel: "Duplicate bill",
      note: `Receipt ${entry.receiptNo} has already been logged for another fill-up. Duplicate fuel bill detected.`,
    };
  }

  // Rule 3 — fuel purchased with no distance against an active trip.
  if (!entry.distance || entry.distance <= 0) {
    return {
      cost, expected: null, diffPct: null,
      status: "high",
      statusLabel: "No active trip",
      note: "Fuel was purchased with no trip distance on record. Unauthorized fuel purchase — verify with the driver.",
    };
  }

  // Rule 4 — expected vs actual consumption.
  const expected = entry.distance / profile.mileage;
  const diffPct = ((entry.litres - expected) / expected) * 100;
  const actualMileage = entry.distance / entry.litres;

  let status = "normal";
  let statusLabel = "Normal";
  let note = "Fuel usage is in line with the expected consumption for this route.";

  if (diffPct > 15) {
    status = "high";
    statusLabel = "High risk";
    note = `Actual mileage came out to ${actualMileage.toFixed(1)} km/L against the usual ${profile.mileage} km/L — possible theft, engine problem, or overloading. Review the fuel receipt and route history.`;
  } else if (diffPct > 5) {
    status = "warning";
    statusLabel = "Warning";
    note = "Possible fuel misuse — review the fuel receipt and route history for this trip.";
  }

  return { cost, expected, diffPct, status, statusLabel, note, actualMileage };
}

/** Row (snake_case from SQLite) -> API shape (camelCase, like the frontend expects). */
const toApi = (r) => ({
  id: r.id,
  plate: r.plate,
  station: r.station,
  receiptNo: r.receipt_no,
  litres: r.litres,
  price: r.price,
  distance: r.distance,
  date: r.date,
  time: r.time,
});

/** Analyses the whole log and returns entries + aggregate totals. */
function analyzeLog(db) {
  const rows = db.prepare(`SELECT * FROM fuel_entries ORDER BY id DESC`).all().map(toApi);
  const entries = rows.map((e) => ({ ...e, analysis: analyzeEntry(e, rows, profileFor(db, e.plate)) }));

  const totals = entries.reduce(
    (acc, e) => {
      acc.litres += e.litres;
      acc.cost += e.analysis.cost;
      if (e.analysis.status !== "normal") acc.alerts += 1;
      if (e.analysis.status === "high") acc.highRisk += 1;
      return acc;
    },
    { litres: 0, cost: 0, alerts: 0, highRisk: 0 }
  );

  return { entries, totals };
}

module.exports = { profileFor, analyzeEntry, analyzeLog, toApi, DEFAULT_PROFILE };
