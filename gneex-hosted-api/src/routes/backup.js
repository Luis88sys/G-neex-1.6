const express = require("express");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin);

/**
 * Importar respaldo completo G-NEEX (`meta.format === "G-NEEX-backup"`).
 * Escribe el objeto `data` en kv_store (omite phoenix-session).
 */
router.post("/import", (req, res) => {
  const body = req.body;
  const payload = body && typeof body === "object" ? body : {};
  const meta = payload.meta || {};
  if (meta.format && meta.format !== "G-NEEX-backup") {
    return res.status(400).json({ ok: false, error: "unknown_backup_format", format: meta.format });
  }
  const data = payload.data;
  if (!data || typeof data !== "object") {
    return res.status(400).json({ ok: false, error: "missing_data_section" });
  }
  const cleaned = { ...data };
  delete cleaned["phoenix-session"];
  db.upsertMany(cleaned);
  const revision = db.bumpRevision();
  db.setMeta("last_kv_update", new Date().toISOString());
  db.setMeta("last_backup_import", new Date().toISOString());
  res.json({
    ok: true,
    revision,
    keysWritten: Object.keys(cleaned).length,
    importedAt: payload.exportedAt || null
  });
});

/**
 * Exportar en forma compatible con la importación de la app (estructura similar al respaldo completo).
 */
router.get("/export", (req, res) => {
  const now = new Date();
  const backup = db.getAllKv();
  const content = {
    exportedAt: now.toISOString(),
    app: "G-NEEX",
    meta: {
      format: "G-NEEX-backup",
      exportTitle: "Hosted API export (gneex-hosted-api)",
      exportedAtUtc: now.toISOString(),
      source: "gneex-hosted-api"
    },
    artifacts: {},
    data: backup
  };
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(content, null, 2));
});

module.exports = router;
