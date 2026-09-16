class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const notFound = (req, res) =>
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });

function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.code === "SQLITE_CONSTRAINT_UNIQUE") {
    return res.status(409).json({ error: "That value already exists", details: err.message });
  }
  if (err && String(err.code || "").startsWith("SQLITE_CONSTRAINT")) {
    return res.status(400).json({ error: "Database constraint failed", details: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

/** Wraps an async handler so thrown errors reach errorHandler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Throws 400 unless every listed field is present and non-empty. */
function required(body, fields) {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ""
  );
  if (missing.length) {
    throw new ApiError(400, `Missing required field(s): ${missing.join(", ")}`);
  }
}

const num = (v, fallback = 0) => (v === undefined || v === null || v === "" ? fallback : Number(v));

module.exports = { ApiError, notFound, errorHandler, wrap, required, num };
