const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const dbPath = process.env.SQLITE_PATH || path.join(dataDir, "gneex-hosted.db");

module.exports = {
  root,
  dataDir,
  dbPath,
  port: Number(process.env.PORT || 3040),
  jwtSecret: process.env.JWT_SECRET || "development-only-change-me",
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS || 7),
  corsOrigin: process.env.CORS_ORIGIN,
  syncWriteRole: (process.env.SYNC_WRITE_ROLE || "admin").toLowerCase(),
  jsonLimit: process.env.JSON_LIMIT || "80mb"
};
