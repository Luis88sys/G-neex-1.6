const path = require("path");
const express = require("express");
const cors = require("cors");
const config = require("./config");

// Inicializa SQLite y migraciones
require("./db").getDb();

const authRoutes = require("./routes/auth");
const syncRoutes = require("./routes/sync");
const backupRoutes = require("./routes/backup");

const app = express();

const corsOptions =
  config.corsOrigin && String(config.corsOrigin).trim()
    ? { origin: config.corsOrigin.trim(), credentials: true }
    : { origin: true, credentials: true };

app.use(cors(corsOptions));
app.use(express.json({ limit: config.jsonLimit }));

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/sync", syncRoutes);
app.use("/api/v1/backup", backupRoutes);

app.get("/api/v1", (req, res) => {
  res.json({
    ok: true,
    name: "gneex-hosted-api",
    docs: "See README.md in gneex-hosted-api/",
    endpoints: [
      "GET  /api/v1/auth/health",
      "POST /api/v1/auth/bootstrap",
      "POST /api/v1/auth/login",
      "GET  /api/v1/sync (Bearer)",
      "PATCH /api/v1/sync (Bearer)",
      "PUT  /api/v1/sync/full (Bearer)",
      "POST /api/v1/backup/import (Bearer, admin)",
      "GET  /api/v1/backup/export (Bearer, admin)"
    ]
  });
});

app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "payload_too_large" });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: "internal_error" });
});

app.listen(config.port, () => {
  console.log(`[gneex-hosted-api] http://localhost:${config.port}/api/v1`);
  console.log(`[gneex-hosted-api] DB: ${path.resolve(config.dbPath)}`);
});
