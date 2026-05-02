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

  /** Cuentas definidas en código (no se crean desde la pantalla de login). */
  BUILTIN_IDS: new Set(["gneex-builtin-1", "gneex-builtin-2", "gneex-builtin-3", "gneex-builtin-4"]),

  isBuiltinId(id) {
    return id && this.BUILTIN_IDS.has(String(id));
  },

  reservedBuiltinUsername(name) {
    const n = (name || "").trim().toLowerCase();
    return n === "goireteluis" || n === "keithl" || n === "guestcmc" || n === "alexb";
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
      this.users.push({
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
      });
      added = true;
      ids.add(seed.id);
    }
    if (added) this.saveUsers();
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
    /* Keith: movimientos, transporte (lectura), recordatorios, pedidos, export solo mov., CSV inventario, caducidad, recepciones. */
    if (id === "gneex-builtin-2") {
      return {
        id: "gneex-builtin-2",
        username: "KeithL",
        displayName: "Keith Lake",
        role: "user",
        canEdit: false,
        permissions: {
          movements: true,
          transport: true,
          reminders: true,
          receptions: true,
          orderLinesEdit: true,
          movementsExport: true,
          loadInventoryCsv: true,
          expirationConfig: true
        },
        builtin: true
      };
    }
    /* Invitado: inventario/movimientos; transporte y pedidos en lectura; sin recordatorios ni export de movimientos. */
    if (id === "gneex-builtin-3") {
      return {
        id: "gneex-builtin-3",
        username: "guestCMC",
        displayName: "Guest",
        role: "user",
        canEdit: false,
        permissions: { movements: true, transport: true },
        builtin: true
      };
    }
    /* Alex: como Keith salvo recepciones y configuración de caducidad en Expiraciones. */
    if (id === "gneex-builtin-4") {
      return {
        id: "gneex-builtin-4",
        username: "AlexB",
        displayName: "Alex Beaulieu",
        role: "user",
        canEdit: false,
        permissions: {
          movements: true,
          transport: true,
          reminders: true,
          orderLinesEdit: true,
          movementsExport: true,
          loadInventoryCsv: true
        },
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
    return this.hasPerm("reminders");
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
    if (this._isBuiltinKeith(u) || this._isBuiltinAlex(u)) return true;
    return this.hasPerm("orderLinesEdit");
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
    if (this.hasMovementsExport()) return true;
    this.denyEditToast();
    return false;
  },

  hasLoadInventoryCsv() {
    return this.hasPerm("loadInventoryCsv");
  },

  guardLoadInventoryCsv() {
    if (this.hasLoadInventoryCsv()) return true;
    this.denyEditToast();
    return false;
  },

  hasExpirationConfig() {
    const u = this.getCurrentUser();
    if (!u) return false;
    if (u.role === "admin") return true;
    if (this._isBuiltinKeith(u)) return true;
    return this.hasPerm("expirationConfig");
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
    if (this._isBuiltinKeith(u)) return true;
    return this.hasPerm("receptions");
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
    if (this.canImportBackup()) return true;
    this.denyEditToast();
    return false;
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

  /** Mutaciones en Transporte (crear, expedir, borrar…): admin o elevación temporal. */
  guardTransportMutation() {
    return this.guardElevatedCapability();
  },

  /** Fusionar movimientos / transportes desde archivo JSON. */
  guardMergeMovementsImport() {
    return this.guardImportExportFeatures();
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

  loadUsers() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USERS);
      this.users = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(this.users)) this.users = [];
      this.users.forEach(u => this.migrateUserPerms(u));
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
    const out = [];
    for (const bid of this.BUILTIN_IDS) {
      if (bid === "gneex-builtin-1") continue;
      const u = this._getBuiltinUser(bid);
      if (u) {
        out.push({
          id: u.id,
          label: `${u.displayName || u.username} (${u.username})`
        });
      }
    }
    for (const u of this.users) {
      if (!u || u.role === "admin") continue;
      out.push({
        id: u.id,
        label: `${u.displayName || u.username} (${u.username})`
      });
    }
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
      const mergedPerms =
        tmpl.role === "admin"
          ? { ...this.defaultPermsForRole("admin") }
          : { ...tmpl.permissions, ...(stored.permissions || {}) };
      const canEdit =
        tmpl.role === "admin" ? true : this.PERMISSIONS.some(k => mergedPerms[k]);
      return {
        ...tmpl,
        ...stored,
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
    /* Export solo movimientos / CSV inicial en Import/Export: cualquier sesión iniciada */
    if (perm === "movementsExport" || perm === "loadInventoryCsv") return true;
    return !!(u.permissions && u.permissions[perm]);
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
    u.canEdit = this.PERMISSIONS.some(k => u.permissions[k]);
    this.saveUsers();
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
    window.location.reload();
  },

  async addUser({ username, displayName, password, role, canEdit }) {
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
    if (canEdit && r2 !== "admin") {
      this.PERMISSIONS.forEach(k => user.permissions[k] = true);
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

    this.saveUsers();
    this.logAudit("auth.user.update", u.username);
    this.updateUserBar();
    return { ok: true };
  },

  applyPermissions() {
    const admin = this.isAdmin();
    const elevated = this.isElevated();
    const edit = this.canEdit();
    document.body.classList.toggle("auth-no-edit", !edit);
    document.body.classList.toggle("auth-admin", admin);
    document.body.classList.toggle("auth-elevated", elevated);

    this.PERMISSIONS.forEach(p => {
      document.body.classList.toggle(`auth-no-${p}`, !this.hasPerm(p));
    });

    const cfgUsersBtn = document.querySelector('[data-config-tab="users"]');
    if (cfgUsersBtn) cfgUsersBtn.style.display = admin ? "" : "none";

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
    if (modal) {
      modal.addEventListener("click", e => {
        if (e.target === modal) close();
      });
    }
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
    if (recoveryModal) {
      recoveryModal.addEventListener("click", e => {
        if (e.target === recoveryModal) recoveryModal.classList.remove("active");
      });
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

        const patch = { username, displayName };
        if (newPw) patch.newPassword = newPw;

        const r = await this.updateUserProfile(targetId, patch);
        if (!r.ok) {
          const msgs = {
            "forbidden": "auth.noPermission",
            "dup": "auth.userDuplicate",
            "short": "auth.fieldsInvalid",
            "not-found": "auth.error",
            "password-reuse": "auth.passwordReuse",
            "reserved": "auth.reservedUsername"
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

  startBgRotation() {
    if (!this.BG_IMAGES.length) return;
    const gate = document.getElementById("login-gate");
    const apply = () => {
      if (!gate || !this.BG_IMAGES.length) return;
      this._bgIndex = (this._bgIndex + 1) % this.BG_IMAGES.length;
      gate.style.backgroundImage = `url('${this.BG_IMAGES[this._bgIndex]}')`;
    };
    this._bgIndex = Math.floor(Math.random() * this.BG_IMAGES.length);
    if (gate) gate.style.backgroundImage = `url('${this.BG_IMAGES[this._bgIndex]}')`;
    if (this._bgTimer) clearInterval(this._bgTimer);
    if (this.BG_IMAGES.length > 1) {
      this._bgTimer = setInterval(() => apply(), 12000);
    }
  },

  enterApp() {
    const gate = document.getElementById("login-gate");
    if (gate) gate.classList.add("login-gate--hidden");
    App.initApplication();
    this.applyPermissions();
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
