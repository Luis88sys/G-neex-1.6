/**
 * Punto de enganche con `gneex-hosted-api` (backend opcional, SQLite + JWT).
 *
 * Estado a v1.7 (mayo 2026): la SPA sigue 100 % en localStorage. Este módulo
 * **no inicia tráfico** por sí mismo en ningún flujo de la app: hay que
 * llamarlo explícitamente desde código de usuario / desde una pantalla de
 * configuración. Se diseñó así adrede para mantener compatibilidad con el
 * despliegue estático actual y con la política CSP (`connect-src 'self'`)
 * salvo que el operador cambie deliberadamente la URL base.
 *
 * Contrato resumido (más detalle en `no-deployar/docs/BACKEND_ALINEACION.md`):
 * - `getBaseUrl()` / `setBaseUrl(url)` : persistencia en localStorage.
 * - `isConfigured()`                  : true si hay URL no vacía.
 * - `ping()`                          : GET /api/v1/auth/health, NUNCA lanza.
 * - `login({username, password})`     : POST /api/v1/auth/login, lanza en error.
 * - `fetchSync` / `pushSync` / `importBackup`: placeholders (lanzan).
 */
(() => {
  const LS_KEY = "gneex-api-base-url";
  const DEFAULT_TIMEOUT_MS = 8000;
  const HEALTH_PATH = "/api/v1/auth/health";
  const LOGIN_PATH = "/api/v1/auth/login";

  /**
   * Normaliza la base URL: quita barras finales y valida que parezca una URL
   * absoluta. Si está vacía, devuelve "" (modo offline). Si es inválida, lanza
   * para que el caller (UI) muestre un toast — no queremos persistir basura.
   */
  function _normalizeBaseUrl(raw) {
    const u = String(raw || "").trim();
    if (!u) return "";
    // Aceptamos solo http(s); evita esquemas tipo javascript:, file:, etc.
    if (!/^https?:\/\//i.test(u)) {
      throw new Error("GneexApiClient.setBaseUrl: la URL debe empezar por http:// o https://");
    }
    try {
      // Resolución sintáctica vía URL para detectar URLs malformadas.
      const parsed = new URL(u);
      return parsed.toString().replace(/\/$/, "");
    } catch {
      throw new Error("GneexApiClient.setBaseUrl: URL malformada");
    }
  }

  /** Compose absolute URL para un path relativo del API. */
  function _resolveUrl(base, path) {
    const p = String(path || "");
    if (!base) return p;
    return `${base}${p.startsWith("/") ? p : `/${p}`}`;
  }

  /**
   * fetch con timeout mediante AbortController. No reintenta — la SPA no debe
   * insistir contra un backend caído (ya somos offline-first por diseño).
   */
  async function _fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (typeof fetch !== "function") {
      throw new Error("GneexApiClient: fetch no disponible en este entorno");
    }
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(() => {
          try { ctrl.abort(); } catch { /* noop */ }
        }, Math.max(500, timeoutMs))
      : null;
    try {
      const init = { ...opts };
      if (ctrl) init.signal = ctrl.signal;
      // `credentials: omit` por defecto: el JWT viaja en el header Authorization,
      // no queremos cookies cross-origin sin pedirlas explícitamente.
      if (!("credentials" in init)) init.credentials = "omit";
      if (!("cache" in init)) init.cache = "no-store";
      return await fetch(url, init);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  window.GneexApiClient = {
    /** URL base cuando exista backend (p. ej. https://api.ejemplo/v1). Vacío = solo offline. */
    getBaseUrl() {
      try {
        return String(localStorage.getItem(LS_KEY) || "").trim();
      } catch {
        return "";
      }
    },

    /**
     * Persiste la URL base (o la limpia con falsy). Lanza si la URL no parece
     * válida — esto es intencional para que la UI de configuración muestre un
     * toast inmediato en lugar de fallar más tarde al hacer fetch.
     */
    setBaseUrl(url) {
      try {
        const normalized = _normalizeBaseUrl(url);
        if (!normalized) localStorage.removeItem(LS_KEY);
        else localStorage.setItem(LS_KEY, normalized);
      } catch (err) {
        // Re-lanzamos para el caller; no escribimos basura en localStorage.
        throw err;
      }
    },

    isConfigured() {
      return !!this.getBaseUrl();
    },

    /**
     * Health-check no destructivo. Diseñado para no lanzar nunca: cualquier
     * fallo se traduce a `{ ok: false, error }`. Útil como smoke test desde
     * ⚙️ Configuración sin obligar al caller a hacer try/catch.
     */
    async ping(timeoutMs = DEFAULT_TIMEOUT_MS) {
      const base = this.getBaseUrl();
      if (!base) return { ok: false, status: 0, error: "no-base-url" };
      try {
        const res = await _fetchWithTimeout(_resolveUrl(base, HEALTH_PATH), { method: "GET" }, timeoutMs);
        if (!res.ok) return { ok: false, status: res.status, error: `http-${res.status}` };
        let body = null;
        try { body = await res.json(); } catch { /* health puede devolver texto plano */ }
        return { ok: true, status: res.status, body };
      } catch (err) {
        const msg = err && err.name === "AbortError" ? "timeout" : (err && err.message) || "fetch-failed";
        return { ok: false, status: 0, error: msg };
      }
    },

    /**
     * Login JWT contra `gneex-hosted-api`. A diferencia de `ping`, **sí lanza**
     * si la URL no está configurada o si hay error de red / HTTP — la UI de
     * login debe distinguir entre "no hay backend" y "credenciales malas".
     *
     * Devuelve la respuesta cruda del servidor `{ token, user }`. **No** la
     * persistimos: la decisión de meter el token en sesión queda fuera (en la
     * SPA actual la sesión vive en `Auth.saveSession`).
     */
    async login({ username, password } = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const base = this.getBaseUrl();
      if (!base) throw new Error("GneexApiClient.login: no hay base URL configurada");
      const u = String(username || "").trim();
      const p = String(password || "");
      if (!u || !p) throw new Error("GneexApiClient.login: username y password son obligatorios");
      const res = await _fetchWithTimeout(
        _resolveUrl(base, LOGIN_PATH),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: u, password: p })
        },
        timeoutMs
      );
      if (!res.ok) {
        let detail = "";
        try { detail = (await res.json())?.error || ""; } catch { /* noop */ }
        throw new Error(`GneexApiClient.login: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
      }
      return await res.json();
    },

    /** Reservado: sync con JWT / revisión de datos (no implementado). */
    async fetchSync() {
      throw new Error("GneexApiClient.fetchSync: not implemented (offline client).");
    },

    /** Reservado: push selectivo de claves locales hacia el API. */
    async pushSync(/* payload */) {
      throw new Error("GneexApiClient.pushSync: not implemented (offline client).");
    },

    /** Reservado: subir un respaldo completo G-NEEX al endpoint backup/import. */
    async importBackup(/* jsonObject */) {
      throw new Error("GneexApiClient.importBackup: not implemented (offline client).");
    }
  };
})();
