const express = require("express");
const db = require("../db");
const { requireAuth, canSyncWrite } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

/** GET todas las claves (equivalente a leer localStorage de trabajo en servidor). */
router.get("/", (req, res) => {
  const data = db.getAllKv();
  const revision = db.getMeta("revision") || "0";
  res.json({
    ok: true,
    revision,
    updatedAt: db.getMeta("last_kv_update") || null,
    data
  });
});

/** GET una clave concreta (URL-encode si incluye caracteres especiales). */
router.get("/key/:key", (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const row = db.getDb().prepare("SELECT v FROM kv_store WHERE k = ?").get(key);
  if (!row) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  res.json({ ok: true, key, value: row.v });
});

/** PATCH parcial: body.data = { "phoenix-inventory": "[...]", ... } valores como string JSON en localStorage. */
router.patch("/", (req, res) => {
  if (!canSyncWrite(req)) {
    return res.status(403).json({ ok: false, error: "sync_write_forbidden" });
  }
  const patch = req.body && req.body.data;
  if (!patch || typeof patch !== "object") {
    return res.status(400).json({ ok: false, error: "expected_body_data_object" });
  }
  const cleaned = { ...patch };
  delete cleaned["phoenix-session"];
  db.upsertMany(cleaned);
  const revision = db.bumpRevision();
  db.setMeta("last_kv_update", new Date().toISOString());
  res.json({ ok: true, revision, keysWritten: Object.keys(cleaned).length });
});

/** PUT reemplazo total del almacén (vacía claves no enviadas). Solo administración / migración. */
router.put("/full", (req, res) => {
  if (!canSyncWrite(req)) {
    return res.status(403).json({ ok: false, error: "sync_write_forbidden" });
  }
  const next = req.body && req.body.data;
  if (!next || typeof next !== "object") {
    return res.status(400).json({ ok: false, error: "expected_body_data_object" });
  }
  delete next["phoenix-session"];
  db.clearAllKv();
  db.upsertMany(next);
  const revision = db.bumpRevision();
  db.setMeta("last_kv_update", new Date().toISOString());
  res.json({ ok: true, revision, keysWritten: Object.keys(next).length });
});

module.exports = router;
