# FleetOps — full stack

The Fleet Management dashboard and driver portal, wired end to end: the original
frontend, a REST API, and a SQLite database.

Everything the frontend used to keep in hard-coded arrays and `localStorage` now
lives in a real database, behind real authentication. `app.js` and `driver.js`
have been rewritten to call the API — no page holds its own copy of the data,
and the two portals see the same records.

**Stack:** Node.js + Express + SQLite (better-sqlite3), JWT auth, bcrypt password/PIN hashing.

---

## Quick start

```bash
cd fleet-backend
npm install
cp .env.example .env        # then edit JWT_SECRET
npm run db:init             # creates data/fleet.db and loads the seed data
npm start                   # http://localhost:4000
```

Seeded logins: admin `Kishan`, drivers `0001`/`0603` and `0002`/`1708`.

`npm run db:reset` wipes and re-seeds. `npm run dev` restarts on file changes.

The frontend is already in `public/`, so `http://localhost:4000` opens the admin
dashboard and `http://localhost:4000/driver.html` opens the driver portal. One
origin, so there is no CORS to think about.

To host the pages somewhere else instead (Live Server, Netlify), set
`CORS_ORIGIN=http://localhost:5500` in `.env` and add
`<script>window.FLEET_API_BASE = "http://localhost:4000";</script>` before
`api.js` in both HTML files.

---

## Database

`src/db/schema.sql` — 13 tables:

| Table | Holds |
|---|---|
| `admins` | Admin accounts. Replaces the `ADMIN_PASSWORD` constant in app.js. |
| `drivers` | Driver ID, name, plate, bcrypt-hashed PIN, active flag. |
| `vehicles` | Plate, assigned driver, health status, note, mileage, tank capacity. |
| `routes` / `route_stops` | The day's route and its ordered stops (done / current / upcoming). |
| `salaries` | Base, trip bonus, fuel allowance, advance, PF. |
| `salary_history` | Each month's paid amount. |
| `trips` | Completed trips with km and earnings. |
| `documents` | Licence, RC, insurance, medical, with validity status. |
| `dock_schedule` | Booked dock slots per date. |
| `yard_queue` | Vehicles waiting in the yard. |
| `fuel_entries` | Fuel log. `receipt_no` has a UNIQUE index, so duplicate bills are impossible at the database level. |
| `audit_log` | Who changed what, when — useful for payroll disputes. |

Foreign keys cascade: deleting a driver removes their route, stops, salary, history, trips and documents in one transaction.

`data/fleet.db` is a single file — back it up by copying it. To move to Postgres later, the schema translates almost directly; only `AUTOINCREMENT` → `SERIAL` and the `lower(trim())` index need editing.

---

## Authentication

Both portals get a JWT (12h by default) stored in `sessionStorage` and sent as `Authorization: Bearer <token>`.

- **Admin token** — full access to everything.
- **Driver token** — only `/api/me/*`, and the driver ID comes from the token, so one driver can't read another's payroll by editing a URL.

Passwords and PINs are bcrypt-hashed. Nothing sensitive is readable from page source any more.

---

## API

