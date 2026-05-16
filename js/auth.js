// auth.js — sesión, usuarios, permisos y registro de auditoría (localStorage)

const Auth = {
  users: [],
  sessionUserId: null,
  MAX_AUDIT: 500,

  /** Duración tras canje por tipo de código (emisión admin → uso en sesión). */
  ELEVATION_TIER_MS: {
    h48: 48 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000
  },

  /** Antigüedad máxima del código emitido (evita réplicas indefinidas). ~2 años. */
  ELEVATION_CODE_MAX_AGE_MS: Math.round(730.5 * 24 * 60 * 60 * 1000),

  /** Clave derivada una vez para HMAC de códigos portables (misma copia del programa en cualquier PC). */
  _elevationHmacKeyPromise: null,

  async _getElevationHmacKey() {
    if (!this._elevationHmacKeyPromise) {
      this._elevationHmacKeyPromise = (async () => {
        const enc = new TextEncoder();
        const raw = enc.encode(
          "g-neex-elevation-hmac-v2|PhoenixCell|portable-signed-codes-same-install"
        );
        const digest = await crypto.subtle.digest("SHA-256", raw);
        return crypto.subtle.importKey(
          "raw",
          digest,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign", "verify"]
        );
      })();
    }
    return this._elevationHmacKeyPromise;
  },

  _b64urlEncode(bytes) {
    let bin = "";
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },

  _b64urlDecode(str) {
    let b64 = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },

  /** Texto tal como lo introduce el usuario (los firmados distinguen mayúsculas/minúsculas en base64url). */
  _trimElevationInput(str) {
    return String(str || "")
      .trim()
      .replace(/\s+/g, "");
  },

  async _createSignedElevationCode(tier, redeemUserId) {
    const n = new Uint8Array(12);
    crypto.getRandomValues(n);
    const nonce = Array.from(n, b => b.toString(16).padStart(2, "0")).join("");
    const payload = { v: 2, tier, uid: redeemUserId, i: Date.now(), n: nonce };
    const msgStr = JSON.stringify(payload);
    const msgBytes = new TextEncoder().encode(msgStr);
    const key = await this._getElevationHmacKey();
    const sigBuf = await crypto.subtle.sign("HMAC", key, msgBytes);
    const msgB64 = this._b64urlEncode(msgBytes);
    const sigB64 = this._b64urlEncode(new Uint8Array(sigBuf));
    const prefix =
      tier === "h48" ? "ELV48" : tier === "week" ? "ELV7D" : tier === "month" ? "ELV30" : "ELVX";
    return `${prefix}-${msgB64}.${sigB64}`;
  },

  /**
   * Devuelve payload si firma OK; si no es código firmado o es inválido, null.
   */
  async _tryVerifySignedElevation(trimmed) {
    const dash = trimmed.indexOf("-");
    if (dash < 1) return null;
    const prefix = trimmed.slice(0, dash);
    const tierFromPrefix = { ELV48: "h48", ELV7D: "week", ELV30: "month" };
    const tierKey = tierFromPrefix[prefix];
    if (!tierKey) return null;
    const rest = trimmed.slice(dash + 1);
    const dot = rest.lastIndexOf(".");
    if (dot < 1) return null;
    const msgB64 = rest.slice(0, dot);
    const sigB64 = rest.slice(dot + 1);
    if (!msgB64 || !sigB64) return null;
    let msgBytes;
    let sigBytes;
    try {
      msgBytes = this._b64urlDecode(msgB64);
      sigBytes = this._b64urlDecode(sigB64);
    } catch (e) {
      return null;
    }
    try {
      const key = await this._getElevationHmacKey();
      const ok = await crypto.subtle.verify("HMAC", key, sigBytes, msgBytes);
      if (!ok) return null;
      const payload = JSON.parse(new TextDecoder().decode(msgBytes));
      if (!payload || payload.v !== 2 || payload.tier !== tierKey || !payload.uid) return null;
      if (typeof payload.i !== "number") return null;
      return payload;
    } catch (e) {
      return null;
    }
  },

  PERMISSIONS: [
    "editItems",
    "movements",
    "transport",
    "receptions",
    /** Recordatorios (admin, Keith y Alex integrados; asignable en usuarios personalizados). */
    "reminders",
    /** Crear/editar líneas de pedidos a proveedor (no solo lectura). */
    "orderLinesEdit",
    /** Exportar archivo JSON solo movimientos (Keith/Alex integrados). */
    "movementsExport",
    /** Cargar inventario inicial CSV/XLSX. */
    "loadInventoryCsv",
    /** Umbral de caducidad + pestaña Expiraciones (Keith integrado). */
    "expirationConfig"
  ],

  /** Permisos por recurso: none = oculto, view = ver sin mutar, edit = uso completo (según pantalla). */
  MATRIX_KEYS: [
    "tabDashboard",
    "tabReminders",
    "tabInventory",
    "tabMovements",
    "tabHistory",
    "tabTransport",
    "tabOrderlines",
    "inventoryEdit",
    "movementsExport",
    "loadInventoryCsv",
    "expirationConfig",
    "receptionsEdit",
    "orderLinesEdit",
    "dashboardAlerts"
  ],

  MATRIX_LEVELS: ["none", "view", "edit"],

  /**
   * Permisos finos — pestaña Configuración. Orden estable para UI y migraciones.
   * Roadmap: Inventario → Panel → Movimientos → Historial → Recordatorios (claves por prefijo).
   */
  CONFIG_ACTION_KEYS: [
    "cfgModalOpen",
    "cfgTabImport",
    "cfgTabExpirations",
    "cfgTabReceptions",
    "cfgTabEmployees",
    "cfgTabSuppliers",
    "cfgTabConsumables",
    "cfgTabTransCompanies",
    "cfgTabMeasureUnits",
    "cfgTabItemEdit",
    "cfgTabUsers",
    "cfgTabElevation",
    "cfgTabAbout",
    "cfgActImportInventory",
    "cfgActExportTemplate",
    "cfgActArchive",
    "cfgActReimportArchive",
    "cfgActBackupExport",
    "cfgActBackupImport",
    "cfgActMovementsExport",
    "cfgActMovementsMerge",
    "cfgActTransportsExport",
    "cfgActTransportsMerge",
    "cfgActWipeDb",
    "cfgActRecipientsPreview"
  ],

  /**
   * Permisos finos — pestaña Pedidos a proveedor (órdenes de compra).
   * Sin solapamiento con `cfg*`: misma matriz `permissionActionMatrix`.
   */
  ORDER_ACTION_KEYS: [
    "ordSuggestions",
    "ordFormNewLine",
    "ordExportXlsx",
    "ordPrint",
    "ordPurgeOld",
    "ordFilters",
    "ordLineMutations",
    "ordBatchReceive"
  ],

  /**
   * Acciones finas por zonas del resto de pestañas (`data-auth-act`).
   * Derivadas por defecto de la matriz de pestañas (tabInventory, tabDashboard, …).
   */
  TAB_FEATURE_ACTION_KEYS: [
    "invBrowse",
    "invTools",
    "invDangerClearExpiry",
    "dashHero",
    "dashOverview",
    "dashToday",
    "movPicker",
    "movRecent",
    "movAnnul",
    "movType_AJUSTE",
    "movType_CONSUMO_DIARIO",
    "movType_FERRETERIA",
    "movType_ESPECIAL",
    "movType_LISTA_CHEQUEO",
    "movType_MERMA",
    "movType_RETORNO",
    "movType_DESMANTELAR",
    "movType_TRANSFERENCIA",
    "movType_TRANSFORMACION",
    "movType_ENVIAR_PRODUCCION",
    "movType_MAT_ELEC_PROD",
    "movType_MAT_ELEC_OBRA",
    "movType_VENTA_DIRECTA",
    "movType_EXPEDICION_STOCK",
    "movType_COMPRA_STOCK",
    "movType_RECEPCION_MATERIAL",
    "movType_STANDBY",
    "histExports",
    "histFilters",
    "histLedger",
    "histResults",
    "remPanel",
    "trnToolbar",
    "trnMain"
  ],

  /**
   * Subfunciones agrupadas por pestaña principal (modal permisos detallados).
   * Debe contener las mismas claves que {@link TAB_FEATURE_ACTION_KEYS}.
   */
  TAB_FEATURE_MATRIX_SECTIONS: [
    { titleKey: "auth.matrixSectionInventoryFeat", keys: ["invBrowse", "invTools", "invDangerClearExpiry"] },
    { titleKey: "auth.matrixSectionDashboardFeat", keys: ["dashHero", "dashOverview", "dashToday"] },
    { titleKey: "auth.matrixSectionMovementsFeat", keys: ["movPicker", "movRecent", "movAnnul"] },
    {
      titleKey: "auth.matrixSectionMovementsTypes",
      keys: [
        "movType_AJUSTE",
        "movType_CONSUMO_DIARIO",
        "movType_FERRETERIA",
        "movType_ESPECIAL",
        "movType_LISTA_CHEQUEO",
        "movType_MERMA",
        "movType_RETORNO",
        "movType_DESMANTELAR",
        "movType_TRANSFERENCIA",
        "movType_TRANSFORMACION",
        "movType_ENVIAR_PRODUCCION",
        "movType_MAT_ELEC_PROD",
        "movType_MAT_ELEC_OBRA",
        "movType_VENTA_DIRECTA",
        "movType_EXPEDICION_STOCK",
        "movType_COMPRA_STOCK",
        "movType_RECEPCION_MATERIAL",
        "movType_STANDBY"
      ]
    },
    { titleKey: "auth.matrixSectionHistoryFeat", keys: ["histExports", "histFilters", "histLedger", "histResults"] },
    { titleKey: "auth.matrixSectionRemindersFeat", keys: ["remPanel"] },
    { titleKey: "auth.matrixSectionTransportFeat", keys: ["trnToolbar", "trnMain"] }
  ],

  /** data-config-tab → clave de acción para pestañas del modal de configuración. */
  CONFIG_TAB_TO_ACTION: {
    import: "cfgTabImport",
    expirations: "cfgTabExpirations",
    receptions: "cfgTabReceptions",
    employees: "cfgTabEmployees",
    suppliers: "cfgTabSuppliers",
    consumables: "cfgTabConsumables",
    transcompanies: "cfgTabTransCompanies",
    measureunits: "cfgTabMeasureUnits",
    itemedit: "cfgTabItemEdit",
    users: "cfgTabUsers",
    elevation: "cfgTabElevation",
    about: "cfgTabAbout"
  },

  _defaultConfigActionLevelFromMatrix(mx, key, userLike) {
    const L = k => mx[k] || "none";
    const admin = !!(userLike && userLike.role === "admin");
    const tm = L("tabMovements");
    const adm = () => (admin ? "edit" : "none");
    switch (key) {
      case "cfgModalOpen":
      case "cfgTabAbout":
        return "edit";
      case "cfgTabImport":
        if (L("loadInventoryCsv") !== "none" || L("movementsExport") !== "none" || tm !== "none") return "edit";
        return "view";
      case "cfgTabExpirations":
        return L("expirationConfig");
      case "cfgTabReceptions":
        return L("receptionsEdit");
      case "cfgTabEmployees":
      case "cfgTabSuppliers":
      case "cfgTabConsumables":
      case "cfgTabTransCompanies":
      case "cfgTabMeasureUnits":
        return tm;
      case "cfgTabItemEdit":
        return L("inventoryEdit");
      case "cfgTabUsers":
      case "cfgTabElevation":
      case "cfgActWipeDb":
      case "cfgActRecipientsPreview":
        return adm();
      case "cfgActImportInventory":
        return L("loadInventoryCsv");
      case "cfgActExportTemplate":
        if (L("tabInventory") === "none") return "none";
        if (L("tabInventory") === "view") return "view";
        return "edit";
      case "cfgActArchive":
      case "cfgActReimportArchive":
        return tm;
      case "cfgActBackupExport":
        if (admin) return "edit";
        return tm !== "none" || L("movementsExport") !== "none" ? "edit" : "view";
      case "cfgActBackupImport":
        return "edit";
      case "cfgActMovementsExport":
      case "cfgActMovementsMerge":
      case "cfgActTransportsExport":
      case "cfgActTransportsMerge":
        return L("movementsExport");
      default:
        return "none";
    }
  },

  _defaultOrderActionLevelFromMatrix(mx, key, userLike) {
    const L = k => mx[k] || "none";
    const tabO = L("tabOrderlines");
    const orderEdit = L("orderLinesEdit");
    const mov = L("tabMovements");
    const movEx = L("movementsExport");
    switch (key) {
      case "ordSuggestions":
        return tabO === "none" ? "none" : "view";
      case "ordFormNewLine":
      case "ordLineMutations":
      case "ordPurgeOld":
        return orderEdit;
      case "ordExportXlsx":
        if (tabO === "none") return "none";
        if (movEx === "edit" || movEx === "view") return movEx;
        return "none";
      case "ordPrint":
      case "ordFilters":
        return tabO === "none" ? "none" : "view";
      case "ordBatchReceive":
        if (orderEdit === "edit" && mov !== "none") return "edit";
        return "none";
      default:
        return "none";
    }
  },

  _normalizeFineActionMatrix(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    const keys = [...this.CONFIG_ACTION_KEYS, ...this.ORDER_ACTION_KEYS, ...this.TAB_FEATURE_ACTION_KEYS];
    for (const key of keys) {
      const v = raw[key];
      if (v === "none" || v === "view" || v === "edit") out[key] = v;
    }
    return out;
  },

  _normalizePermissionActionMatrix(raw) {
    return this._normalizeFineActionMatrix(raw);
  },

  /** Matriz de acciones efectiva para un usuario (defaults + overrides guardados). */
  getEffectivePermissionActionMatrix(userLike) {
    const mx = this.getUserPermissionMatrix(userLike);
    const raw =
      userLike && userLike.permissionActionMatrix && typeof userLike.permissionActionMatrix === "object"
        ? userLike.permissionActionMatrix
        : {};
    const out = {};
    for (const key of this.CONFIG_ACTION_KEYS) {
      const v = raw[key];
      if (v === "none" || v === "view" || v === "edit") out[key] = v;
      else out[key] = this._defaultConfigActionLevelFromMatrix(mx, key, userLike);
    }
    for (const key of this.ORDER_ACTION_KEYS) {
      const v = raw[key];
      if (v === "none" || v === "view" || v === "edit") out[key] = v;
      else out[key] = this._defaultOrderActionLevelFromMatrix(mx, key, userLike);
      out[key] = this._capFineActionLevelToParentTab(out[key], key, mx);
    }
    for (const key of this.TAB_FEATURE_ACTION_KEYS) {
      const v = raw[key];
      if (v === "none" || v === "view" || v === "edit") out[key] = v;
      else out[key] = this._defaultTabFeatureActionLevelFromMatrix(mx, key, userLike);
      out[key] = this._capFineActionLevelToParentTab(out[key], key, mx);
    }
    return out;
  },

  /**
   * Pestaña principal (clave en MATRIX_KEYS) que limita pedidos / zonas UI.
   */
  _parentTabMatrixKeyForAction(key) {
    if (!key || typeof key !== "string") return null;
    if (this.ORDER_ACTION_KEYS.includes(key)) return "tabOrderlines";
    if (key.startsWith("inv")) return "tabInventory";
    if (key.startsWith("dash")) return "tabDashboard";
    if (key.startsWith("mov")) return "tabMovements";
    if (key.startsWith("hist")) return "tabHistory";
    if (key.startsWith("rem")) return "tabReminders";
    if (key.startsWith("trn")) return "tabTransport";
    return null;
  },

  /**
   * Pedidos y zonas de pestaña no pueden superar su pestaña (none → todo none; view → máx. view).
   */
  _capFineActionLevelToParentTab(lvl, key, mx) {
    const parentKey = this._parentTabMatrixKeyForAction(key);
    if (!parentKey) return lvl;
    const p = mx[parentKey] || "none";
    const order = { none: 0, view: 1, edit: 2 };
    if (p === "none") return "none";
    if (p === "view") {
      return order[lvl] > order.view ? "view" : lvl;
    }
    return lvl;
  },

  /**
   * Nivel efectivo para claves `cfg*`, `ord*` y acciones por zona de pestaña (`inv*`, `dash*`, …).
   * `getSessionConfigActionLevel` es alias histórico (mismas claves).
   */
  getSessionActionLevel(key) {
    if (!key) return "none";
    const allowed = new Set([
      ...this.CONFIG_ACTION_KEYS,
      ...this.ORDER_ACTION_KEYS,
      ...this.TAB_FEATURE_ACTION_KEYS
    ]);
    if (!allowed.has(key)) return "none";
    /** Herramienta retirada para todos los roles (incl. administrador): borrar datos de caducidad en inventario. */
    if (key === "invDangerClearExpiry") return "none";
    if (this.isAdmin()) return "edit";
    const u = this.getCurrentUser();
    if (!u) return "none";
    /** Importar respaldo JSON completo: mismo derecho para todos los usuarios con sesión (no administrador exclusivo). */
    if (key === "cfgActBackupImport") return "edit";
    const mx = this.getSessionMatrix();
    const raw = u.permissionActionMatrix && u.permissionActionMatrix[key];
    let lvl;
    if (raw === "none" || raw === "view" || raw === "edit") {
      lvl = raw;
    } else if (this.CONFIG_ACTION_KEYS.includes(key)) {
      lvl = this._defaultConfigActionLevelFromMatrix(mx, key, u);
    } else if (this.ORDER_ACTION_KEYS.includes(key)) {
      lvl = this._defaultOrderActionLevelFromMatrix(mx, key, u);
    } else {
      lvl = this._defaultTabFeatureActionLevelFromMatrix(mx, key, u);
    }
    if (this.ORDER_ACTION_KEYS.includes(key) || this.TAB_FEATURE_ACTION_KEYS.includes(key)) {
      lvl = this._capFineActionLevelToParentTab(lvl, key, mx);
    }
    if (this.isElevated() && lvl === "none" && key !== "invDangerClearExpiry") lvl = "view";
    if (key === "movRecent" && this.historyMaterialReceptionOnly()) lvl = "none";
    return lvl;
  },

  _defaultTabFeatureActionLevelFromMatrix(mx, key) {
    const L = k => mx[k] || "none";
    const tabInv = L("tabInventory");
    const tabDash = L("tabDashboard");
    const tabMov = L("tabMovements");
    const tabHist = L("tabHistory");
    const tabRem = L("tabReminders");
    const tabTrn = L("tabTransport");
    switch (key) {
      case "invBrowse":
        return tabInv === "none" ? "none" : "view";
      case "invTools":
        if (tabInv === "none") return "none";
        if (tabInv === "edit") return "edit";
        return "view";
      case "invDangerClearExpiry":
        // Herramienta peligrosa: por defecto solo admin.
        // Otros usuarios la reciben únicamente por concesión manual.
        return "none";
      case "dashHero":
      case "dashOverview":
      case "dashToday":
        return tabDash === "none" ? "none" : "view";
      case "movPicker":
        return tabMov;
      case "movRecent":
        return tabMov === "none" ? "none" : "view";
      case "movAnnul":
        return tabMov;
      case "histExports":
      case "histFilters":
      case "histLedger":
      case "histResults":
        return tabHist === "none" ? "none" : "view";
      case "remPanel":
        return tabRem;
      case "trnToolbar":
      case "trnMain":
        if (tabTrn === "none") return "none";
        if (tabTrn === "edit") return "edit";
        return "view";
      default:
        if (String(key || "").startsWith("movType_")) return tabMov;
        return "none";
    }
  },

  _movementTypeActionKey(type) {
    const t = String(type || "").trim().toUpperCase();
    return t ? `movType_${t}` : "";
  },

  hasMovementTypeProcess(type) {
    const key = this._movementTypeActionKey(type);
    if (!key) return false;
    return this._fineActionMeets(key, "edit");
  },

  guardMovementTypeProcess(type) {
    const key = this._movementTypeActionKey(type);
    if (!key) {
      this.denyEditToast();
      return false;
    }
    if (!this._fineActionMeets(key, "edit")) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  hasMovementAnnul() {
    return this._fineActionMeets("movAnnul", "edit");
  },

  guardMovementAnnul() {
    if (!this.hasMovementAnnul()) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  getSessionConfigActionLevel(key) {
    return this.getSessionActionLevel(key);
  },

  _fineActionMeets(key, minLevel) {
    const order = { none: 0, view: 1, edit: 2 };
    const lvl = this.getSessionActionLevel(key);
    return order[lvl] >= order[minLevel];
  },

  /** Comprueba una acción de configuración (none &lt; view &lt; edit). */
  guardConfigAction(key, minLevel = "edit") {
    return this.guardFineAction(key, minLevel);
  },

  /** Acciones finas (`cfg*`, `ord*`, `inv*`, `dash*`, …) con `data-auth-act`. */
  guardFineAction(key, minLevel = "edit") {
    if (!this.getCurrentUser()) {
      this.denyEditToast();
      return false;
    }
    if (!this._fineActionMeets(key, minLevel)) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  /**
   * Sincroniza visibilidad y estado de controles con `data-auth-act` / `data-auth-act-level`
   * (Configuración, Pedidos y zonas del resto de pestañas). `data-auth-act-level` por defecto «edit».
   */
  syncConfigActionDomState() {
    try {
      document.querySelectorAll("[data-auth-act]").forEach(el => {
        const key = el.getAttribute("data-auth-act");
        const need = el.getAttribute("data-auth-act-level") || "edit";
        const lvl = this.getSessionActionLevel(key);
        const order = { none: 0, view: 1, edit: 2 };
        if (lvl === "none") {
          el.hidden = true;
          return;
        }
        el.hidden = false;
        const allowed = order[lvl] >= order[need];
        if (el.matches("button, input, select, textarea")) {
          el.disabled = !allowed;
        } else {
          el.style.opacity = allowed ? "" : "0.45";
          el.style.pointerEvents = allowed ? "" : "none";
        }
      });
    } catch (e) {
      console.warn("syncConfigActionDomState", e);
    }
  },

  /** Matriz por defecto «solo panel» (todo oculto salvo dashboard vacío). */
  defaultPermissionMatrix() {
    const m = {};
    this.MATRIX_KEYS.forEach(k => {
      m[k] = k === "tabDashboard" ? "edit" : "none";
    });
    return m;
  },

  _emptyActionMatrix() {
    const out = {};
    [...this.CONFIG_ACTION_KEYS, ...this.ORDER_ACTION_KEYS, ...this.TAB_FEATURE_ACTION_KEYS].forEach(k => {
      out[k] = "none";
    });
    return out;
  },

  /**
   * Convierte un payload de cuenta integrada (matriz + acciones) al formato de plantilla
   * que usan `addUser` y `updateUserProfile` (rol usuario + matrices normalizadas).
   */
  _personaTemplateFromBuiltinPayload(p) {
    if (!p || !p.permissionMatrix) return null;
    return {
      role: "user",
      canEdit: !!p.canEdit,
      permissionMatrix: p.permissionMatrix,
      permissionActionMatrix: p.permissionActionMatrix
    };
  },

  _buildUserTemplatePayload(templateKey) {
    const key = String(templateKey || "").trim();
    if (!key) return null;

    const personaMap = {
      perfil_keith_lake: () => this._keithSupervisorLikeBuiltinPayload(),
      perfil_alex_beaulieu: () => this._keithSupervisorLikeBuiltinPayload(),
      perfil_guest_demo: () => this._guestReadonlyConsultanteBuiltinPayload(),
      perfil_patrick: () => this._patrickInventoryLeadBuiltinPayload(),
      perfil_stephane_demers: () => this._stephaneReadonlyConsultanteBuiltinPayload(),
      perfil_wen_deng: () => this._wenBuyerBuiltinPayload(),
      perfil_barbara_bonny: () => this._barbaraTransportLeadBuiltinPayload(),
      perfil_annie_larose: () => this._annieTeamCmcBuiltinPayload()
    };
    if (Object.prototype.hasOwnProperty.call(personaMap, key)) {
      return this._personaTemplateFromBuiltinPayload(personaMap[key].call(this));
    }

    const matrix = this.defaultPermissionMatrix();
    Object.keys(matrix).forEach(k => {
      matrix[k] = "none";
    });
    const actions = this._emptyActionMatrix();
    const setTab = (k, lvl = "view") => {
      if (k in matrix) matrix[k] = lvl;
    };
    const setMx = (k, lvl = "view") => {
      if (k in matrix) matrix[k] = lvl;
    };
    const setAct = (k, lvl = "view") => {
      if (k in actions) actions[k] = lvl;
    };
    const allowMovementType = t => setAct(`movType_${String(t || "").trim().toUpperCase()}`, "edit");

    setAct("cfgModalOpen", "view");
    setAct("cfgTabAbout", "view");

    if (key === "operario_picker") {
      setTab("tabInventory", "view");
      setTab("tabMovements", "edit");
      setTab("tabHistory", "view");
      setAct("invBrowse", "view");
      setAct("movPicker", "edit");
      setAct("movRecent", "view");
      ["CONSUMO_DIARIO", "AJUSTE", "TRANSFERENCIA", "STANDBY", "MERMA", "RETORNO"].forEach(allowMovementType);
    } else if (key === "operario_recepcion") {
      setTab("tabMovements", "edit");
      setTab("tabHistory", "view");
      setMx("receptionsEdit", "edit");
      setAct("cfgModalOpen", "edit");
      setAct("cfgTabReceptions", "edit");
      setAct("movPicker", "edit");
      allowMovementType("RECEPCION_MATERIAL");
      allowMovementType("MAT_ELEC_OBRA");
      allowMovementType("LISTA_CHEQUEO");
    } else if (key === "operario_produccion") {
      setTab("tabMovements", "edit");
      setTab("tabHistory", "view");
      setAct("movPicker", "edit");
      setAct("movRecent", "view");
      ["ENVIAR_PRODUCCION", "MAT_ELEC_PROD", "TRANSFORMACION", "DESMANTELAR", "LISTA_CHEQUEO", "STANDBY"].forEach(
        allowMovementType
      );
    } else if (key === "operario_transporte") {
      setTab("tabTransport", "edit");
      setTab("tabHistory", "view");
      setAct("trnToolbar", "edit");
      setAct("trnMain", "edit");
      setAct("histResults", "view");
    } else if (key === "supervisor") {
      setTab("tabDashboard", "edit");
      setTab("tabReminders", "edit");
      setTab("tabInventory", "edit");
      setTab("tabMovements", "edit");
      setTab("tabHistory", "edit");
      setTab("tabTransport", "edit");
      setTab("tabOrderlines", "edit");
      setMx("inventoryEdit", "edit");
      setMx("receptionsEdit", "edit");
      setMx("orderLinesEdit", "edit");
      setMx("movementsExport", "edit");
      setMx("dashboardAlerts", "edit");
      setAct("movPicker", "edit");
      setAct("movRecent", "view");
      setAct("dashHero", "edit");
      setAct("dashOverview", "edit");
      setAct("dashToday", "edit");
      setAct("remPanel", "edit");
      setAct("cfgModalOpen", "edit");
      setAct("cfgTabImport", "edit");
      setAct("cfgTabReceptions", "edit");
      setAct("cfgActExportTemplate", "edit");
      setAct("cfgActMovementsExport", "edit");
      setAct("cfgActTransportsExport", "edit");
      setAct("cfgActBackupExport", "edit");
      setAct("movAnnul", "edit");
      this.TAB_FEATURE_ACTION_KEYS
        .filter(k => String(k).startsWith("movType_"))
        .forEach(k => setAct(k, "edit"));
    } else if (key === "operario_pedidos") {
      setTab("tabDashboard", "view");
      setTab("tabOrderlines", "edit");
      setTab("tabMovements", "edit");
      setTab("tabInventory", "view");
      setAct("dashOverview", "view");
      setMx("dashboardAlerts", "view");
      ["ordSuggestions", "ordFormNewLine", "ordLineMutations", "ordBatchReceive", "ordFilters", "ordPrint"].forEach(k =>
        setAct(k, "edit")
      );
      setAct("movPicker", "edit");
      allowMovementType("COMPRA_STOCK");
    } else if (key === "operario_recepcion_expedicion") {
      setTab("tabMovements", "edit");
      setTab("tabTransport", "edit");
      setTab("tabHistory", "view");
      setMx("receptionsEdit", "edit");
      setAct("cfgModalOpen", "edit");
      setAct("cfgTabReceptions", "edit");
      setAct("trnToolbar", "edit");
      setAct("trnMain", "edit");
      setAct("movPicker", "edit");
      ["RECEPCION_MATERIAL", "MAT_ELEC_OBRA", "MAT_ELEC_PROD", "LISTA_CHEQUEO"].forEach(allowMovementType);
    } else if (key === "operario_consultante") {
      setTab("tabDashboard", "view");
      setTab("tabReminders", "view");
      setTab("tabInventory", "view");
      setTab("tabMovements", "view");
      setTab("tabHistory", "view");
      setTab("tabTransport", "view");
      setTab("tabOrderlines", "view");
      [
        "invBrowse",
        "invTools",
        "dashHero",
        "dashOverview",
        "dashToday",
        "movRecent",
        "histExports",
        "histFilters",
        "histLedger",
        "histResults",
        "remPanel",
        "trnToolbar",
        "trnMain",
        "ordSuggestions",
        "ordFilters",
        "ordPrint",
        "cfgTabImport",
        "cfgTabReceptions"
      ].forEach(k => setAct(k, "view"));
      setAct("cfgActBackupExport", "view");
      setMx("dashboardAlerts", "view");
    } else {
      return null;
    }

    return {
      role: "user",
      canEdit: true,
      permissionMatrix: this._normalizePermissionMatrix(matrix),
      permissionActionMatrix: this._normalizePermissionActionMatrix(actions)
    };
  },

  /**
   * Keith: plantilla «supervisor» sin gestión de usuarios ni códigos de elevación, sin wipe BD
   * ni vista previa masiva de destinatarios (resto operativo en edición). Importar respaldo JSON: igual que el resto de cuentas.
   */
  _keithSupervisorLikeBuiltinPayload() {
    const base = this._buildUserTemplatePayload("supervisor");
    if (!base) return null;
    const mx = { ...base.permissionMatrix };
    mx.expirationConfig = "view";
    const act = { ...base.permissionActionMatrix };
    ["cfgTabUsers", "cfgTabElevation", "cfgActWipeDb", "cfgActRecipientsPreview"].forEach(k => {
      act[k] = "none";
    });
    act.invBrowse = "edit";
    act.invTools = "edit";
    const out = {
      ...base,
      permissionMatrix: this._normalizePermissionMatrix(mx),
      permissionActionMatrix: this._normalizePermissionActionMatrix(act)
    };
    out.permissions = this.deriveLegacyPermissionsFromMatrix(out.permissionMatrix);
    out.canEdit = this.PERMISSIONS.some(pk => out.permissions[pk]);
    return out;
  },

  /**
   * Guest: modo presentación — mismas zonas que un consultante (pestañas y panel visibles en vista),
   * sin ejecutar movimientos ni mutar datos; administración peligrosa oculta (usuarios, elevación, wipe, respaldos masivos, etc.).
   */
  _guestReadonlyConsultanteBuiltinPayload() {
    const base = this._buildUserTemplatePayload("operario_consultante");
    if (!base) return null;
    const mx = { ...base.permissionMatrix };
    mx.tabDashboard = "view";
    mx.tabReminders = "view";
    mx.tabInventory = "view";
    mx.tabMovements = "view";
    mx.tabHistory = "view";
    mx.tabTransport = "view";
    mx.tabOrderlines = "view";
    mx.receptionsEdit = "view";
    mx.expirationConfig = "view";
    mx.dashboardAlerts = "none";
    mx.inventoryEdit = "none";
    mx.loadInventoryCsv = "none";
    mx.movementsExport = "none";
    mx.orderLinesEdit = "none";

    const act = { ...base.permissionActionMatrix };
    this.TAB_FEATURE_ACTION_KEYS.filter(k => String(k).startsWith("movType_")).forEach(k => {
      act[k] = "view";
    });
    act.movPicker = "view";
    act.movRecent = "view";
    act.movAnnul = "none";
    act.invBrowse = "view";
    act.invTools = "view";
    act.invDangerClearExpiry = "none";
    act.dashHero = "view";
    act.dashOverview = "view";
    act.dashToday = "view";
    act.remPanel = "view";
    act.histExports = "view";
    act.histFilters = "view";
    act.histLedger = "view";
    act.histResults = "view";
    act.trnToolbar = "view";
    act.trnMain = "view";
    act.ordSuggestions = "view";
    act.ordFilters = "view";
    act.ordPrint = "view";
    act.ordFormNewLine = "none";
    act.ordLineMutations = "none";
    act.ordBatchReceive = "none";
    act.ordPurgeOld = "none";
    act.ordExportXlsx = "none";

    act.cfgModalOpen = "view";
    act.cfgTabAbout = "view";
    act.cfgTabImport = "view";
    act.cfgTabExpirations = "view";
    act.cfgTabReceptions = "view";
    act.cfgTabEmployees = "view";
    act.cfgTabSuppliers = "view";
    act.cfgTabConsumables = "view";
    act.cfgTabTransCompanies = "view";
    act.cfgTabMeasureUnits = "view";
    act.cfgActExportTemplate = "view";
    act.cfgActMovementsExport = "view";
    act.cfgActTransportsExport = "view";

    act.cfgTabUsers = "none";
    act.cfgTabElevation = "none";
    act.cfgTabItemEdit = "none";
    act.cfgActImportInventory = "none";
    act.cfgActArchive = "none";
    act.cfgActReimportArchive = "none";
    act.cfgActBackupExport = "none";
    act.cfgActBackupImport = "none";
    act.cfgActMovementsMerge = "none";
    act.cfgActTransportsMerge = "none";
    act.cfgActWipeDb = "none";
    act.cfgActRecipientsPreview = "none";

    const out = {
      ...base,
      permissionMatrix: this._normalizePermissionMatrix(mx),
      permissionActionMatrix: this._normalizePermissionActionMatrix(act)
    };
    out.permissions = this.deriveLegacyPermissionsFromMatrix(out.permissionMatrix);
    out.canEdit = false;
    return out;
  },

  /**
   * Stephane — presentación sin movimientos, transporte, pedidos ni recepciones (pestañas ocultas).
   * Config → Import/Export: solo respaldo completo JSON (import/export); el resto de acciones de esa pestaña ocultas.
   */
  _stephaneReadonlyConsultanteBuiltinPayload() {
    const base = this._guestReadonlyConsultanteBuiltinPayload();
    if (!base) return null;
    const mx = { ...base.permissionMatrix };
    mx.tabMovements = "none";
    mx.tabTransport = "none";
    mx.tabOrderlines = "none";
    mx.receptionsEdit = "none";

    const act = { ...base.permissionActionMatrix };
    this.TAB_FEATURE_ACTION_KEYS.filter(k => String(k).startsWith("movType_")).forEach(k => {
      act[k] = "none";
    });
    act.movPicker = "none";
    act.movRecent = "none";
    act.trnToolbar = "none";
    act.trnMain = "none";
    this.ORDER_ACTION_KEYS.forEach(k => {
      act[k] = "none";
    });

    act.cfgTabReceptions = "none";
    act.cfgActBackupExport = "edit";
    act.cfgActBackupImport = "edit";
    act.cfgActImportInventory = "none";
    act.cfgActExportTemplate = "none";
    act.cfgActArchive = "none";
    act.cfgActReimportArchive = "none";
    act.cfgActMovementsExport = "none";
    act.cfgActMovementsMerge = "none";
    act.cfgActTransportsExport = "none";
    act.cfgActTransportsMerge = "none";

    act.invDangerClearExpiry = "none";

    const out = {
      ...base,
      permissionMatrix: this._normalizePermissionMatrix(mx),
      permissionActionMatrix: this._normalizePermissionActionMatrix(act)
    };
    out.permissions = this.deriveLegacyPermissionsFromMatrix(out.permissionMatrix);
    out.canEdit = false;
    return out;
  },

  /**
   * Barbara — solo pestañas Transporte y Recepciones; exportar recepciones (Config → Recepciones).
   * Sin panel, recordatorios, inventario, pedidos, movimientos ni historial.
   */
  _barbaraTransportLeadBuiltinPayload() {
    const base = this._buildUserTemplatePayload("operario_recepcion_expedicion");
    if (!base) return null;
    const mx = { ...base.permissionMatrix };
    mx.tabDashboard = "none";
    mx.tabReminders = "none";
    mx.tabInventory = "none";
    mx.inventoryEdit = "none";
    mx.tabMovements = "none";
    mx.tabHistory = "none";
    mx.tabTransport = "edit";
    mx.tabOrderlines = "none";
    mx.orderLinesEdit = "none";
    mx.dashboardAlerts = "none";
    mx.expirationConfig = "none";
    mx.movementsExport = "none";
    mx.loadInventoryCsv = "none";
    mx.receptionsEdit = "edit";

    const act = { ...base.permissionActionMatrix };
    act.dashHero = "none";
    act.dashOverview = "none";
    act.dashToday = "none";
    act.remPanel = "none";
    act.histExports = "none";
    act.histFilters = "none";
    act.histLedger = "none";
    act.histResults = "none";
    act.movPicker = "none";
    act.movRecent = "none";
    act.movAnnul = "none";
    this.TAB_FEATURE_ACTION_KEYS.filter(k => String(k).startsWith("movType_")).forEach(k => {
      act[k] = "none";
    });
    this.ORDER_ACTION_KEYS.forEach(k => {
      act[k] = "none";
    });

    act.cfgModalOpen = "edit";
    act.cfgTabReceptions = "edit";
    act.trnToolbar = "edit";
    act.trnMain = "edit";

    [
      "cfgTabUsers",
      "cfgTabElevation",
      "cfgTabImport",
      "cfgTabExpirations",
      "cfgTabEmployees",
      "cfgTabSuppliers",
      "cfgTabConsumables",
      "cfgTabTransCompanies",
      "cfgTabMeasureUnits",
      "cfgTabItemEdit",
      "cfgActWipeDb",
      "cfgActRecipientsPreview",
      "cfgActBackupExport",
      "cfgActImportInventory",
      "cfgActExportTemplate",
      "cfgActArchive",
      "cfgActReimportArchive",
      "cfgActMovementsExport",
      "cfgActMovementsMerge"
    ].forEach(k => {
      act[k] = "none";
    });

    const out = {
      ...base,
      permissionMatrix: this._normalizePermissionMatrix(mx),
      permissionActionMatrix: this._normalizePermissionActionMatrix(act)
    };
    out.permissions = this.deriveLegacyPermissionsFromMatrix(out.permissionMatrix);
    out.canEdit = this.PERMISSIONS.some(pk => out.permissions[pk]);
    return out;
  },

  /**
   * Wen — comprador: inventario y pedidos a proveedor (completo); caducidades; sin panel, recordatorios,
   * movimientos, historial, transporte ni recepciones (pestañas y acciones acordes).
   */
  _wenBuyerBuiltinPayload() {
    const base = this._buildUserTemplatePayload("operario_pedidos");
    if (!base) return null;
    const mx = { ...base.permissionMatrix };
    mx.tabTransport = "none";
    mx.tabDashboard = "none";
    mx.tabReminders = "none";
    mx.tabMovements = "none";
    mx.tabHistory = "none";
    mx.receptionsEdit = "none";
    mx.dashboardAlerts = "none";
    mx.expirationConfig = "edit";
    mx.tabOrderlines = "edit";
    mx.orderLinesEdit = "edit";

    const act = { ...base.permissionActionMatrix };
    ["cfgTabUsers", "cfgTabElevation", "cfgActWipeDb", "cfgActRecipientsPreview"].forEach(k => {
      act[k] = "none";
    });
    act.cfgTabExpirations = "edit";
    act.cfgTabReceptions = "none";
    act.cfgActExportTemplate = "edit";
    act.trnToolbar = "none";
    act.trnMain = "none";

    act.dashHero = "none";
    act.dashOverview = "none";
    act.dashToday = "none";
    act.remPanel = "none";

    this.TAB_FEATURE_ACTION_KEYS.filter(k => String(k).startsWith("movType_")).forEach(k => {
      act[k] = "none";
    });
    act.movPicker = "none";
    act.movRecent = "none";
    act.movAnnul = "none";
    act.histExports = "none";
    act.histFilters = "none";
    act.histLedger = "none";
    act.histResults = "none";

    this.ORDER_ACTION_KEYS.forEach(k => {
      act[k] = "edit";
    });

    const out = {
      ...base,
      permissionMatrix: this._normalizePermissionMatrix(mx),
      permissionActionMatrix: this._normalizePermissionActionMatrix(act)
    };
    out.permissions = this.deriveLegacyPermissionsFromMatrix(out.permissionMatrix);
    out.canEdit = this.PERMISSIONS.some(pk => out.permissions[pk]);
    return out;
  },

  /**
   * Patrick — inventario operativo completo (cajas, ubicaciones, stock, prod./transf. en la vista de inventario),
   * panel completo (mismo layout que administrador en zonas del panel + alertas) y recordatorios propios (remPanel);
   * movimientos: consumo diario + ajuste/transferencia para ubicar stock.
   * Caducidad/lotes visibles en inventario (matriz «view»); sin pestaña Config → Expiraciones ni umbral global.
   * Sin administración global; transporte/recepciones solo lectura. Sin pestaña ni acciones de pedidos a proveedor.
   */
  _patrickInventoryLeadBuiltinPayload() {
    const base = this._buildUserTemplatePayload("supervisor");
    if (!base) return null;
    const mx = { ...base.permissionMatrix };
    mx.tabTransport = "view";
    mx.tabOrderlines = "none";
    mx.orderLinesEdit = "none";
    mx.receptionsEdit = "view";
    mx.expirationConfig = "view";
    const act = { ...base.permissionActionMatrix };
    ["cfgTabUsers", "cfgTabElevation", "cfgTabExpirations", "cfgActWipeDb", "cfgActRecipientsPreview"].forEach(k => {
      act[k] = "none";
    });
    act.movAnnul = "none";
    this.TAB_FEATURE_ACTION_KEYS.filter(k => String(k).startsWith("movType_")).forEach(k => {
      act[k] = "none";
    });
    [
      "movType_CONSUMO_DIARIO",
      "movType_AJUSTE",
      "movType_TRANSFERENCIA",
      "movType_TRANSFORMACION",
      "movType_ENVIAR_PRODUCCION"
    ].forEach(k => {
      act[k] = "edit";
    });
    act.invBrowse = "edit";
    act.invTools = "edit";
    act.invDangerClearExpiry = "none";
    this.ORDER_ACTION_KEYS.forEach(k => {
      act[k] = "none";
    });
    const out = {
      ...base,
      permissionMatrix: this._normalizePermissionMatrix(mx),
      permissionActionMatrix: this._normalizePermissionActionMatrix(act)
    };
    out.permissions = this.deriveLegacyPermissionsFromMatrix(out.permissionMatrix);
    out.canEdit = this.PERMISSIONS.some(pk => out.permissions[pk]);
    return out;
  },

  /**
   * Annie — inventario como Patrick; movimientos solo lectura (tipos en vista); sin panel, recordatorios ni transporte;
   * historial solo recepción de material; sin caducidades globales ni pedidos a proveedor.
   */
  _annieTeamCmcBuiltinPayload() {
    const base = this._patrickInventoryLeadBuiltinPayload();
    if (!base) return null;
    const mx = { ...base.permissionMatrix };
    mx.expirationConfig = "none";
    mx.tabDashboard = "none";
    mx.tabReminders = "none";
    mx.tabTransport = "none";
    mx.tabOrderlines = "none";
    mx.orderLinesEdit = "none";
    mx.dashboardAlerts = "none";
    mx.tabMovements = "view";
    mx.tabHistory = "view";
    const act = { ...base.permissionActionMatrix };
    act.cfgTabExpirations = "none";
    this.TAB_FEATURE_ACTION_KEYS.filter(k => String(k).startsWith("movType_")).forEach(k => {
      act[k] = "view";
    });
    act.movPicker = "view";
    act.movRecent = "none";
    act.movAnnul = "none";
    act.dashHero = "none";
    act.dashOverview = "none";
    act.dashToday = "none";
    act.remPanel = "none";
    /* Supervisor deja hist* en «none» explícito; el suelo Patrick no sube hist* para Annie (skip) — habilitar zona de historial en solo lectura. */
    act.histExports = "view";
    act.histFilters = "view";
    act.histResults = "view";
    act.histLedger = "none";
    const out = {
      ...base,
      permissionMatrix: this._normalizePermissionMatrix(mx),
      permissionActionMatrix: this._normalizePermissionActionMatrix(act)
    };
    out.permissions = this.deriveLegacyPermissionsFromMatrix(out.permissionMatrix);
    out.canEdit = this.PERMISSIONS.some(pk => out.permissions[pk]);
    return out;
  },

  getUserCreationTemplates() {
    return [
      { key: "supervisor", i18nKey: "auth.template.supervisor", hintKey: "auth.template.supervisor.hint" },
      { key: "perfil_keith_lake", i18nKey: "auth.template.perfil_keith_lake", hintKey: "auth.template.perfil_keith_lake.hint" },
      { key: "perfil_alex_beaulieu", i18nKey: "auth.template.perfil_alex_beaulieu", hintKey: "auth.template.perfil_alex_beaulieu.hint" },
      { key: "perfil_guest_demo", i18nKey: "auth.template.perfil_guest_demo", hintKey: "auth.template.perfil_guest_demo.hint" },
      { key: "perfil_patrick", i18nKey: "auth.template.perfil_patrick", hintKey: "auth.template.perfil_patrick.hint" },
      { key: "perfil_stephane_demers", i18nKey: "auth.template.perfil_stephane_demers", hintKey: "auth.template.perfil_stephane_demers.hint" },
      { key: "perfil_wen_deng", i18nKey: "auth.template.perfil_wen_deng", hintKey: "auth.template.perfil_wen_deng.hint" },
      { key: "perfil_barbara_bonny", i18nKey: "auth.template.perfil_barbara_bonny", hintKey: "auth.template.perfil_barbara_bonny.hint" },
      { key: "perfil_annie_larose", i18nKey: "auth.template.perfil_annie_larose", hintKey: "auth.template.perfil_annie_larose.hint" }
    ];
  },

  /** Referencia de matriz «invitado consultante»: navegación amplia en vista; sin permisos de edición en matriz. */
  builtinGuestPermissionMatrix() {
    const m = this.defaultPermissionMatrix();
    m.tabDashboard = "view";
    m.tabReminders = "view";
    m.tabInventory = "view";
    m.tabMovements = "view";
    m.tabHistory = "view";
    m.tabTransport = "view";
    m.tabOrderlines = "view";
    m.dashboardAlerts = "view";
    m.expirationConfig = "view";
    m.receptionsEdit = "view";
    m.inventoryEdit = "none";
    m.movementsExport = "none";
    m.loadInventoryCsv = "none";
    m.orderLinesEdit = "none";
    return m;
  },

  _normalizePermissionMatrix(raw) {
    const out = {};
    for (const k of this.MATRIX_KEYS) {
      const v = raw && raw[k];
      out[k] = v === "view" || v === "edit" || v === "none" ? v : "none";
    }
    return out;
  },

  /**
   * Compatibilidad: construye matriz a partir de los flags booleanos históricos `permissions`.
   */
  _matrixFromLegacyPermissions(p) {
    const x = p && typeof p === "object" ? p : {};
    const m = this.defaultPermissionMatrix();
    m.tabDashboard = "edit";
    m.tabReminders = x.reminders ? "edit" : "none";
    m.tabInventory =
      x.editItems ? "edit" : x.movements || x.loadInventoryCsv ? "view" : "none";
    m.tabMovements = x.movements ? "edit" : "none";
    m.tabHistory = x.movements ? "edit" : "none";
    m.tabTransport = x.transport ? "edit" : "none";
    m.tabOrderlines = x.orderLinesEdit ? "edit" : x.movements ? "view" : "none";
    m.inventoryEdit = x.editItems ? "edit" : "none";
    m.movementsExport = x.movementsExport ? "edit" : "none";
    m.loadInventoryCsv = x.loadInventoryCsv ? "edit" : "none";
    m.expirationConfig = x.expirationConfig ? "edit" : "none";
    m.receptionsEdit = x.receptions ? "edit" : "none";
    m.orderLinesEdit = x.orderLinesEdit ? "edit" : "none";
    m.dashboardAlerts = x.movements || x.transport || x.reminders ? "edit" : "view";
    return this._normalizePermissionMatrix(m);
  },

  /** Deriva los flags booleanos usados por el resto del código y por CSS `auth-no-*`. */
  deriveLegacyPermissionsFromMatrix(mx) {
    const m = this._normalizePermissionMatrix(mx || {});
    const tab = k => m[k] || "none";
    return {
      editItems: tab("inventoryEdit") === "edit",
      /** Ver/pestaña Movimientos (incl. solo lectura); ejecutar tipos sigue en actions movType_* / guardMovementTypeProcess. */
      movements: tab("tabMovements") !== "none",
      transport: tab("tabTransport") === "edit",
      receptions: tab("receptionsEdit") === "edit",
      reminders: tab("tabReminders") !== "none",
      orderLinesEdit: tab("orderLinesEdit") === "edit",
      movementsExport: tab("movementsExport") !== "none",
      loadInventoryCsv: tab("loadInventoryCsv") === "edit",
      /** Ver caducidad/lotes en inventario y alertas: «view» o «edit» (no solo administradores). */
      expirationConfig: tab("expirationConfig") !== "none"
    };
  },

  /** Matriz efectiva del usuario en sesión (admin = todo edit). */
  getSessionMatrix() {
    const u = this.getCurrentUser();
    if (!u) return this.defaultPermissionMatrix();
    if (u.role === "admin") {
      const full = {};
      this.MATRIX_KEYS.forEach(k => {
        full[k] = "edit";
      });
      return full;
    }
    let mx = null;
    if (this.isBuiltinId(u.id)) {
      const mergedUser = this.getUserById(u.id);
      if (mergedUser && mergedUser.permissionMatrix && typeof mergedUser.permissionMatrix === "object") {
        mx = mergedUser.permissionMatrix;
      }
    }
    if (!mx) mx = u.permissionMatrix && typeof u.permissionMatrix === "object" ? u.permissionMatrix : null;
    if (!mx) mx = this._matrixFromLegacyPermissions(u.permissions || {});
    mx = this._normalizePermissionMatrix(mx);
    if (this.isElevated()) {
      const out = { ...mx };
      this.MATRIX_KEYS.forEach(k => {
        if (out[k] === "none") out[k] = "view";
      });
      /* Cuentas integradas: lo que la plantilla en código deja en «none» no se revela con elevación temporal (p. ej. Wen sin historial). */
      if (this.isBuiltinId(u.id)) {
        const tmpl = this._getBuiltinUser(u.id);
        if (tmpl && tmpl.permissionMatrix && tmpl.role !== "admin") {
          const tmx = tmpl.permissionMatrix;
          this.MATRIX_KEYS.forEach(k => {
            if ((tmx[k] || "none") === "none") out[k] = "none";
          });
        }
      }
      return out;
    }
    return mx;
  },

  matrixLevel(key) {
    const m = this.getSessionMatrix();
    return m[key] || "none";
  },

  /** Pestaña principal visible en la barra superior. */
  matrixTabVisible(tabId) {
    const map = {
      dashboard: "tabDashboard",
      reminders: "tabReminders",
      inventory: "tabInventory",
      movements: "tabMovements",
      history: "tabHistory",
      transport: "tabTransport",
      orderlines: "tabOrderlines",
      receptions: "receptionsEdit"
    };
    const k = map[tabId];
    if (!k) return true;
    return this.matrixLevel(k) !== "none";
  },

  /** Lee matriz persistida para un usuario (admin UI); fusiona con legacy si falta. */
  getUserPermissionMatrix(userLike) {
    if (!userLike) return this.defaultPermissionMatrix();
    if (userLike.role === "admin") {
      const full = {};
      this.MATRIX_KEYS.forEach(k => {
        full[k] = "edit";
      });
      return full;
    }
    let mx =
      userLike.permissionMatrix && typeof userLike.permissionMatrix === "object"
        ? userLike.permissionMatrix
        : null;
    if (!mx) mx = this._matrixFromLegacyPermissions(userLike.permissions || {});
    if (this.isBuiltinId(userLike.id)) {
      const tmpl = this._getBuiltinUser(userLike.id);
      if (tmpl && tmpl.permissionMatrix) {
        mx = { ...tmpl.permissionMatrix, ...mx };
      }
    }
    return this._normalizePermissionMatrix(mx);
  },

  setUserPermissionMatrix(userId, matrix, actionMatrix) {
    if (!this.isAdmin()) return;
    const tmpl = this._getBuiltinUser(userId);
    if (tmpl && tmpl.role === "admin") return;
    const idx = this.users.findIndex(x => x.id === userId);
    if (idx < 0) return;
    const u = this.users[idx];
    if (!u || u.role === "admin") return;
    u.permissionMatrix = this._normalizePermissionMatrix(matrix || {});
    if (actionMatrix !== undefined) {
      u.permissionActionMatrix = this._normalizePermissionActionMatrix(actionMatrix);
    }
    u.permissions = this.deriveLegacyPermissionsFromMatrix(u.permissionMatrix);
    u.canEdit = this.PERMISSIONS.some(pk => u.permissions[pk]);
    this.saveUsers();
    if (this.sessionUserId === userId) this.applyPermissions();
    this.logAudit("auth.user.matrix", `${u.username || userId}`);
  },

  /** Cuentas definidas en código (no se crean desde la pantalla de login). */
  BUILTIN_IDS: new Set([
    "gneex-builtin-1",
    "gneex-builtin-2",
    "gneex-builtin-3",
    "gneex-builtin-4",
    "gneex-builtin-5",
    "gneex-builtin-6",
    "gneex-builtin-7",
    "gneex-builtin-8",
    "gneex-builtin-9"
  ]),

  /**
   * KPI inventario (stats + resumen panel): totales, stock bajo, caducidad, overstock, cero, negativo — solo admin + estas cuentas.
   */
  FULL_INVENTORY_INSIGHT_BUILTIN_IDS: new Set([
    "gneex-builtin-2",
    "gneex-builtin-4",
    "gneex-builtin-5",
    "gneex-builtin-7"
  ]),

  /** KPI inventario + modal/resumen de alertas completos (stats barra inventario + bloque «Resumen general» del panel). */
  hasFullInventoryInsightWidgets() {
    if (this.isAdmin()) return true;
    return this.FULL_INVENTORY_INSIGHT_BUILTIN_IDS.has(String(this.getUserId() || ""));
  },

  /** Annie: solo movimientos tipo recepción de material en Historial (integrada o mismo usuario reservado). */
  historyMaterialReceptionOnly() {
    const sid = String(this.sessionUserId || "").trim();
    if (sid === "gneex-builtin-9") return true;
    try {
      const row = Array.isArray(this.users) ? this.users.find(u => u && String(u.id) === sid) : null;
      const un = (row?.username || "").trim().toLowerCase();
      if (un === "lranniecmc05??") return true;
    } catch (e) {
      /* ignore */
    }
    return false;
  },

  /** Orden estable para tablas de administración (usuarios integrados). */
  BUILTIN_IDS_ORDERED: [
    "gneex-builtin-1",
    "gneex-builtin-2",
    "gneex-builtin-3",
    "gneex-builtin-4",
    "gneex-builtin-5",
    "gneex-builtin-6",
    "gneex-builtin-7",
    "gneex-builtin-8",
    "gneex-builtin-9"
  ],

  _authLevelOrder(lvl) {
    const order = { none: 0, view: 1, edit: 2 };
    return lvl != null && Object.prototype.hasOwnProperty.call(order, lvl) ? order[lvl] : 0;
  },

  /** Mayor nivel de permiso (none < view < edit). */
  _maxAuthLevel(a, b) {
    return this._authLevelOrder(a) >= this._authLevelOrder(b) ? a || "none" : b || "none";
  },

  /** Menor nivel (el más restrictivo). Sirve para limitar respaldos viejos por la plantilla integrada en código. */
  _minAuthLevel(a, b) {
    return this._authLevelOrder(a) <= this._authLevelOrder(b) ? a || "none" : b || "none";
  },

  /**
   * Cuentas integradas (Keith, Alex, Wen, Barbara, Annie) que reciben suelo «≥ Patrick» en {@link getUserById}.
   * Excluye administrador, Patrick (referencia), e invitados consultantes (guest / Stephane).
   */
  _PATRICK_FLOOR_BUILTIN_IDS: new Set([
    "gneex-builtin-2",
    "gneex-builtin-4",
    "gneex-builtin-7",
    "gneex-builtin-8",
    "gneex-builtin-9"
  ]),

  /** Matriz: no aplicar suelo Patrick a estas claves (excepciones acordadas por cuenta). */
  _patrickFloorSkipMatrixKey(builtinId, key) {
    if (
      builtinId === "gneex-builtin-7" &&
      [
        "tabTransport",
        "tabMovements",
        "tabReminders",
        "tabDashboard",
        "tabHistory",
        "receptionsEdit",
        "dashboardAlerts"
      ].includes(key)
    )
      return true;
    if (
      builtinId === "gneex-builtin-8" &&
      [
        "tabDashboard",
        "tabReminders",
        "tabInventory",
        "inventoryEdit",
        "tabMovements",
        "tabHistory",
        "tabOrderlines",
        "orderLinesEdit",
        "dashboardAlerts",
        "expirationConfig",
        "movementsExport",
        "loadInventoryCsv"
      ].includes(key)
    )
      return true;
    if (
      builtinId === "gneex-builtin-9" &&
      [
        "expirationConfig",
        "tabOrderlines",
        "orderLinesEdit",
        "tabDashboard",
        "tabReminders",
        "tabTransport",
        "tabMovements",
        "tabHistory",
        "dashboardAlerts"
      ].includes(key)
    )
      return true;
    return false;
  },

  /** Acciones finas: no subir con suelo Patrick (prefijos / pedidos / inventario según perfil). */
  _patrickFloorSkipActionKey(builtinId, key) {
    if (builtinId === "gneex-builtin-7") {
      if (key === "trnToolbar" || key === "trnMain") return true;
      if (key === "cfgTabReceptions") return true;
      if (key === "movPicker" || key === "movRecent" || String(key).startsWith("movType_")) return true;
      if (String(key).startsWith("hist")) return true;
      if (key === "remPanel" || /^dash/.test(String(key))) return true;
    }
    if (builtinId === "gneex-builtin-8") {
      if (String(key).startsWith("inv")) return true;
      if (key === "cfgTabItemEdit" || key === "cfgActExportTemplate") return true;
      if (/^dash/.test(String(key)) || key === "remPanel") return true;
      if (String(key).startsWith("hist")) return true;
      if (key === "movPicker" || key === "movRecent" || key === "movAnnul" || String(key).startsWith("movType_"))
        return true;
      if (this.ORDER_ACTION_KEYS.includes(key)) return true;
      if (
        [
          "cfgTabImport",
          "cfgTabExpirations",
          "cfgTabEmployees",
          "cfgTabSuppliers",
          "cfgTabConsumables",
          "cfgTabTransCompanies",
          "cfgTabMeasureUnits"
        ].includes(key)
      )
        return true;
    }
    if (builtinId === "gneex-builtin-9") {
      if (key === "cfgTabExpirations") return true;
      if (this.ORDER_ACTION_KEYS.includes(key)) return true;
      if (String(key).startsWith("movType_")) return true;
      if (key === "movPicker" || key === "movRecent") return true;
      if (/^dash/.test(String(key)) || key === "remPanel") return true;
    }
    return false;
  },

  isBuiltinId(id) {
    return id && this.BUILTIN_IDS.has(String(id));
  },

  reservedBuiltinUsername(name) {
    const n = (name || "").trim().toLowerCase();
    const reserved = new Set([
      "goireteluis",
      "keithl",
      "guestcmc",
      "alexb",
      "phatcmc5!",
      "stephcmc4!!",
      "wdengcmcb1?",
      "barbonb2cmc?",
      "lranniecmc05??"
    ]);
    return reserved.has(n);
  },

  /**
   * Credenciales iniciales de cuentas integradas: solo salt + hash SHA-256 (v1).
   * Las contraseñas en texto plano no se incluyen en el código; el administrador puede cambiarlas en Configuración → Usuarios.
   */
  BUILTIN_CREDENTIAL_SEEDS: [
    {
      id: "gneex-builtin-1",
      salt: "b86ebe52e636df69",
      passwordHash: "63dca76bd4acdd9a9d0a1bb155b70e73efbf0743082b1f848e6f8636c769e75d"
    },
    {
      id: "gneex-builtin-2",
      salt: "aef069eb265212cb",
      passwordHash: "27e3fa9ff4f47458af8aa5fadd245be487f4d9731f4fa8305ff9f9f31e599dc2"
    },
    {
      id: "gneex-builtin-3",
      salt: "4cf2f02feb804c3c",
      passwordHash: "760de29ddac6506f2b8412a34fa96ec4d1b837c04610bd6869ccb0f587fabe51"
    },
    {
      id: "gneex-builtin-4",
      salt: "00d69fc706d33165",
      passwordHash: "9f165e3c39ed0e962f0208267d585c3eba70f63ede7fb5856cb3f78863850604"
    },
    {
      id: "gneex-builtin-5",
      salt: "7932be48660ff4429326d01a0269cdbf",
      passwordHash: "9eb087eb01620c09e884d23a5ad46108712427ca60ae3ceb4d54849cd263c5ec"
    },
    {
      id: "gneex-builtin-6",
      salt: "5b40c58ef01af61ba431982f50c224f2",
      passwordHash: "0faa4a95c08eae12d4ba7c813336e942249aeac0519da95148dbb1d3c4b7185f"
    },
    {
      id: "gneex-builtin-7",
      salt: "871b23d7fd9610a27b20db0ab9d29d50",
      passwordHash: "1d24daa49e746b5f2a14879f56c55b6291813ee9e67dada322d6b1b52ee0365e"
    },
    {
      id: "gneex-builtin-8",
      salt: "b634138301d5c91ddec1b4680f9fd2bb",
      passwordHash: "a9d4833d22a60ab7bc8870445b15f5d067658895dab1d4b3d6a67a0b3c139bee"
    },
    {
      id: "gneex-builtin-9",
      salt: "96170fa8230236482c918fb4be2475f1",
      passwordHash: "bfaff45716b49a0e34bdcf1f450f3e6d1a1aa05bb8303b901579e031b8c1101e"
    }
  ],

  /** Añade en `localStorage` las cuentas integradas si faltan (misma contraseña que antes de quitar el texto plano del código). */
  ensureBuiltinAccountsSeeded() {
    this.loadUsers();
    let added = false;
    const ids = new Set(this.users.map(u => u.id));
    for (const seed of this.BUILTIN_CREDENTIAL_SEEDS) {
      if (ids.has(seed.id)) continue;
      const tmpl = this._getBuiltinUser(seed.id);
      if (!tmpl) continue;
      const row = {
        id: seed.id,
        username: tmpl.username,
        displayName: tmpl.displayName,
        salt: seed.salt,
        passwordHash: seed.passwordHash,
        passwordHistory: [],
        role: tmpl.role,
        canEdit: tmpl.canEdit,
        permissions: { ...tmpl.permissions },
        builtin: true
      };
      if (tmpl.permissionMatrix) row.permissionMatrix = { ...tmpl.permissionMatrix };
      if (tmpl.permissionActionMatrix) row.permissionActionMatrix = { ...tmpl.permissionActionMatrix };
      this.users.push(row);
      added = true;
      ids.add(seed.id);
    }
    if (added) {
      this.users.forEach(u => this.migrateUserPerms(u));
      this.syncBuiltinStoredUsersWithTemplate();
      this.saveUsers();
    }
  },

  _getBuiltinUser(id) {
    if (!this.BUILTIN_IDS.has(id)) return null;
    const permsAll = this.defaultPermsForRole("admin");
    if (id === "gneex-builtin-1") {
      return {
        id: "gneex-builtin-1",
        username: "GoireteLuis",
        displayName: "Luis Goire",
        role: "admin",
        canEdit: true,
        permissions: { ...permsAll },
        builtin: true
      };
    }
    /* Keith: casi supervisor (acuerdo explícito); sin usuarios / elevación / wipe / import respaldo / preview destinatarios. */
    if (id === "gneex-builtin-2") {
      const k = this._keithSupervisorLikeBuiltinPayload();
      if (!k) return null;
      return {
        id: "gneex-builtin-2",
        username: "KeithL",
        displayName: "Keith Lake",
        role: "user",
        canEdit: k.canEdit,
        permissions: { ...k.permissions },
        permissionMatrix: k.permissionMatrix,
        permissionActionMatrix: k.permissionActionMatrix,
        builtin: true
      };
    }
    /* Guest: solo lectura tipo consultante (acuerdo explícito). */
    if (id === "gneex-builtin-3") {
      const g = this._guestReadonlyConsultanteBuiltinPayload();
      if (!g) return null;
      return {
        id: "gneex-builtin-3",
        username: "guestCMC",
        displayName: "Guest",
        role: "user",
        canEdit: g.canEdit,
        permissions: { ...g.permissions },
        permissionMatrix: g.permissionMatrix,
        permissionActionMatrix: g.permissionActionMatrix,
        builtin: true
      };
    }
    /* Alex: igual que Keith — casi supervisor (acuerdo explícito). */
    if (id === "gneex-builtin-4") {
      const k = this._keithSupervisorLikeBuiltinPayload();
      if (!k) return null;
      return {
        id: "gneex-builtin-4",
        username: "AlexB",
        displayName: "Alex Beaulieu",
        role: "user",
        canEdit: k.canEdit,
        permissions: { ...k.permissions },
        permissionMatrix: k.permissionMatrix,
        permissionActionMatrix: k.permissionActionMatrix,
        builtin: true
      };
    }
    /* Equipo CMC — perfiles acordados individualmente (véase comentarios por id). */
    if (id === "gneex-builtin-5") {
      const p = this._patrickInventoryLeadBuiltinPayload();
      if (!p) return null;
      return {
        id: "gneex-builtin-5",
        username: "PhatCMC5!",
        displayName: "Patrick",
        role: "user",
        canEdit: p.canEdit,
        permissions: { ...p.permissions },
        permissionMatrix: p.permissionMatrix,
        permissionActionMatrix: p.permissionActionMatrix,
        builtin: true
      };
    }
    if (id === "gneex-builtin-6") {
      const s = this._stephaneReadonlyConsultanteBuiltinPayload();
      if (!s) return null;
      return {
        id: "gneex-builtin-6",
        username: "StephCMC4!!",
        displayName: "Stephane Demers",
        role: "user",
        canEdit: s.canEdit,
        permissions: { ...s.permissions },
        permissionMatrix: s.permissionMatrix,
        permissionActionMatrix: s.permissionActionMatrix,
        builtin: true
      };
    }
    /* Wen: comprador — inventario, pedidos, caducidades, alertas, COMPRA_STOCK. */
    if (id === "gneex-builtin-7") {
      const w = this._wenBuyerBuiltinPayload();
      if (!w) return null;
      return {
        id: "gneex-builtin-7",
        username: "WdengCMCB1?",
        displayName: "Wen Deng",
        role: "user",
        canEdit: w.canEdit,
        permissions: { ...w.permissions },
        permissionMatrix: w.permissionMatrix,
        permissionActionMatrix: w.permissionActionMatrix,
        builtin: true
      };
    }
    /* Barbara: solo transporte y recepciones (export XLSX recepciones); sin panel, recordatorios, movimientos ni historial. */
    if (id === "gneex-builtin-8") {
      const b = this._barbaraTransportLeadBuiltinPayload();
      if (!b) return null;
      return {
        id: "gneex-builtin-8",
        username: "BarbonB2CMC?",
        displayName: "Barbara Bonny",
        role: "user",
        canEdit: b.canEdit,
        permissions: { ...b.permissions },
        permissionMatrix: b.permissionMatrix,
        permissionActionMatrix: b.permissionActionMatrix,
        builtin: true
      };
    }
    /* Annie — inventario tipo Patrick; movimientos/historial en solo lectura restringida; sin panel ni caducidades globales ni pedidos. */
    if (id === "gneex-builtin-9") {
      const a = this._annieTeamCmcBuiltinPayload();
      if (!a) return null;
      return {
        id: "gneex-builtin-9",
        username: "LRAnnieCMC05??",
        displayName: "Annie Larose",
        role: "user",
        canEdit: a.canEdit,
        permissions: { ...a.permissions },
        permissionMatrix: a.permissionMatrix,
        permissionActionMatrix: a.permissionActionMatrix,
        builtin: true
      };
    }
    return null;
  },

  defaultPermsForRole(role) {
    if (role === "admin") {
      const p = {};
      this.PERMISSIONS.forEach(k => p[k] = true);
      return p;
    }
    return {};
  },

  migrateUserPerms(u) {
    if (!u.permissions || typeof u.permissions !== "object") {
      if (u.role === "admin") {
        u.permissions = this.defaultPermsForRole("admin");
      } else {
        u.permissions = {};
        if (u.canEdit) this.PERMISSIONS.forEach(k => u.permissions[k] = true);
      }
    }
    const p = u.permissions;
    if (p.importExport) {
      p.movementsExport = true;
      p.loadInventoryCsv = true;
      delete p.importExport;
    }
    if (p.movementsMerge) {
      p.movementsExport = true;
      delete p.movementsMerge;
    }
    if (p.wipeDb) delete p.wipeDb;
    if (!Array.isArray(u.passwordHistory)) u.passwordHistory = [];
    if (u.passwordHistory.length > 5) u.passwordHistory = u.passwordHistory.slice(0, 5);
    if (u.role !== "admin") {
      if (!u.permissionMatrix || typeof u.permissionMatrix !== "object") {
        u.permissionMatrix = this._matrixFromLegacyPermissions(u.permissions || {});
      } else {
        u.permissionMatrix = this._normalizePermissionMatrix(u.permissionMatrix);
      }
      u.permissions = this.deriveLegacyPermissionsFromMatrix(u.permissionMatrix);
      u.canEdit = this.PERMISSIONS.some(pk => u.permissions[pk]);
      if (u.builtin && (u.id === "gneex-builtin-3" || u.id === "gneex-builtin-6")) {
        u.canEdit = false;
      }
    }
  },

  /** Últimas contraseñas (salt+hash) para impedir reutilización en usuarios personalizados. */
  PASSWORD_HISTORY_MAX: 5,

  async _wouldReusePassword(user, newPlainPassword) {
    if (!user || !newPlainPassword) return false;
    const pw = String(newPlainPassword);
    try {
      const cur = await this._hash(pw, user.salt || "");
      if (cur === user.passwordHash) return true;
      const hist = Array.isArray(user.passwordHistory) ? user.passwordHistory : [];
      for (const h of hist) {
        if (!h || !h.salt || !h.hash) continue;
        const tryH = await this._hash(pw, h.salt);
        if (tryH === h.hash) return true;
      }
    } catch (e) {
      console.warn("_wouldReusePassword", e);
    }
    return false;
  },

  _pushPasswordHistoryBeforeChange(user) {
    if (!user || !user.passwordHash || !user.salt) return;
    if (!Array.isArray(user.passwordHistory)) user.passwordHistory = [];
    user.passwordHistory.unshift({ salt: user.salt, hash: user.passwordHash });
    while (user.passwordHistory.length > this.PASSWORD_HISTORY_MAX) {
      user.passwordHistory.pop();
    }
  },

  _builtinId(u) {
    return u && u.id ? String(u.id) : "";
  },

  _isBuiltinKeith(u) {
    return this._builtinId(u) === "gneex-builtin-2";
  },

  _isBuiltinAlex(u) {
    return this._builtinId(u) === "gneex-builtin-4";
  },

  hasReminders() {
    if (this.isAdmin() || this.isElevated()) return true;
    return this.matrixLevel("tabReminders") !== "none";
  },

  guardReminders() {
    if (this.hasReminders()) return true;
    this.denyEditToast();
    return false;
  },

  hasOrderLinesEdit() {
    const u = this.getCurrentUser();
    if (!u) return false;
    if (u.role === "admin") return true;
    return this.matrixLevel("orderLinesEdit") === "edit";
  },

  guardOrderLinesEdit() {
    if (this.hasOrderLinesEdit()) return true;
    this.denyEditToast();
    return false;
  },

  hasMovementsExport() {
    return this.hasPerm("movementsExport");
  },

  guardMovementsExport() {
    if (!this.hasMovementsExport()) {
      this.denyEditToast();
      return false;
    }
    if (!this._fineActionMeets("cfgActMovementsExport", "edit")) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  hasLoadInventoryCsv() {
    return this.hasPerm("loadInventoryCsv");
  },

  guardLoadInventoryCsv() {
    if (!this.hasLoadInventoryCsv()) {
      this.denyEditToast();
      return false;
    }
    if (!this._fineActionMeets("cfgActImportInventory", "edit")) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  hasExpirationConfig() {
    const u = this.getCurrentUser();
    if (!u) return false;
    if (u.role === "admin") return true;
    return this.matrixLevel("expirationConfig") === "edit";
  },

  guardExpirationConfig() {
    if (this.hasExpirationConfig()) return true;
    this.denyEditToast();
    return false;
  },

  hasReceptionsEdit() {
    const u = this.getCurrentUser();
    if (!u) return false;
    if (u.role === "admin") return true;
    return this.matrixLevel("receptionsEdit") === "edit";
  },

  guardReceptionsEdit() {
    if (this.hasReceptionsEdit()) return true;
    this.denyEditToast();
    return false;
  },

  /** Importar respaldo JSON completo: cualquier usuario con sesión iniciada. */
  canImportBackup() {
    return !!this.getCurrentUser();
  },

  guardImportBackup() {
    if (!this.canImportBackup()) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  /** Respaldo ZIP, fusiones, archivar: cualquier usuario con sesión (no administrador exclusivo). */
  guardImportExportFeatures() {
    if (this.getCurrentUser()) return true;
    this.denyEditToast();
    return false;
  },

  /** Libro «consumo por destinatario» en Historial: administrador o sesión elevada temporal. */
  hasConsumoLedgerAdmin() {
    return this.isAdmin() || this.isElevated();
  },

  /** Permisos operativos de administrador (transporte, fusionar mov., consumo libro…) sin ser cuenta admin. */
  guardElevatedCapability() {
    if (this.isAdmin() || this.isElevated()) return true;
    this.denyEditToast();
    return false;
  },

  /** Mutaciones en Transporte (crear, expedir, borrar…): admin, elevación temporal o matriz «transporte» en edición. */
  guardTransportMutation() {
    if (this.isAdmin()) return true;
    if (this.isElevated()) return true;
    if (this.matrixLevel("tabTransport") === "edit") return true;
    this.denyEditToast();
    return false;
  },

  /** Fusionar movimientos desde archivo JSON. */
  guardMergeMovementsImport() {
    if (!this.guardImportExportFeatures()) return false;
    if (!this._fineActionMeets("cfgActMovementsMerge", "edit")) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  /** Fusionar transportes desde archivo JSON. */
  guardMergeTransportsImport() {
    if (!this.guardImportExportFeatures()) return false;
    if (!this._fineActionMeets("cfgActTransportsMerge", "edit")) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  /** Exportar JSON de transportes (incl. expedidos). */
  guardTransportsExportJson() {
    if (!this.hasMovementsExport()) {
      this.denyEditToast();
      return false;
    }
    if (!this._fineActionMeets("cfgActTransportsExport", "edit")) {
      this.denyEditToast();
      return false;
    }
    return true;
  },

  /** @deprecated usar {@link Auth#hasMovementsExport} o {@link Auth#guardMergeMovementsImport} */
  hasMovementsMergeAccess() {
    return this.hasMovementsExport() || this.isAdmin();
  },

  /** @deprecated usar {@link Auth#guardMovementsExport} o {@link Auth#guardMergeMovementsImport} */
  guardMovementsMergeAccess() {
    if (this.hasMovementsMergeAccess()) return true;
    this.denyEditToast();
    return false;
  },
  _bgTimer: null,
  _bgIndex: 0,
  /** URLs cargadas desde `assets/login-bg-manifest.json` (o solo logo). */
  BG_IMAGES: [],

  _salt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
  },

  async _hash(password, salt) {
    if (!crypto || !crypto.subtle) {
      throw new Error("crypto.subtle unavailable (use https:// or localhost)");
    }
    const enc = new TextEncoder();
    const data = enc.encode(`g-neex-v1|${salt}|${password}`);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
  },

  /**
   * Persiste la matriz efectiva de cuentas integradas (merge plantilla en código + datos del respaldo).
   * Un respaldo antiguo puede traer `permissionMatrix` / `permissionActionMatrix` por debajo de la plantilla actual.
   */
  syncBuiltinStoredUsersWithTemplate() {
    let changed = false;
    for (const u of this.users) {
      if (!u || !this.isBuiltinId(u.id) || u.id === "gneex-builtin-1") continue;
      const merged = this.getUserById(u.id);
      if (!merged || !merged.permissionMatrix) continue;
      const pmEq = JSON.stringify(u.permissionMatrix ?? null) === JSON.stringify(merged.permissionMatrix);
      const amEq =
        JSON.stringify(u.permissionActionMatrix ?? null) === JSON.stringify(merged.permissionActionMatrix ?? {});
      if (pmEq && amEq) continue;
      u.permissionMatrix = merged.permissionMatrix;
      u.permissionActionMatrix = merged.permissionActionMatrix;
      u.permissions = merged.permissions;
      u.canEdit = merged.canEdit;
      changed = true;
    }
    return changed;
  },

  loadUsers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USERS);
      this.users = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this.users)) this.users = [];
      this.users.forEach(u => this.migrateUserPerms(u));
      if (this.syncBuiltinStoredUsersWithTemplate()) this.saveUsers();
    } catch (e) {
      this.users = [];
    }
  },

  saveUsers() {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(this.users));
  },

  loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
      const s = raw ? JSON.parse(raw) : null;
      this.sessionUserId = s && s.userId ? s.userId : null;
      this._pruneExpiredElevationInSession(s);
    } catch (e) {
      this.sessionUserId = null;
    }
  },

  _pruneExpiredElevationInSession(sessionObj) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
      const s = sessionObj || (raw ? JSON.parse(raw) : null);
      if (!s || !s.elevatedUntil) return;
      if (new Date(s.elevatedUntil).getTime() <= Date.now()) {
        delete s.elevatedUntil;
        localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(s));
      }
    } catch (e) {
      /* ignore */
    }
  },

  saveSession(userId) {
    if (!userId) {
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      this.sessionUserId = null;
      return;
    }
    this.sessionUserId = userId;
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({ userId, at: new Date().toISOString() }));
  },

  /** Ampliación de permisos hasta ISO (solo usuario ya logueado no-admin). */
  setSessionElevation(untilIso) {
    if (!this.sessionUserId || !untilIso) return;
    let s = {};
    try {
      s = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION) || "{}");
    } catch (e) {
      s = {};
    }
    if (s.userId !== this.sessionUserId) return;
    s.at = new Date().toISOString();
    s.elevatedUntil = untilIso;
    localStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(s));
  },

  isElevated() {
    if (this.isAdmin()) return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.SESSION);
      const s = raw ? JSON.parse(raw) : null;
      if (!s || !s.elevatedUntil) return false;
      const t = new Date(s.elevatedUntil).getTime();
      if (t <= Date.now()) return false;
      return true;
    } catch (e) {
      return false;
    }
  },

  _normalizeElevationCode(str) {
    return String(str || "")
      .trim()
      .replace(/\s+/g, "")
      .toUpperCase();
  },

  _loadElevationOutstanding() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ELEVATION_OUTSTANDING);
      const o = raw ? JSON.parse(raw) : [];
      return Array.isArray(o) ? o : [];
    } catch (e) {
      return [];
    }
  },

  _saveElevationOutstanding(arr) {
    localStorage.setItem(STORAGE_KEYS.ELEVATION_OUTSTANDING, JSON.stringify(arr));
  },

  _loadElevationConsumed() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ELEVATION_CONSUMED);
      const a = raw ? JSON.parse(raw) : [];
      return Array.isArray(a) ? a : [];
    } catch (e) {
      return [];
    }
  },

  _saveElevationConsumed(arr) {
    localStorage.setItem(STORAGE_KEYS.ELEVATION_CONSUMED, JSON.stringify(arr));
  },

  _isElevationCodeConsumed(normalizedCode) {
    return this._loadElevationConsumed().includes(normalizedCode);
  },

  /** Marca código como usado para siempre (anti reutilización / copias). */
  _markElevationCodeConsumed(normalizedCode) {
    const list = this._loadElevationConsumed();
    if (!list.includes(normalizedCode)) {
      list.push(normalizedCode);
      while (list.length > 3000) list.shift();
      this._saveElevationConsumed(list);
    }
  },

  /** Cuentas que pueden recibir un código de elevación (no administradores). */
  isElevationRedeemTargetId(userId) {
    if (!userId || userId === "gneex-builtin-1") return false;
    const u = this.getUserById(userId);
    if (!u) return false;
    if (u.role === "admin") return false;
    return true;
  },

  /** Lista para el desplegable de emisión (integrados salvo admin + usuarios no admin). */
  getElevationIssuanceTargets() {
    this.loadUsers();
    const seen = new Set();
    const out = [];
    const push = u => {
      if (!u || !u.id || u.role === "admin" || seen.has(u.id)) return;
      seen.add(u.id);
      out.push({
        id: u.id,
        label: `${u.displayName || u.username} (${u.username})`
      });
    };
    for (const bid of this.BUILTIN_IDS) {
      if (bid === "gneex-builtin-1") continue;
      push(this._getBuiltinUser(bid));
    }
    for (const u of this.users) push(u);
    out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    return out;
  },

  /**
   * Solo administrador: genera un código firmado (válido en cualquier PC con esta app). Emisión ilimitada.
   * @param {string} redeemUserId Usuario autorizado (obligatorio); solo esa sesión podrá canjear.
   */
  async issueElevationCode(tier, redeemUserId) {
    if (!this.isAdmin()) return { ok: false, msg: "forbidden" };
    if (!["h48", "week", "month"].includes(tier)) return { ok: false, msg: "bad-tier" };
    if (!redeemUserId || typeof redeemUserId !== "string") return { ok: false, msg: "no-target" };
    if (!this.isElevationRedeemTargetId(redeemUserId)) return { ok: false, msg: "bad-target" };
    let code;
    try {
      code = await this._createSignedElevationCode(tier, redeemUserId);
    } catch (e) {
      console.warn("issueElevationCode signed", e);
      return { ok: false, msg: "error" };
    }
    const tgt = this.getUserById(redeemUserId);
    this.logAudit("elevation.issue", `${tier}->${tgt ? tgt.username : redeemUserId}`);
    return { ok: true, code };
  },

  /**
   * Limpia estado local de elevación: pendientes de canje, lista de códigos ya usados y datos antiguos de pool (solo administrador).
   */
  resetElevationPools() {
    if (!this.isAdmin()) return { ok: false, msg: "forbidden" };
    localStorage.removeItem(STORAGE_KEYS.ELEVATION_POOL);
    localStorage.removeItem(STORAGE_KEYS.ELEVATION_OUTSTANDING);
    localStorage.removeItem(STORAGE_KEYS.ELEVATION_CONSUMED);
    this.logAudit("elevation.stateReset", "local");
    return { ok: true };
  },

  _applyElevationDuration(tier) {
    const ms = this.ELEVATION_TIER_MS[tier];
    if (!ms) return { ok: false, msg: "bad-tier" };
    let base = Date.now();
    try {
      const sess = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION) || "{}");
      if (sess.elevatedUntil) {
        const prev = new Date(sess.elevatedUntil).getTime();
        if (prev > base) base = prev;
      }
    } catch (e) {
      /* ignore */
    }
    const until = new Date(base + ms).toISOString();
    this.setSessionElevation(until);
    this.logAudit("elevation.redeem", String(tier));
    this.applyPermissions();
    this.updateUserBar();
    return { ok: true, until };
  },

  /**
   * Canje en la sesión actual: no aplica a cuenta administrador integrada.
   * Códigos firmados (nuevos): válidos en cualquier ordenador con esta misma aplicación.
   * Códigos antiguos solo en lista «pendientes» del mismo equipo que emitió (legacy).
   */
  async redeemElevationCode(raw) {
    const trimmed = this._trimElevationInput(raw);
    if (!trimmed) return { ok: false, msg: "empty" };
    if (!this.getCurrentUser()) return { ok: false, msg: "no-session" };
    if (this.isAdmin()) return { ok: false, msg: "admin-no-need" };

    const signedPayload = await this._tryVerifySignedElevation(trimmed);
    if (signedPayload) {
      if (this._isElevationCodeConsumed(trimmed)) return { ok: false, msg: "already-used" };
      if (Date.now() - signedPayload.i > this.ELEVATION_CODE_MAX_AGE_MS) {
        return { ok: false, msg: "expired" };
      }
      if (signedPayload.uid !== this.sessionUserId) return { ok: false, msg: "wrong-recipient" };
      this._markElevationCodeConsumed(trimmed);
      return this._applyElevationDuration(signedPayload.tier);
    }

    const code = this._normalizeElevationCode(raw);
    if (!code) return { ok: false, msg: "empty" };
    if (this._isElevationCodeConsumed(code)) return { ok: false, msg: "already-used" };
    const outstanding = this._loadElevationOutstanding();
    const idx = outstanding.findIndex(x => this._normalizeElevationCode(x.code) === code);
    if (idx < 0) return { ok: false, msg: "invalid" };
    const entry = outstanding[idx];
    const { tier, redeemUserId } = entry;
    if (redeemUserId != null && redeemUserId !== "") {
      if (redeemUserId !== this.sessionUserId) {
        return { ok: false, msg: "wrong-recipient" };
      }
    }
    outstanding.splice(idx, 1);
    this._saveElevationOutstanding(outstanding);
    this._markElevationCodeConsumed(code);
    return this._applyElevationDuration(tier);
  },

  elevationPoolCounts() {
    try {
      return {
        h48: null,
        week: null,
        month: null,
        outstanding: this._loadElevationOutstanding().length
      };
    } catch (e) {
      return { h48: null, week: null, month: null, outstanding: 0 };
    }
  },

  getUserById(id) {
    const stored = this.users.find(u => u.id === id);
    const tmpl = this._getBuiltinUser(id);
    if (stored && tmpl) {
      if (tmpl.role === "admin") {
        return {
          ...tmpl,
          ...stored,
          permissions: { ...this.defaultPermsForRole("admin") },
          role: tmpl.role,
          canEdit: true,
          builtin: true
        };
      }
      const tmplMx =
        tmpl.permissionMatrix ||
        this._matrixFromLegacyPermissions(tmpl.permissions || {});
      const mergedMatrix = this._normalizePermissionMatrix({
        ...tmplMx,
        ...(stored.permissionMatrix || {})
      });
      let mergedActMx = { ...(tmpl.permissionActionMatrix || {}), ...(stored.permissionActionMatrix || {}) };
      /**
       * Cuentas integradas: la plantilla en código es la referencia. Respaldos viejos pueden tener menos
       * permiso (se sube con max hacia la plantilla) o más (se baja con min); combinación min(max(stored, tmpl), tmpl) === tmpl.
       */
      if (this.isBuiltinId(id)) {
        this.MATRIX_KEYS.forEach(k => {
          const t = tmplMx[k] || "none";
          mergedMatrix[k] = this._minAuthLevel(this._maxAuthLevel(mergedMatrix[k] || "none", t), t);
        });
        const floorAct = this.getEffectivePermissionActionMatrix({
          id,
          role: "user",
          permissionMatrix: tmplMx,
          permissionActionMatrix: tmpl.permissionActionMatrix || {}
        });
        const tmplActRaw = tmpl.permissionActionMatrix || {};
        [...this.CONFIG_ACTION_KEYS, ...this.ORDER_ACTION_KEYS, ...this.TAB_FEATURE_ACTION_KEYS].forEach(k => {
          const rawT = tmplActRaw[k];
          if (rawT === "none" || rawT === "view" || rawT === "edit") {
            mergedActMx[k] = this._minAuthLevel(this._maxAuthLevel(mergedActMx[k] || "none", rawT), rawT);
          } else {
            mergedActMx[k] = this._maxAuthLevel(mergedActMx[k] || "none", floorAct[k] || "none");
          }
        });
        if ((tmpl.permissionActionMatrix || {}).invDangerClearExpiry === "none") {
          mergedActMx.invDangerClearExpiry = "none";
        }
        const patrickFloorRef = this._patrickInventoryLeadBuiltinPayload();
        if (patrickFloorRef && this._PATRICK_FLOOR_BUILTIN_IDS.has(id)) {
          const patMx = patrickFloorRef.permissionMatrix;
          const patFloorAct = this.getEffectivePermissionActionMatrix({
            id,
            role: "user",
            permissionMatrix: patMx,
            permissionActionMatrix: patrickFloorRef.permissionActionMatrix || {}
          });
          this.MATRIX_KEYS.forEach(k => {
            if (this._patrickFloorSkipMatrixKey(id, k)) return;
            mergedMatrix[k] = this._maxAuthLevel(mergedMatrix[k] || "none", patMx[k] || "none");
          });
          [...this.CONFIG_ACTION_KEYS, ...this.ORDER_ACTION_KEYS, ...this.TAB_FEATURE_ACTION_KEYS].forEach(k => {
            if (this._patrickFloorSkipActionKey(id, k)) return;
            mergedActMx[k] = this._maxAuthLevel(mergedActMx[k] || "none", patFloorAct[k] || "none");
          });
          if ((patrickFloorRef.permissionActionMatrix || {}).invDangerClearExpiry === "none") {
            mergedActMx.invDangerClearExpiry = "none";
          }
        }
      }
      const mergedPerms = this.deriveLegacyPermissionsFromMatrix(mergedMatrix);
      let canEdit = this.PERMISSIONS.some(k => mergedPerms[k]);
      if (id === "gneex-builtin-3" || id === "gneex-builtin-6") canEdit = false;
      return {
        ...tmpl,
        ...stored,
        permissionMatrix: mergedMatrix,
        permissionActionMatrix: mergedActMx,
        permissions: mergedPerms,
        role: tmpl.role,
        canEdit,
        builtin: true
      };
    }
    if (stored) return stored;
    if (tmpl) return JSON.parse(JSON.stringify(tmpl));
    return null;
  },

  getUserByUsername(name) {
    const n = (name || "").trim().toLowerCase();
    return this.users.find(u => (u.username || "").toLowerCase() === n) || null;
  },

  validateSession() {
    if (!this.sessionUserId) return false;
    this.loadUsers();
    this.ensureBuiltinAccountsSeeded();
    return !!this.users.find(u => u.id === this.sessionUserId);
  },

  getCurrentUser() {
    return this.sessionUserId ? this.getUserById(this.sessionUserId) : null;
  },

  getDisplayName() {
    const u = this.getCurrentUser();
    return u ? (u.displayName || u.username || "") : "";
  },

  getUserId() {
    const u = this.getCurrentUser();
    return u ? u.id : "";
  },

  isAdmin() {
    const u = this.getCurrentUser();
    return !!(u && u.role === "admin");
  },

  canEdit() {
    const u = this.getCurrentUser();
    if (!u) return false;
    if (u.role === "admin") return true;
    if (this.isElevated()) return true;
    return !!u.canEdit;
  },

  hasPerm(perm) {
    const u = this.getCurrentUser();
    if (!u) return false;
    if (u.role === "admin") return true;
    if (this.isElevated()) return true;
    const derived = this.deriveLegacyPermissionsFromMatrix(this.getSessionMatrix());
    return !!derived[perm];
  },

  guardPerm(perm) {
    if (this.hasPerm(perm)) return true;
    this.denyEditToast();
    return false;
  },

  /** Solo administrador (pestañas y acciones críticas de configuración). */
  guardAdmin() {
    if (this.isAdmin()) return true;
    this.denyEditToast();
    return false;
  },

  setUserPerm(userId, perm, value) {
    if (!this.isAdmin()) return;
    const tmpl = this._getBuiltinUser(userId);
    if (tmpl && tmpl.role === "admin") return;
    const idx = this.users.findIndex(x => x.id === userId);
    if (idx < 0) return;
    const u = this.users[idx];
    if (!u || u.role === "admin") return;
    if (!u.permissions) u.permissions = {};
    u.permissions[perm] = !!value;
    u.permissionMatrix = this._matrixFromLegacyPermissions(u.permissions);
    u.canEdit = this.PERMISSIONS.some(k => u.permissions[k]);
    this.saveUsers();
    if (this.sessionUserId === userId) this.applyPermissions();
    this.logAudit("auth.user.perm", `${u.username || userId}:${perm}=${value}`);
  },

  logAudit(action, detail) {
    try {
      const u = this.getCurrentUser();
      const entry = {
        id: Utils.generateId(),
        at: new Date().toISOString(),
        userId: u ? u.id : "",
        displayName: u ? (u.displayName || u.username) : "",
        action: String(action || ""),
        detail: String(detail || "").slice(0, 500)
      };
      let log = [];
      try {
        log = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT) || "[]");
        if (!Array.isArray(log)) log = [];
      } catch (e) {
        log = [];
      }
      log.push(entry);
      while (log.length > this.MAX_AUDIT) log.shift();
      localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(log));
    } catch (e) {
      console.warn("audit log failed", e);
    }
  },

  async registerFirstAdmin(username, displayName, password) {
    this.loadUsers();
    if (this.users.length) return { ok: false, msg: "exists" };
    const un = (username || "").trim();
    const dn = (displayName || "").trim() || un;
    if (this.reservedBuiltinUsername(un)) return { ok: false, msg: "reserved" };
    if (un.length < 2 || password.length < 6) return { ok: false, msg: "short" };
    const salt = this._salt();
    const passwordHash = await this._hash(password, salt);
    const user = {
      id: Utils.generateId(),
      username: un,
      displayName: dn,
      salt,
      passwordHash,
      passwordHistory: [],
      role: "admin",
      canEdit: true,
      permissions: this.defaultPermsForRole("admin")
    };
    this.users.push(user);
    this.saveUsers();
    this.logAudit("auth.bootstrap", `admin:${un}`);
    return { ok: true, user };
  },

  async login(username, password) {
    try {
      this.ensureBuiltinAccountsSeeded();
      this.loadUsers();
      const u = this.getUserByUsername(username);
      if (!u || !u.passwordHash || !u.salt) return { ok: false };
      const hash = await this._hash(password || "", u.salt || "");
      if (hash !== u.passwordHash) return { ok: false };
      this.saveSession(u.id);
      this.logAudit("auth.login", u.username);
      return { ok: true, user: this.getUserById(u.id) };
    } catch (e) {
      console.error("login failed", e);
      return { ok: false, msg: "error" };
    }
  },

  logout() {
    const u = this.getCurrentUser();
    if (u) this.logAudit("auth.logout", u.username);
    this.saveSession(null);
    /* Permitir que el splash vuelva a salir en el siguiente login (la clave
       se setea al mostrarlo y por sí sola sobrevive a F5 pero no a cerrar
       la pestaña; aquí la limpiamos explícitamente para cerrar el ciclo). */
    try { sessionStorage.removeItem("gneex-welcome-splash-shown"); } catch { /* noop */ }
    window.location.reload();
  },

  async addUser({ username, displayName, password, role, canEdit, templateKey }) {
    if (!this.isAdmin()) return { ok: false, msg: "forbidden" };
    const un = (username || "").trim();
    if (this.reservedBuiltinUsername(un)) return { ok: false, msg: "reserved" };
    if (this.getUserByUsername(un)) return { ok: false, msg: "dup" };
    if (un.length < 2 || (password || "").length < 6) return { ok: false, msg: "short" };
    const salt = this._salt();
    const passwordHash = await this._hash(password, salt);
    const r2 = role === "admin" ? "admin" : "user";
    const user = {
      id: Utils.generateId(),
      username: un,
      displayName: (displayName || "").trim() || un,
      salt,
      passwordHash,
      passwordHistory: [],
      role: r2,
      canEdit: !!canEdit || r2 === "admin",
      permissions: r2 === "admin" ? this.defaultPermsForRole("admin") : {}
    };
    if (r2 !== "admin") {
      const tpl = this._buildUserTemplatePayload(templateKey);
      if (templateKey && !tpl) return { ok: false, msg: "bad-template" };
      if (tpl) {
        user.role = tpl.role;
        user.canEdit = !!tpl.canEdit;
        user.permissionMatrix = tpl.permissionMatrix;
        user.permissionActionMatrix = tpl.permissionActionMatrix;
      } else if (canEdit) {
        const full = {};
        this.MATRIX_KEYS.forEach(k => {
          full[k] = "edit";
        });
        user.permissionMatrix = this._normalizePermissionMatrix(full);
      } else {
        user.permissionMatrix = this.defaultPermissionMatrix();
      }
      user.permissions = this.deriveLegacyPermissionsFromMatrix(user.permissionMatrix);
      user.canEdit = this.PERMISSIONS.some(pk => user.permissions[pk]);
    }
    this.users.push(user);
    this.saveUsers();
    this.logAudit("auth.user.create", un);
    return { ok: true, user };
  },

  async setUserPassword(userId, newPassword) {
    if (!this.isAdmin()) return { ok: false };
    this.loadUsers();
    const idx = this.users.findIndex(x => x.id === userId);
    if (idx < 0) return { ok: false };
    const u = this.users[idx];
    if ((newPassword || "").length < 6) return { ok: false, msg: "short" };
    const mergedForReuse = this.isBuiltinId(userId) ? { ...u, ...this._getBuiltinUser(userId) } : u;
    if (await this._wouldReusePassword(mergedForReuse, newPassword)) return { ok: false, msg: "password-reuse" };
    this._pushPasswordHistoryBeforeChange(u);
    u.salt = this._salt();
    u.passwordHash = await this._hash(newPassword, u.salt);
    this.saveUsers();
    this.logAudit("auth.user.password", u.username);
    return { ok: true };
  },


  deleteUser(userId) {
    if (!this.isAdmin()) return;
    if (this.isBuiltinId(userId)) return;
    const u = this.getUserById(userId);
    if (!u || u.id === this.sessionUserId) return;
    if (u.role === "admin" && this.users.filter(x => x.role === "admin").length <= 1) return;
    this.users = this.users.filter(x => x.id !== userId);
    this.saveUsers();
    this.logAudit("auth.user.delete", u.username);
  },

  denyEditToast() {
    Utils.showToast(I18n.t("auth.noPermission"), "warning");
  },


  showLoginGate(show) {
    const gate = document.getElementById("login-gate");
    if (gate) gate.classList.toggle("login-gate--hidden", !show);
    if (show) gate?.classList.remove("login-gate--hidden");
  },

  updateUserBar() {
    const bar = document.getElementById("session-user-bar");
    if (!bar) return;
    const u = this.getCurrentUser();
    if (!u) {
      bar.style.display = "none";
      return;
    }
    bar.style.display = "";
    const nameEl = document.getElementById("session-user-name");
    const roleEl = document.getElementById("session-user-role");
    if (nameEl) nameEl.textContent = u.displayName || u.username;
    if (roleEl) {
      if (u.role === "admin") {
        roleEl.textContent = I18n.t("auth.roleAdmin");
      } else if (this.isElevated()) {
        let untilLabel = "";
        try {
          const sess = JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSION) || "{}");
          if (sess.elevatedUntil) {
            untilLabel = Utils.formatDateTime(sess.elevatedUntil);
          }
        } catch (e) {
          /* ignore */
        }
        roleEl.textContent = untilLabel
          ? `${I18n.t("auth.roleElevated")} — ${untilLabel}`
          : I18n.t("auth.roleElevated");
      } else {
        const permCount = u.permissions ? Object.values(u.permissions).filter(Boolean).length : 0;
        roleEl.textContent = permCount > 0 ? I18n.t("auth.roleEditor") : I18n.t("auth.roleViewer");
      }
    }
    const redeemBtn = document.getElementById("session-redeem-elevation-btn");
    if (redeemBtn) {
      redeemBtn.style.display = u.role === "admin" ? "none" : "";
      redeemBtn.disabled = false;
    }
  },

  openProfileModal(targetUserId) {
    if (!this.isAdmin()) {
      this.denyEditToast();
      return;
    }
    const target = targetUserId ? this.getUserById(targetUserId) : this.getCurrentUser();
    if (!target) return;
    const modal = document.getElementById("profile-modal");
    if (!modal) return;
    modal.dataset.targetUserId = target.id;
    document.getElementById("profile-username").value = target.username || "";
    document.getElementById("profile-display").value = target.displayName || "";
    document.getElementById("profile-new-pw").value = "";
    const tplSel = document.getElementById("profile-template");
    if (tplSel && this.getUserCreationTemplates) {
      const opts = this.getUserCreationTemplates();
      tplSel.innerHTML =
        `<option value="">${Utils.escapeHtml(I18n.t("auth.template.none"))}</option>` +
        opts
          .map(t => {
            const hint = t.hintKey ? Utils.escapeAttr(I18n.t(t.hintKey)) : "";
            const titleAttr = hint ? ` title="${hint}"` : "";
            return `<option value="${Utils.escapeAttr(t.key)}"${titleAttr}>${Utils.escapeHtml(I18n.t(t.i18nKey))}</option>`;
          })
          .join("");
      tplSel.value = "";
      tplSel.disabled = target.role === "admin";
    }
    const errEl = document.getElementById("profile-error");
    if (errEl) { errEl.textContent = ""; errEl.style.display = "none"; }
    const titleEl = modal.querySelector("[data-i18n='auth.editProfile']");
    if (titleEl) titleEl.textContent = `${I18n.t("auth.editProfile")} — ${target.displayName || target.username}`;
    modal.classList.add("active");
  },

  async updateUserProfile(targetUserId, { username, displayName, newPassword }) {
    if (!this.isAdmin()) return { ok: false, msg: "forbidden" };
    this.loadUsers();
    const idx = this.users.findIndex(x => x.id === targetUserId);
    if (idx < 0) return { ok: false, msg: "not-found" };
    const u = this.users[idx];

    if (username !== undefined) {
      const un = (username || "").trim();
      if (un.length < 2) return { ok: false, msg: "short" };
      const dup = this.getUserByUsername(un);
      if (dup && dup.id !== u.id) return { ok: false, msg: "dup" };
      if (this.reservedBuiltinUsername(un) && String(un).toLowerCase() !== String(u.username || "").toLowerCase()) {
        return { ok: false, msg: "reserved" };
      }
      u.username = un;
    }
    if (displayName !== undefined) {
      u.displayName = (displayName || "").trim() || u.username;
    }
    if (newPassword) {
      if (newPassword.length < 6) return { ok: false, msg: "short" };
      const mergedForReuse = this.isBuiltinId(targetUserId) ? { ...u, ...this._getBuiltinUser(targetUserId) } : u;
      if (await this._wouldReusePassword(mergedForReuse, newPassword)) return { ok: false, msg: "password-reuse" };
      this._pushPasswordHistoryBeforeChange(u);
      u.salt = this._salt();
      u.passwordHash = await this._hash(newPassword, u.salt);
    }

    if (arguments?.[1] && Object.prototype.hasOwnProperty.call(arguments[1], "templateKey")) {
      const templateKey = arguments[1].templateKey;
      if (u.role === "admin") return { ok: false, msg: "forbidden" };
      if (templateKey) {
        const tpl = this._buildUserTemplatePayload(templateKey);
        if (!tpl) return { ok: false, msg: "bad-template" };
        u.role = tpl.role;
        u.canEdit = !!tpl.canEdit;
        u.permissionMatrix = tpl.permissionMatrix;
        u.permissionActionMatrix = tpl.permissionActionMatrix;
        u.permissions = this.deriveLegacyPermissionsFromMatrix(u.permissionMatrix);
      }
    }

    this.saveUsers();
    this.logAudit("auth.user.update", u.username);
    this.updateUserBar();
    return { ok: true };
  },

  applyPermissions() {
    const admin = this.isAdmin();
    const elevated = this.isElevated();
    const edit = this.canEdit();
    const mx = this.getSessionMatrix();
    document.body.classList.toggle("auth-no-edit", !edit);
    document.body.classList.toggle("auth-admin", admin);
    document.body.classList.toggle("auth-elevated", elevated);

    this.PERMISSIONS.forEach(p => {
      document.body.classList.toggle(`auth-no-${p}`, !this.hasPerm(p));
    });

    const tabIds = [
      ["dashboard", "tabDashboard"],
      ["reminders", "tabReminders"],
      ["inventory", "tabInventory"],
      ["movements", "tabMovements"],
      ["history", "tabHistory"],
      ["transport", "tabTransport"],
      ["orderlines", "tabOrderlines"],
      ["receptions", "receptionsEdit"]
    ];
    tabIds.forEach(([tid, key]) => {
      document.body.classList.toggle(`auth-tab-hide-${tid}`, mx[key] === "none");
    });
    document.body.classList.toggle("auth-no-dashboardAlerts", mx.dashboardAlerts === "none");
    document.body.classList.toggle("auth-dashboardAlerts-viewonly", mx.dashboardAlerts === "view");
    document.body.classList.toggle("auth-inv-full-insights", this.hasFullInventoryInsightWidgets());

    const cfgUsersBtn = document.querySelector('[data-config-tab="users"]');
    if (cfgUsersBtn) cfgUsersBtn.style.display = admin ? "" : "none";

    this.syncConfigActionDomState();

    if (typeof RemindersManager !== "undefined" && RemindersManager.refreshAll) {
      RemindersManager.refreshAll();
    }

    if (typeof HistoryManager !== "undefined" && HistoryManager.applyMaterialReceptionHistoryLock) {
      HistoryManager.applyMaterialReceptionHistoryLock();
    }

    if (typeof Dashboard !== "undefined" && typeof Dashboard.refresh === "function") {
      Dashboard.refresh();
    }

    this.updateUserBar();
  },

  bindElevationRedeemUI() {
    const btn = document.getElementById("session-redeem-elevation-btn");
    const modal = document.getElementById("elevation-redeem-modal");
    const closeBtn = document.getElementById("close-elevation-redeem");
    const form = document.getElementById("elevation-redeem-form");
    const input = document.getElementById("elevation-redeem-input");
    const errEl = document.getElementById("elevation-redeem-error");

    const close = () => {
      if (modal) modal.classList.remove("active");
      if (input) input.value = "";
      if (errEl) {
        errEl.textContent = "";
        errEl.style.display = "none";
      }
    };

    if (btn && modal) {
      btn.addEventListener("click", () => {
        if (this.isAdmin()) return;
        modal.classList.add("active");
        setTimeout(() => input?.focus(), 50);
      });
    }
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (form) {
      form.addEventListener("submit", async e => {
        e.preventDefault();
        if (errEl) {
          errEl.textContent = "";
          errEl.style.display = "none";
        }
        const raw = input?.value ?? "";
        const r = await this.redeemElevationCode(raw);
        if (!r.ok) {
          const key =
            r.msg === "invalid"
              ? "elevation.redeemInvalid"
              : r.msg === "already-used"
                ? "elevation.codeAlreadyUsed"
                : r.msg === "wrong-recipient"
                  ? "elevation.wrongRecipient"
                  : r.msg === "expired"
                    ? "elevation.codeExpired"
                    : r.msg === "admin-no-need"
                      ? "elevation.redeemAdminSkip"
                      : r.msg === "empty"
                        ? "elevation.redeemEmpty"
                        : "elevation.redeemError";
          if (errEl) {
            errEl.textContent = I18n.t(key);
            errEl.style.display = "block";
          }
          return;
        }
        close();
        Utils.showToast(I18n.t("elevation.redeemOk"), "success");
      });
    }
  },

  bindLoginForm() {
    const gate = document.getElementById("login-gate");
    const formLogin = document.getElementById("login-form-standard");
    const err = document.getElementById("login-error");
    const btnOut = document.getElementById("session-logout-btn");

    const showErr = key => {
      if (err) {
        err.textContent = key ? I18n.t(key) : "";
        err.style.display = key ? "block" : "none";
      }
    };

    this.loadUsers();
    this.bindElevationRedeemUI();
    if (formLogin) formLogin.style.display = "block";

    if (formLogin) {
      formLogin.addEventListener("submit", async e => {
        e.preventDefault();
        showErr("");
        const u = document.getElementById("login-username")?.value || "";
        const p = document.getElementById("login-password")?.value || "";
        const r = await this.login(u, p);
        if (!r.ok) {
          showErr(r.msg === "error" ? "auth.loginUnavailable" : "auth.badCredentials");
          return;
        }
        this.enterApp();
      });
    }

    const forgotBtn = document.getElementById("login-forgot-btn");
    const recoveryModal = document.getElementById("login-recovery-modal");
    const closeRecovery = document.getElementById("close-login-recovery-modal");
    if (forgotBtn && recoveryModal) {
      forgotBtn.addEventListener("click", () => recoveryModal.classList.add("active"));
    }
    if (closeRecovery && recoveryModal) {
      closeRecovery.addEventListener("click", () => recoveryModal.classList.remove("active"));
    }

    if (btnOut) btnOut.addEventListener("click", () => this.logout());

    const profileForm = document.getElementById("profile-edit-form");
    if (profileForm) {
      profileForm.addEventListener("submit", async e => {
        e.preventDefault();
        if (!this.isAdmin()) { this.denyEditToast(); return; }
        const errEl = document.getElementById("profile-error");
        const showErr = msg => { if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? "block" : "none"; } };
        showErr("");

        const modal = document.getElementById("profile-modal");
        const targetId = modal?.dataset?.targetUserId || this.getUserId();
        const username = document.getElementById("profile-username")?.value || "";
        const displayName = document.getElementById("profile-display")?.value || "";
        const newPw = document.getElementById("profile-new-pw")?.value || "";
        const templateKey = document.getElementById("profile-template")?.value || "";

        const patch = { username, displayName };
        if (newPw) patch.newPassword = newPw;
        if (templateKey) patch.templateKey = templateKey;

        const r = await this.updateUserProfile(targetId, patch);
        if (!r.ok) {
          const msgs = {
            "forbidden": "auth.noPermission",
            "dup": "auth.userDuplicate",
            "short": "auth.fieldsInvalid",
            "not-found": "auth.error",
            "password-reuse": "auth.passwordReuse",
            "reserved": "auth.reservedUsername",
            "bad-template": "auth.userTemplateInvalid"
          };
          showErr(I18n.t(msgs[r.msg] || "auth.error"));
          return;
        }
        document.getElementById("profile-new-pw").value = "";
        modal?.classList.remove("active");
        Utils.showToast(I18n.t("auth.profileUpdated"), "success");
        if (typeof ConfigManager !== "undefined" && ConfigManager.renderUsersTable) ConfigManager.renderUsersTable();
      });
    }
    const closeProfile = document.getElementById("close-profile-modal");
    if (closeProfile) closeProfile.addEventListener("click", () => {
      document.getElementById("profile-modal")?.classList.remove("active");
    });

    if (gate) {
      I18n.updateUI();
      gate.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        if (key) el.textContent = I18n.t(key);
      });
      gate.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        const key = el.getAttribute("data-i18n-placeholder");
        if (key) el.placeholder = I18n.t(key);
      });
    }
  },

  // =========================================================
  // Fondo del login: lista desde assets/login-bg-manifest.json
  // =========================================================
  async refreshLoginBackgroundUrls() {
    let urls = [];
    try {
      const r = await fetch("assets/login-bg-manifest.json", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json();
        const raw = Array.isArray(j) ? j : j && Array.isArray(j.images) ? j.images : [];
        urls = raw
          .map(s => String(s || "").trim())
          .filter(s => /^assets\/[^<>"]+$/i.test(s) && /\.(jpe?g|png|gif|webp)$/i.test(s));
      }
    } catch (e) {
      /* manifest opcional */
    }
    if (!urls.length) urls = ["assets/logo.png"];
    this.BG_IMAGES = urls;
  },

  /** Ruta segura para CSS url() (espacios y caracteres especiales en nombres de archivo). */
  _loginBgUrl(path) {
    const p = String(path || "").trim();
    return p && /^assets\//i.test(p) ? encodeURI(p) : p;
  },

  startBgRotation() {
    if (!this.BG_IMAGES.length) return;
    const gate = document.getElementById("login-gate");
    const apply = () => {
      if (!gate || !this.BG_IMAGES.length) return;
      const n = this.BG_IMAGES.length;
      if (n > 1) {
        let next;
        do {
          next = Math.floor(Math.random() * n);
        } while (next === this._bgIndex);
        this._bgIndex = next;
      }
      const u = this._loginBgUrl(this.BG_IMAGES[this._bgIndex]);
      gate.style.backgroundImage = u ? `url('${u}')` : "";
    };
    this._bgIndex = Math.floor(Math.random() * this.BG_IMAGES.length);
    if (gate) {
      const u0 = this._loginBgUrl(this.BG_IMAGES[this._bgIndex]);
      if (u0) gate.style.backgroundImage = `url('${u0}')`;
    }
    if (this._bgTimer) clearInterval(this._bgTimer);
    if (this.BG_IMAGES.length > 1) {
      this._bgTimer = setInterval(() => apply(), 12000);
    }
  },

  enterApp() {
    const gate = document.getElementById("login-gate");
    /* Splash primero (encima del login, z-index mayor): evita un frame de la
       app visible antes de la cinemática. Luego se oculta el gate e inicia la app debajo. */
    this.showWelcomeSplash();
    if (gate) gate.classList.add("login-gate--hidden");
    /* Paramos el carrusel de fondos del login: ya no se ve y mantenerlo
       activo cada 12 s es CPU/IO desperdiciada que además impide al
       navegador suspender la pestaña en background. */
    if (this._bgTimer) {
      clearInterval(this._bgTimer);
      this._bgTimer = null;
    }
    /* La inicialización pesada (Inventory, Movements, History…) corre en
       segundo plano detrás del splash. No la bloqueamos: el splash dura
       lo que marque `--welcome-duration` en CSS y entonces se oculta. */
    App.initApplication();
    this.applyPermissions();
  },

  /**
   * Pantalla de bienvenida cinemática: saluda al usuario (`displayName` o
   * `username`) con scanline + neón + barra de progreso. La duración la lee
   * el JS desde `--welcome-duration` en CSS (una sola fuente de verdad).
   * Debe llamarse **antes** de ocultar `#login-gate` en `enterApp()` para que
   * no se vea un destello de la app detrás.
   *
   * - **No bloquea** la carga: `App.initApplication()` corre después, bajo el splash.
   * - **Skip** si `sessionStorage` `gneex-welcome-splash-shown` (misma pestaña).
   * - **Cleanup**: `setTimeout` según `--welcome-duration` (+ margen breve).
   */
  showWelcomeSplash() {
    if (typeof document === "undefined") return;
    const node = document.getElementById("welcome-splash");
    if (!node) return;
    try {
      if (sessionStorage.getItem("gneex-welcome-splash-shown") === "1") return;
      sessionStorage.setItem("gneex-welcome-splash-shown", "1");
    } catch {
      /* sessionStorage podría no estar disponible (file:// estricto): seguimos. */
    }
    const userText = (() => {
      try {
        const u = this.getCurrentUser();
        if (!u) return "";
        const name = (u.displayName || u.username || "").trim();
        if (!name) return "";
        const tpl = (typeof I18n !== "undefined" && I18n.t)
          ? I18n.t("welcome.userGreeting")
          : "";
        return tpl && !tpl.startsWith("welcome.")
          ? tpl.replace("{name}", name)
          : name;
      } catch {
        return "";
      }
    })();
    const userEl = document.getElementById("welcome-splash-user");
    if (userEl) userEl.textContent = userText;
    node.hidden = false;
    node.setAttribute("aria-hidden", "false");
    /* Reinicio de animación: quitar y reaplicar la clase tras un reflujo
       fuerza al navegador a reproducir los keyframes desde 0 incluso si la
       función se llamara varias veces en la misma sesión. */
    node.classList.remove("welcome-splash--running");
    void node.offsetWidth;
    node.classList.add("welcome-splash--running");
    const durMs = (() => {
      try {
        const raw = getComputedStyle(node).getPropertyValue("--welcome-duration").trim();
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) return 6000;
        return raw.endsWith("ms") ? n : n * 1000;
      } catch {
        return 6000;
      }
    })();
    setTimeout(() => {
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
      node.classList.remove("welcome-splash--running");
    }, durMs + 60);
  },

  /**
   * Conserva solo al administrador integrado (Luis), borra el resto de usuarios y recrea las cuentas integradas
   * con los mismos hashes de contraseña y los perfiles definidos en {@link _getBuiltinUser}.
   */
  resetToAdminAndReseedBuiltins() {
    this.loadUsers();
    if (!this.isAdmin()) {
      console.warn("resetToAdminAndReseedBuiltins: inicie sesión como administrador.");
      return { ok: false, msg: "session-not-admin" };
    }
    const admin = this.users.find(u => u.id === "gneex-builtin-1" && u.role === "admin");
    if (!admin) {
      console.warn("resetToAdminAndReseedBuiltins: no existe gneex-builtin-1 como administrador.");
      return { ok: false, msg: "no-builtin-admin" };
    }
    this.users = [JSON.parse(JSON.stringify(admin))];
    this.saveUsers();
    this.ensureBuiltinAccountsSeeded();
    this.loadUsers();
    if (this.sessionUserId) this.applyPermissions();
    console.info("resetToAdminAndReseedBuiltins: listo. Recargue la página si sigue en sesión.");
    return { ok: true };
  },

  /** @deprecated Use {@link resetToAdminAndReseedBuiltins}. */
  resetToAdminAndReseedWideViewBuiltins() {
    return this.resetToAdminAndReseedBuiltins();
  },

  init() {
    void this._initSessionGate();
  },

  async _initSessionGate() {
    this.loadUsers();
    this.ensureBuiltinAccountsSeeded();
    this.loadSession();
    this.bindLoginForm();
    await this.refreshLoginBackgroundUrls();
    this.startBgRotation();
    if (this.validateSession()) {
      this.enterApp();
    } else {
      this.showLoginGate(true);
    }
  }
};
