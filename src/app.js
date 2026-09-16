const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const config = require("./config");
const { migrate } = require("./db");
const { notFound, errorHandler } = require("./middleware/error");

migrate();

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/vehicles", require("./routes/vehicles"));
app.use("/api/drivers", require("./routes/drivers"));
app.use("/api/dock", require("./routes/dock"));
app.use("/api/fuel", require("./routes/fuel"));
app.use("/api/me", require("./routes/me"));
app.use("/api", require("./routes/metrics")); // /api/metrics/*, /api/notifications, /api/audit

// Drop the existing index.html / driver.html / css / js into ./public and the
// whole thing runs from one origin — no CORS, no separate static server.
app.use(express.static(path.join(__dirname, "..", "public")));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
