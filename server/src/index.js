require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const repoRoot = path.join(__dirname, "..", "..");

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
  })
);
app.use(express.json({ limit: "48kb" }));

app.use("/api/auth", authRoutes);

/* Sirve la SPA G-NEEX desde la raíz del repositorio (mismo origen = sin CORS en el cliente). */
app.use(express.static(repoRoot, { index: ["index.html"] }));

app.listen(PORT, () => {
  console.log(`[gneex-api] http://localhost:${PORT}/  (estático: ${repoRoot})`);
  console.log(`[gneex-api] Health: http://localhost:${PORT}/api/auth/health`);
});
