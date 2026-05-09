/**
 * Punto de enganche futuro para sincronización con `gneex-hosted-api`.
 * Hoy la SPA sigue 100 % en localStorage; no hay llamadas HTTP activas.
 * Ver `no-deployar/docs/BACKEND_ALINEACION.md`.
 */
(() => {
  const LS_KEY = "gneex-api-base-url";

  window.GneexApiClient = {
    /** URL base cuando exista backend (p. ej. https://api.ejemplo/v1). Vacío = solo offline. */
    getBaseUrl() {
      try {
        return String(localStorage.getItem(LS_KEY) || "").trim();
      } catch {
        return "";
      }
    },

    setBaseUrl(url) {
      try {
        const u = String(url || "").trim();
        if (!u) localStorage.removeItem(LS_KEY);
        else localStorage.setItem(LS_KEY, u);
      } catch {
        /* noop */
      }
    },

    isConfigured() {
      return !!this.getBaseUrl();
    },

    /** Reservado: sync con JWT / revisión de datos (no implementado). */
    async fetchSync() {
      throw new Error("GneexApiClient.fetchSync: not implemented (offline client).");
    }
  };
})();