All routes are under `/api`. Admin-only unless noted.

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/admin/login` | `{ username?, password }` → token |
| POST | `/auth/driver/login` | `{ id, pin }` → token |
| GET | `/auth/me` | current token's identity |
| POST | `/auth/admin/password` | change admin password |

### Vehicles
| Method | Path | Notes |
|---|---|---|
| GET | `/vehicles?status=healthy\|warning\|critical\|all` | list, optionally filtered |
| GET | `/vehicles/:plate` | one vehicle |
| POST | `/vehicles` | add |
| PATCH | `/vehicles/:plate` | health status, note, mileage, tank capacity |
| POST | `/vehicles/:plate/assign-driver` | `{ driver, driverId? }` |
| DELETE | `/vehicles/:plate` | remove |

### Drivers & payroll
| Method | Path | Notes |
|---|---|---|
| GET | `/drivers` | full nested records |
| GET | `/drivers/:id` | one record |
| POST | `/drivers` | create (`id`, `pin`, `name` required) |
| PUT | `/drivers/:id` | update any part — salary, route, stops, documents |
| DELETE | `/drivers/:id` | cascading delete |
| POST | `/drivers/:id/record-payment` | files net pay into history, clears the advance |
| POST | `/drivers/:id/trips` | log a trip |
| DELETE | `/drivers/:id/trips/:tripId` | remove a trip |
| PATCH | `/drivers/:id/stops/:stopId` | `{ status }` |

`salary.net` is computed server-side as `(base + tripBonus + fuelAllowance) − (advance + pf)`, so the browser can't disagree with the database about what someone is owed.

### Dock & yard
| Method | Path | Notes |
|---|---|---|
| GET | `/dock/schedule?date=YYYY-MM-DD` | slots + booked count |
| POST | `/dock/schedule` | book — returns 409 if that dock/time is taken |
| PATCH | `/dock/schedule/:id` | reschedule or re-tag |
| DELETE | `/dock/schedule/:id` | cancel |
| GET/POST | `/dock/queue` | yard queue |
| DELETE | `/dock/queue/:id` | release |

### Fuel
| Method | Path | Notes |
|---|---|---|
| GET | `/fuel?plate=` | entries with risk analysis + totals (drivers may also read) |
| GET | `/fuel/alerts` | only entries needing attention |
| POST | `/fuel` | log a fill-up |
| DELETE | `/fuel/:id` | remove |

### Metrics
`GET /metrics/fleet`, `/metrics/payroll`, `/metrics/fuel`, `/notifications`, `/audit?limit=`

### Driver portal (driver token)
`GET /me`, `/me/route`, `/me/salary`, `/me/trips`, `/me/documents`
`PATCH /me/stops/:stopId` · `POST /me/pin`

---

## Fuel fraud rules

The four rules from `app.js` now run in `src/services/fuelAnalysis.js`, server-side, where a driver can't edit them:

1. **Tank capacity** — litres above the vehicle's tank size is rejected with 400 before it's ever stored.
2. **Duplicate receipt** — a reused receipt number is rejected with 409, and the UNIQUE index blocks it even if the API is bypassed.
3. **No active trip** — fuel logged with zero distance is flagged as an unauthorised purchase.
4. **Consumption variance** — actual litres vs `distance ÷ mileage`. More than 15% over is high risk, more than 5% is a warning.

Every entry returns an `analysis` object with `status`, `statusLabel`, `note`, `cost`, `expected` and `diffPct` — the same fields the existing render code uses.

---

## What changed in the frontend

`public/api.js` is a small client that mirrors every endpoint. Both pages load it
before their own script, in place of the old `drivers-data.js` (deleted — the
driver store it provided is now the `drivers` table).

| Was | Now |
|---|---|
| `ADMIN_PASSWORD` compared in `app.js` | `FleetAPI.auth.adminLogin()`; the password never reaches the page |
| PIN list readable in `driver.js` source | `FleetAPI.auth.driverLogin()`; PINs are bcrypt hashes in the database |
| `const vehicles = [...]` | `FleetAPI.vehicles.list()`, refreshed after every write |
| `schedule.push(...)` on booking | `FleetAPI.dock.book()`, which refuses a double-booked dock/time |
| `queue.push(queue.shift())` | `FleetAPI.dock.advanceQueue()` |
| `FleetDriverStore` in `localStorage` | `FleetAPI.drivers.*` and `FleetAPI.me.*` |
| Metrics counted from local arrays | `FleetAPI.metrics.fleet()` / `.payroll()` / `.notifications()` |
| Fuel rules 1–4 running in `app.js` | `FleetAPI.fuel.log()`; the server decides and returns the verdict |
| Cross-tab sync via the `storage` event | Poll every 30s, plus an immediate refresh when the tab regains focus |

Two behaviours worth knowing:

- **The PIN box is blank when you edit a driver.** Hashes are never sent back, so
  blank means "keep the current PIN". Type four digits to change it.
- **A driver's ID is fixed once created.** It is the primary key, so the field is
  read-only when editing. Delete and recreate to change it.

Notifications now cover more ground than before: vehicle health, expiring driver
documents, and high-risk fuel entries all feed the same dropdown.

---

## Tests

`node e2e.js` (from the parent folder, with the server running) drives both pages
in jsdom against the live database — login, rendering, health edits, dock
booking, queue rotation, all four fuel rules, payroll edits, recording a payment,
creating a driver, then logging in as that driver. 60 checks.

---

## Before putting this in front of real users

- Set a long random `JWT_SECRET` and change the seeded admin password.
- Put it behind HTTPS; add `helmet` and a rate limiter on the login routes.
- Swap SQLite for Postgres if more than one server process will write concurrently.
- Add a scheduled job to flip document status to `warning`/`expired` off `expires_on`, instead of the status being typed in by hand.
