// utils.js — núcleo actualizado G-NEEX

const STORAGE_KEYS = {
    INVENTORY: 'phoenix-inventory',
    STANDALONE_BOXES: 'phoenix-standalone-boxes',
    PURCHASES: 'phoenix-purchases',
    MOVEMENTS: 'phoenix-movements',
    TRANSPORT: 'phoenix-transport',
    PENDING_ELEC_OBRA: 'phoenix-pending-elec-obra',
    /** M.E. producción en cola hasta existir transporte/lista para el mismo proyecto. */
    PENDING_ELEC_PROD: 'phoenix-pending-elec-prod',
    PURCHASE_ORDERS: 'phoenix-purchase-orders',
    ORDER_LINES: 'phoenix-order-lines',
    ITEM_EDIT_PIN: 'phoenix-item-edit-pin',
    RECEPTIONS: 'phoenix-receptions',
    THEME: 'phoenix-theme',
    /** Acentos azules y sandbox de demostración (boolean en localStorage). */
    TEST_MODE: 'phoenix-test-mode',
    /** Instantánea JSON de todo localStorage (excepto meta) al activar modo prueba; se restaura al desactivar. */
    TEST_DEMO_SNAPSHOT: 'phoenix-test-demo-snapshot-v1',
    LANG: 'phoenix-lang',
    USERS: 'phoenix-users',
    SESSION: 'phoenix-session',
    AUDIT: 'phoenix-audit',
    /** Contador global histórico (solo dígitos); ya no lo usa generateRef; se conserva por compatibilidad con respaldos antiguos. */
    SEQ_MOVEMENT_REF: 'phoenix-seq-movement-ref',
    /** JSON `{ "AJUSTE": 12, "COMPRA_STOCK": 3, ... }` máximo correlativo por tipo para referencias con prefijo. */
    SEQ_MOVEMENT_REF_BY_TYPE: 'phoenix-seq-movement-ref-by-type',
    SEQ_ENTITY_ID: 'phoenix-seq-entity-id',
    REMINDERS: 'phoenix-reminders',
    /** Líneas pendientes de Consumo diario (un solo movimiento al procesar). */
    CONSUMO_CART: 'phoenix-consumo-cart',
    /** Fecha local (YYYY-MM-DD) en que ya se ejecutó el cierre automático de consumo (23:00). */
    CONSUMO_AUTO_DAY: 'phoenix-consumo-auto-day',
    /** Globos flotantes ocultados por el usuario hasta volver a elegir el tipo. */
    FLOAT_STANDBY_DISMISSED: 'phoenix-float-standby-dismissed',
    FLOAT_CONSUMO_DISMISSED: 'phoenix-float-consumo-dismissed',
    /** Último día local (YYYY-MM-DD) en que se guardó cierre de pestaña (pagehide); detecta “pasó la noche” con carrito pendiente. */
    LAST_APP_SESSION_DAY: 'phoenix-app-last-session-day',
    /** Último día local en que el carrito de consumo tenía líneas (cierra huecos sin pagehide). */
    CONSUMO_CART_ACTIVITY_DAY: 'phoenix-consumo-cart-activity-day',
    /** Posición arrastrada de los globos (JSON { l, t } en px). */
    FLOAT_STANDBY_POS: 'phoenix-float-pos-standby',
    FLOAT_CONSUMO_POS: 'phoenix-float-pos-consumo',
    /** Posiciones de borradores minimizados arrastrables (movimientos / configuración). */
    FLOAT_DRAFT_MOVEMENT_POS: 'phoenix-float-pos-draft-movement',
    FLOAT_DRAFT_CONFIG_POS: 'phoenix-float-pos-draft-config',
    /** Lista maestra de empleados (destinatarios en Consumo diario). */
    EMPLOYEES: 'phoenix-employees',
    /** Destinatarios ocasionales / externos (no plantilla). Misma lógica de respaldo que empleados. */
    OCCASIONAL_RECIPIENTS: 'phoenix-occasional-recipients',
    /** Lista maestra de proveedores (pedidos / referencia). */
    SUPPLIERS: 'phoenix-suppliers',
    /** Artículos consumibles (solo constancia de recepción COMPRA, sin stock). */
    CONSUMABLES: 'phoenix-consumables',
    /** Umbral de días para avisos de caducidad en inventario (Configuración). */
    EXP_ALERT: 'phoenix-exp-alert',
    /** Preferencia de vista del historial (tiles | list | details). */
    VIEW_HISTORY_UI: 'phoenix-view-history-ui',
    /** Preferencia de vista del panel transporte (tiles | list). */
    VIEW_TRANSPORT_UI: 'phoenix-view-transport-ui',
    /** Preferencia de vista del panel pedidos (table | tiles). */
    VIEW_ORDERLINES_UI: 'phoenix-view-orderlines-ui',
    /** Cola ME eléctrico reconocido antes de existir movimientos en G-NEEX + historial de salidas registradas. */
    ME_LEGACY: 'phoenix-me-legacy',
    /** Pool de códigos de elevación temporal (solo admin emite; JSON por tier). */
    ELEVATION_POOL: 'phoenix-elevation-pool',
    /** Catálogo editable de ubicaciones de almacén (se suma al catálogo base). */
    LOCATION_CATALOG: 'phoenix-location-catalog',
    /** Ubicaciones base desactivadas por el usuario (no se muestran ni se detectan). */
    LOCATION_CATALOG_BASE_DISABLED: 'phoenix-location-catalog-base-disabled',
    /** Ubicaciones custom desactivadas por el usuario (no se muestran ni se detectan). */
    LOCATION_CATALOG_CUSTOM_DISABLED: 'phoenix-location-catalog-custom-disabled',
    /** Códigos emitidos por admin pendientes de canje. */
    ELEVATION_OUTSTANDING: 'phoenix-elevation-outstanding',
    /** Códigos de elevación ya canjeados (no reutilizables). */
    ELEVATION_CONSUMED: 'phoenix-elevation-consumed',
    /** Destino al pulsar pestaña principal: same | tab | window */
    NAV_OPEN_TARGET: 'phoenix-nav-open-target',
    /** Tamaños manuales de ventanas/modales (ancho/alto por id de ventana). */
    MODAL_LAYOUTS: 'phoenix-modal-layouts',
    /** Anchos manuales de columnas de tablas (array de px por tabla). */
    TABLE_COLUMN_LAYOUTS: 'phoenix-table-column-layouts'
};

// ===========================
// TIPOS DE MOVIMIENTOS
// ===========================
const MOVEMENT_TYPES = {
    AJUSTE: { id:'AJUSTE', color:'#ff69b4', behavior:'any', target:'main', multiTarget:true, projectRequired:false, icon:'⚖️' },
    CONSUMO_DIARIO:{ id:'CONSUMO_DIARIO', color:'#c71585', behavior:'negative', target:'main', multiTarget:false, projectRequired:false, icon:'📅' },
    FERRETERIA:{ id:'FERRETERIA', color:'#40e0d0', behavior:'negative', target:'main', multiTarget:true, projectRequired:true, icon:'🔧' },
    ESPECIAL:{ id:'ESPECIAL', color:'#ffd700', behavior:'negative', target:'main', projectRequired:false, icon:'⭐' },
    LISTA_CHEQUEO:{ id:'LISTA_CHEQUEO', color:'#ffff00', behavior:'negative', target:'main', projectRequired:true, icon:'✅' },
    MERMA:{ id:'MERMA', color:'#dc3545', behavior:'negative', target:'main', multiTarget:true, projectRequired:true, icon:'📉' },
    RETORNO:{ id:'RETORNO', color:'#808080', behavior:'positive', target:'main', projectRequired:false, icon:'↩️' },
    DESMANTELAR:{ id:'DESMANTELAR', color:'#00008b', behavior:'positive', target:'main', projectRequired:true, icon:'🔨' },
    TRANSFERENCIA:{ id:'TRANSFERENCIA', color:'#8a2be2', behavior:'any', target:'main', multiTarget:true, projectRequired:false, icon:'🔄' },
    TRANSFORMACION:{ id:'TRANSFORMACION', color:'#98fb98', behavior:'negative', target:'transformation', multiTarget:true, projectRequired:false, icon:'🎨' },
    ENVIAR_PRODUCCION:{ id:'ENVIAR_PRODUCCION', color:'#ff6b35', behavior:'negative', target:'production', multiTarget:true, projectRequired:false, icon:'🏭' },
    MAT_ELEC_PROD:{ id:'MAT_ELEC_PROD', color:'#00ff00', behavior:'negative', target:'main', multiTarget:true, projectRequired:true, icon:'⚡' },
    MAT_ELEC_OBRA:{ id:'MAT_ELEC_OBRA', color:'#6b8e23', behavior:'negative', target:'main', multiTarget:true, projectRequired:true, icon:'🔌' },
    STANDBY:{ id:'STANDBY', color:'#708090', behavior:'any', target:'main', multiTarget:true, projectRequired:false, icon:'⏸️' },
    COMPRA_STOCK:{ id:'COMPRA_STOCK', color:'#f5f5f5', behavior:'positive', target:'main', multiTarget:false, projectRequired:false, icon:'🛒', specialForm:'compra' },
    RECEPCION_MATERIAL:{ id:'RECEPCION_MATERIAL', color:'#e9967a', behavior:'reception', target:'main', multiTarget:false, projectRequired:true, icon:'📥', specialForm:'recepcion' }
};

/** Siglas visibles en la referencia del movimiento + número correlativo por tipo (p. ej. AJU00000001). */
const MOVEMENT_REF_PREFIX = {
    AJUSTE: 'AJU',
    CONSUMO_DIARIO: 'CDI',
    FERRETERIA: 'FER',
    ESPECIAL: 'ESP',
    LISTA_CHEQUEO: 'LCH',
    MERMA: 'MER',
    RETORNO: 'RET',
    DESMANTELAR: 'DES',
    TRANSFERENCIA: 'TRF',
    TRANSFORMACION: 'TRN',
    ENVIAR_PRODUCCION: 'EVP',
    MAT_ELEC_PROD: 'MEP',
    MAT_ELEC_OBRA: 'MEO',
    STANDBY: 'STB',
    COMPRA_STOCK: 'COM',
    RECEPCION_MATERIAL: 'REM'
};

const MOVEMENT_REF_PREFIX_TO_TYPE = Object.fromEntries(
    Object.entries(MOVEMENT_REF_PREFIX).map(([typ, pre]) => [pre, typ])
);

/** Cantidad de dígitos numéricos tras las 3 siglas del tipo (p. ej. AJU123456). */
const MOVEMENT_REF_NUM_DIGITS = 6;

function formatMovementRefNumericPart(num) {
    let n = Math.abs(Math.trunc(Number(num)));
    if (!Number.isFinite(n)) n = 0;
    const cap = Math.pow(10, MOVEMENT_REF_NUM_DIGITS);
    if (n >= cap) n = n % cap;
    return String(n).padStart(MOVEMENT_REF_NUM_DIGITS, "0");
}

// ===========================
// UTILIDADES
// ===========================
const Utils = {
    /** Dígitos del correlativo (3 letras de tipo + este ancho). */
    MOVEMENT_REF_NUM_DIGITS,
    _loadMovementRefCounters() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.SEQ_MOVEMENT_REF_BY_TYPE);
            const o = raw ? JSON.parse(raw) : {};
            return o && typeof o === 'object' ? o : {};
        } catch (e) {
            return {};
        }
    },

    _saveMovementRefCounters(obj) {
        localStorage.setItem(STORAGE_KEYS.SEQ_MOVEMENT_REF_BY_TYPE, JSON.stringify(obj));
    },

    /**
     * Referencia de movimiento: siglas del tipo + dígitos correlativos **por tipo** (p. ej. AJU000001).
     * Datos antiguos con más dígitos se normalizan al cargar/importar.
     */
    generateRef(movType) {
        const typeKey = movType || 'AJUSTE';
        let prefix = MOVEMENT_REF_PREFIX[typeKey];
        if (!prefix) {
            prefix = String(typeKey)
                .replace(/[^A-Za-z]/g, '')
                .toUpperCase()
                .slice(0, 3)
                .padEnd(3, 'X');
        }
        const counters = this._loadMovementRefCounters();
        const prev = parseInt(counters[typeKey], 10) || 0;
        const next = prev + 1;
        counters[typeKey] = next;
        this._saveMovementRefCounters(counters);
        return `${prefix}${formatMovementRefNumericPart(next)}`;
    },

    /** Sincroniza contadores por tipo con referencias ya guardadas (importación, migración). */
    syncMovementRefCounterFromMovements(movements) {
        const counters = {};
        (movements || []).forEach(m => {
            const ref = String(m.reference || '').trim();
            const typ = m.type || '';
            if (!ref || !typ) return;

            const prefMatch = ref.match(/^([A-Z]{2,6})(\d+)$/i);
            if (prefMatch) {
                const pre = prefMatch[1].toUpperCase();
                const n = parseInt(prefMatch[2], 10);
                if (!Number.isFinite(n)) return;
                const t = MOVEMENT_REF_PREFIX_TO_TYPE[pre] || typ;
                if (!counters[t] || n > counters[t]) counters[t] = n;
                return;
            }
            const hyphenMatch = ref.match(/^([A-Z]{2,6})-(\d+)$/i);
            if (hyphenMatch) {
                const pre = hyphenMatch[1].toUpperCase();
                const n = parseInt(hyphenMatch[2], 10);
                if (!Number.isFinite(n)) return;
                const t = MOVEMENT_REF_PREFIX_TO_TYPE[pre] || typ;
                if (!counters[t] || n > counters[t]) counters[t] = n;
                return;
            }
            const digits = ref.replace(/\D/g, '');
            if (!digits) return;
            const n = parseInt(digits, 10);
            if (!Number.isFinite(n)) return;
            if (!counters[typ] || n > counters[typ]) counters[typ] = n;
        });
        this._saveMovementRefCounters(counters);
    },

    /**
     * Referencias importadas o legado (solo dígitos, COM-001, prefijo que no coincide con el tipo): formato PREFIX + dígitos según `movType`.
     */
    normalizeMovementReference(movType, reference) {
        const typeKey = movType || "AJUSTE";
        let prefix = MOVEMENT_REF_PREFIX[typeKey];
        if (!prefix) {
            prefix = String(typeKey)
                .replace(/[^A-Za-z]/g, "")
                .toUpperCase()
                .slice(0, 3)
                .padEnd(3, "X");
        }
        let refStr = String(reference ?? "").trim();
        if (refStr.startsWith("#")) refStr = refStr.slice(1).trim();
        if (!refStr) return String(reference ?? "").trim();

        let m = refStr.match(new RegExp(`^${prefix}(\\d+)$`, "i"));
        if (m) {
            const num = parseInt(m[1], 10);
            if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
        }
        m = refStr.match(/^([A-Z]{2,6})(\d+)$/i);
        if (m) {
            const num = parseInt(m[2], 10);
            if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
        }
        m = refStr.match(/^([A-Z]{2,6})-(\d+)$/i);
        if (m) {
            const num = parseInt(m[2], 10);
            if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
        }
        const digits = refStr.replace(/\D/g, "");
        if (digits) {
            const num = parseInt(digits, 10);
            if (Number.isFinite(num)) return `${prefix}${formatMovementRefNumericPart(num)}`;
        }
        return refStr;
    },

    /**
     * Aplica {@link Utils.normalizeMovementReference} a cada movimiento (muta el array).
     * @returns {{ changed: boolean, refMap: Record<string, string> }} `refMap`: referencia antigua → nueva (solo cambios).
     */
    applyImportedMovementReferencePrefixing(movements) {
        /** @type {Record<string, string>} */
        const refMap = {};
        if (!Array.isArray(movements)) return { changed: false, refMap };
        let changed = false;
        for (const mov of movements) {
            if (!mov || typeof mov !== "object") continue;
            const typ = mov.type || "AJUSTE";
            const oldR = mov.reference;
            const newR = this.normalizeMovementReference(typ, oldR);
            if (newR !== oldR) {
                mov.reference = newR;
                changed = true;
                if (oldR != null && String(oldR) !== "") refMap[String(oldR)] = newR;
            }
        }
        return { changed, refMap };
    },

    /**
     * Cuando cambia `movement.reference`, actualiza `ref` en transportes y colas que apuntaban al texto antiguo.
     * Si `optionalBackupData` es el objeto `data` de un respaldo JSON importado, lo muta antes de escribir en localStorage.
     */
    patchLinkedRefsAfterMovementRefMigrate(refMap, optionalBackupData = null) {
        if (!refMap || typeof refMap !== "object") return;
        const keys = Object.keys(refMap);
        if (!keys.length) return;

        const patchTransportArr = ts => {
            if (!Array.isArray(ts)) return false;
            let ch = false;
            ts.forEach(t => {
                ["checklistRefs", "elecObraRefs", "elecProdRefs"].forEach(k => {
                    (t[k] || []).forEach(r => {
                        if (r && r.ref != null && Object.prototype.hasOwnProperty.call(refMap, String(r.ref))) {
                            r.ref = refMap[String(r.ref)];
                            ch = true;
                        }
                    });
                });
            });
            return ch;
        };

        const patchPendingRoot = root => {
            if (!root || typeof root !== "object") return false;
            let ch = false;
            Object.keys(root).forEach(pid => {
                const arr = root[pid];
                if (!Array.isArray(arr)) return;
                arr.forEach(entry => {
                    if (entry && entry.ref != null && Object.prototype.hasOwnProperty.call(refMap, String(entry.ref))) {
                        entry.ref = refMap[String(entry.ref)];
                        ch = true;
                    }
                });
            });
            return ch;
        };

        const patchOrderLinesArr = lines => {
            if (!Array.isArray(lines)) return false;
            let ch = false;
            lines.forEach(line => {
                if (
                    line &&
                    line.movementRef != null &&
                    Object.prototype.hasOwnProperty.call(refMap, String(line.movementRef))
                ) {
                    line.movementRef = refMap[String(line.movementRef)];
                    ch = true;
                }
            });
            return ch;
        };

        const patchMeLegacyParsed = o => {
            if (!o || typeof o !== "object") return false;
            let ch = false;
            if (o.version === 3 && Array.isArray(o.rows)) {
                o.rows.forEach(r => {
                    if (!r || typeof r !== "object") return;
                    if (Array.isArray(r.linkedReferences)) {
                        r.linkedReferences = r.linkedReferences.map(ref => {
                            if (ref != null && Object.prototype.hasOwnProperty.call(refMap, String(ref))) {
                                ch = true;
                                return refMap[String(ref)];
                            }
                            return ref;
                        });
                    }
                    if (
                        r.lastMovementRef != null &&
                        Object.prototype.hasOwnProperty.call(refMap, String(r.lastMovementRef))
                    ) {
                        r.lastMovementRef = refMap[String(r.lastMovementRef)];
                        ch = true;
                    }
                });
            }
            if (Array.isArray(o.expeditions)) {
                o.expeditions.forEach(e => {
                    if (!e || typeof e !== "object") return;
                    if (Array.isArray(e.linkedReferences)) {
                        e.linkedReferences = e.linkedReferences.map(ref => {
                            if (ref != null && Object.prototype.hasOwnProperty.call(refMap, String(ref))) {
                                ch = true;
                                return refMap[String(ref)];
                            }
                            return ref;
                        });
                    }
                });
            }
            return ch;
        };

        if (optionalBackupData && typeof optionalBackupData === "object") {
            const d = optionalBackupData;
            const patchKey = (storageKey, mutator) => {
                const raw = d[storageKey];
                if (raw == null || typeof raw !== "string") return;
                try {
                    const parsed = JSON.parse(raw);
                    if (mutator(parsed)) d[storageKey] = JSON.stringify(parsed);
                } catch (e) {
                    /* noop */
                }
            };
            patchKey(STORAGE_KEYS.TRANSPORT, x => patchTransportArr(x));
            patchKey(STORAGE_KEYS.PENDING_ELEC_OBRA, x => patchPendingRoot(x));
            patchKey(STORAGE_KEYS.PENDING_ELEC_PROD, x => patchPendingRoot(x));
            patchKey(STORAGE_KEYS.ORDER_LINES, x => patchOrderLinesArr(x));
            patchKey(STORAGE_KEYS.ME_LEGACY, x => patchMeLegacyParsed(x));
            return;
        }

        try {
            const rawT = localStorage.getItem(STORAGE_KEYS.TRANSPORT);
            if (rawT) {
                const ts = JSON.parse(rawT);
                if (patchTransportArr(ts)) localStorage.setItem(STORAGE_KEYS.TRANSPORT, JSON.stringify(ts));
            }
        } catch (e) {
            console.warn("patchLinkedRefs transport", e);
        }

        try {
            const patchPendingLs = key => {
                const raw = localStorage.getItem(key);
                if (!raw) return;
                const o = JSON.parse(raw);
                if (patchPendingRoot(o)) localStorage.setItem(key, JSON.stringify(o));
            };
            patchPendingLs(STORAGE_KEYS.PENDING_ELEC_OBRA);
            patchPendingLs(STORAGE_KEYS.PENDING_ELEC_PROD);
        } catch (e) {
            console.warn("patchLinkedRefs pending", e);
        }

        try {
            const rawOl = localStorage.getItem(STORAGE_KEYS.ORDER_LINES);
            if (rawOl) {
                const lines = JSON.parse(rawOl);
                if (patchOrderLinesArr(lines)) localStorage.setItem(STORAGE_KEYS.ORDER_LINES, JSON.stringify(lines));
            }
        } catch (e) {
            console.warn("patchLinkedRefs order lines", e);
        }

        try {
            const rawM = localStorage.getItem(STORAGE_KEYS.ME_LEGACY);
            if (rawM) {
                const o = JSON.parse(rawM);
                if (patchMeLegacyParsed(o)) localStorage.setItem(STORAGE_KEYS.ME_LEGACY, JSON.stringify(o));
            }
        } catch (e) {
            console.warn("patchLinkedRefs meLegacy", e);
        }
    },

    /** Fecha local YYYY-MM-DD (día civil; cierres automáticos consumo, etc.). */
    localDateKey(date = new Date()) {
        const d = date instanceof Date ? date : new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    },

    /** Sincroniza el contador de IDs numéricos con datos ya cargados (inventario, movimientos, líneas, etc.). */
    syncEntityIdCounter() {
        const key = STORAGE_KEYS.SEQ_ENTITY_ID;
        let max = parseInt(localStorage.getItem(key) || '0', 10);
        const consider = id => {
            if (id == null || id === '') return;
            const s = String(id).trim();
            if (/^\d+$/.test(s)) {
                const n = parseInt(s, 10);
                if (Number.isFinite(n) && n > max) max = n;
            }
        };
        try {
            (typeof InventoryManager !== 'undefined' && InventoryManager.items
                ? InventoryManager.items
                : []
            ).forEach(i => consider(i.id));
            (typeof MovementManager !== 'undefined' && MovementManager.movements
                ? MovementManager.movements
                : []
            ).forEach(m => consider(m.id));
            if (typeof OrderLinesManager !== 'undefined' && OrderLinesManager.lines) {
                OrderLinesManager.lines.forEach(l => consider(l.id));
            }
            if (typeof Auth !== 'undefined' && Auth.users) {
                Auth.users.forEach(u => consider(u.id));
            }
        } catch (e) {
            /* noop */
        }
        localStorage.setItem(key, String(max));
    },

    generateId() {
        const key = STORAGE_KEYS.SEQ_ENTITY_ID;
        let c = parseInt(localStorage.getItem(key) || '0', 10) + 1;
        localStorage.setItem(key, String(c));
        return String(c);
    },

    /**
     * Texto interpolado en plantillas HTML (contenido de nodos o innerHTML).
     * No usar en valores de atributos: ahí va {@link Utils.escapeAttr}.
     */
    escapeHtml(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    },

    /**
     * Valores en atributos HTML entre comillas dobles (data-*, value=, title=, aria-label=, …).
     * Para texto visible en la página usar {@link Utils.escapeHtml}.
     */
    escapeAttr(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;");
    },

    /** Formato sugerido de n.º de proyecto: una letra + 6 dígitos (ej. A000001). No bloquea si no coincide. */
    projectIdFormatValid(s) {
        const t = (s || "").trim();
        if (!t) return true;
        return /^[A-Za-z]\d{6}$/.test(t);
    },

    warnProjectIdFormatIfNeeded(projectId) {
        if (this.projectIdFormatValid(projectId)) return;
        this.showToast(I18n.t("msg.projectIdFormatHint"), "warning");
    },

    /**
     * Clave estable para comparar números de proyecto tras migraciones (p. ej. Phoenix):
     * prefijos varios (A…, LCH…), solo dígitos, sufijo -1/-2 (agregos).
     * Lo que cuenta es el bloque numérico final; si tiene más de 6 cifras, las últimas 6 (n.º de proyecto).
     */
    projectIdLooseKey(s) {
        const t = String(s ?? "").trim();
        if (!t) return "";
        const base = t.replace(/(?:-\d+)+$/u, "");
        const m = base.match(/(\d+)$/u);
        if (!m) return t.toUpperCase();
        let digits = m[1];
        if (digits.length > 6) digits = digits.slice(-6);
        const core = digits.replace(/^0+/u, "") || "0";
        return core.length <= 6 ? core.padStart(6, "0") : core;
    },

    /** Misma referencia de proyecto con o sin letra inicial (u otros casos de @see projectIdLooseKey). */
    projectIdsEquivalent(a, b) {
        const ka = this.projectIdLooseKey(a);
        const kb = this.projectIdLooseKey(b);
        if (!ka || !kb) return false;
        return ka === kb;
    },

    /**
     * Número de proyecto para enlazar transporte / pendientes M.E.
     * Prioriza `movement.projectId`; si viene vacío (p. ej. migración), usa las 6 cifras de la ref tipada
     * (LCH…, MEO…, MEP…) — la referencia no es el proyecto, solo sirve para inferir el correlativo.
     */
    projectIdForTransportLink(mov) {
        const raw = String(mov?.projectId ?? "").trim();
        if (raw) return raw;
        const typ = mov?.type || "";
        if (typ !== "LISTA_CHEQUEO" && typ !== "MAT_ELEC_OBRA" && typ !== "MAT_ELEC_PROD") return "";
        const ref = String(mov?.reference ?? "").trim();
        if (!ref) return "";
        const k = this.projectIdLooseKey(ref);
        return k || "";
    },

    /**
     * Locale para fechas visibles: alineado con {@link I18n#currentLang}.
     */
    _appDateLocale() {
        const locMap = { es: "es-ES", en: "en-US", fr: "fr-FR" };
        const lang = typeof I18n !== "undefined" && I18n.currentLang ? I18n.currentLang : "es";
        return { bcp: locMap[lang] || "es-ES", lang };
    },

    /**
     * Día, mes en 3 letras, año 4 cifras; opcional hora local 24 h (como en carrusel / informes).
     * @param {string|number|Date} d
     * @param {boolean} includeTime
     * @returns {string}
     */
    _formatAppDisplayDate(d, includeTime) {
        const dd = d instanceof Date ? d : new Date(d);
        if (Number.isNaN(dd.getTime())) return "";
        const { bcp, lang } = this._appDateLocale();
        const es3 = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
        let mon =
            lang === "es"
                ? es3[dd.getMonth()] || ""
                : dd
                      .toLocaleDateString(bcp, { month: "short" })
                      .replace(/\./g, "")
                      .trim();
        if (lang !== "es" && mon.length > 3) mon = mon.slice(0, 3);
        const day = dd.toLocaleDateString(bcp, { day: "numeric" });
        const year = dd.toLocaleDateString(bcp, { year: "numeric" });
        let out = `${day} ${mon} ${year}`;
        if (includeTime) {
            const time = dd.toLocaleTimeString(bcp, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            });
            out += ` ${time}`;
        }
        return out;
    },

    /** Fecha corta unificada: día, mes 3 letras, año 4 cifras. */
    formatDate(d) {
        if (!d) return "";
        return this._formatAppDisplayDate(d, false);
    },

    /** Fecha y hora unificadas: misma parte fecha + hora local 24 h. */
    formatDateTime(d) {
        if (!d) return "";
        return this._formatAppDisplayDate(d, true);
    },

    /** Números en pantalla: como máximo `maxDecimals` dígitos tras el decimal (redondeo, sin ceros finales innecesarios). */
    formatDecimalDisplay(value, maxDecimals = 4) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "0";
        const s = n.toFixed(maxDecimals);
        if (s.includes("e") || s.includes("E")) return String(n);
        const t = s.replace(/\.?0+$/, "");
        return t === "-0" ? "0" : t;
    },

    /** Redondeo para cantidades/stock persistidas (máx. 4 decimales). */
    roundDecimal(value, maxDecimals = 4) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Number(n.toFixed(maxDecimals));
    },

    /**
     * Todos los números de caja (1..maxBox) reconocidos en el texto de ubicación, sin duplicados,
     * en orden de aparición (izquierda → derecha). Varios patrones pueden coexistir en el mismo texto
     * o en segmentos separados por comas (p. ej. «BOX1, BOX 2», «caja 3,BOX4»).
     */
    parseWarehouseBoxesFromLocation(str, maxBox = Number.POSITIVE_INFINITY) {
        if (str == null) return [];
        const s = String(str).trim();
        if (!s) return [];
        const parsedMax = Number(maxBox);
        const nmax = Number.isFinite(parsedMax) && parsedMax >= 1 ? Math.floor(parsedMax) : Number.POSITIVE_INFINITY;
        const patternSources = [
            /\bBOX\s*(\d{1,6})\b/i,
            /\bbox\s*#?\s*(?:n[°º]?\s*)?(\d{1,6})\b/i,
            /\bcaja\s*#?\s*(?:n[°º]?\s*)?(\d{1,6})\b/i,
            /\bbox(\d{1,6})\b/i,
            /\bB0X\s*(\d{1,6})\b/i
        ];
        const allMatches = [];
        for (const re of patternSources) {
            const rg = new RegExp(re.source, "gi");
            let m;
            while ((m = rg.exec(s)) !== null) {
                const n = parseInt(m[1], 10);
                if (n >= 1 && n <= nmax) allMatches.push({ n, index: m.index });
            }
        }
        allMatches.sort((a, b) => a.index - b.index || a.n - b.n);
        const seen = new Set();
        const ordered = [];
        for (const { n } of allMatches) {
            if (!seen.has(n)) {
                seen.add(n);
                ordered.push(n);
            }
        }
        return ordered;
    },

    /**
     * Primera caja detectada en el texto (orden de aparición), o null.
     * @see parseWarehouseBoxesFromLocation
     */
    parseWarehouseBoxFromLocation(str, maxBox = Number.POSITIVE_INFINITY) {
        const arr = this.parseWarehouseBoxesFromLocation(str, maxBox);
        return arr.length ? arr[0] : null;
    },

    /**
     * Ubicaciones físicas reconocidas en el texto libre de ubicación (convención almacén).
     * Orden para UI; la detección usa longitud de etiqueta para priorizar frases largas sobre cortas.
     */
    WAREHOUSE_LOCATION_SLOTS: Object.freeze([
        "A1",
        "E1R",
        "E1C",
        "E1L",
        "E2R",
        "E2C",
        "E2L",
        "E3R",
        "E3C",
        "E3L",
        "E4R",
        "E4C",
        "E4L",
        "E5R",
        "E5C",
        "E5L",
        "E6R",
        "E6C",
        "E6L",
        "ETOP",
        "ATOP",
        "ETOPR",
        "ETOPL",
        "ETOPC",
        "CONTAINEUR CHANTIER",
        "CONTAINER AVEC PORTES",
        "CONTAINER RIDEAU",
        "ARMOIRE AVEC CLE",
        "ARMOIRE SANS CLE",
        "ARMOIRE EN BOIS",
        "ARMOIRE ELECTRIQUE",
        "KEITH'S OFFICE",
        "CRATAGE",
        "DESK",
        "EXTRUSION",
        "BIN 8",
        "BIN2",
        "BIN 3",
        "BIN 1",
        "BOITE TRANSPARENT",
        "TANK BLEU",
        "A COTE DE L'ESCALIER"
    ]),

    getUserWarehouseLocationSlots() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCATION_CATALOG) || "[]";
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            const out = [];
            const seen = new Set();
            for (const v of arr) {
                const s = String(v || "").trim();
                if (!s) continue;
                const k = s.toUpperCase();
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(s);
            }
            return out;
        } catch {
            return [];
        }
    },

    setUserWarehouseLocationSlots(nextList) {
        const arr = Array.isArray(nextList) ? nextList : [];
        const cleaned = [];
        const seen = new Set();
        for (const v of arr) {
            const s = String(v || "").trim();
            if (!s) continue;
            const k = s.toUpperCase();
            if (seen.has(k)) continue;
            seen.add(k);
            cleaned.push(s);
        }
        localStorage.setItem(STORAGE_KEYS.LOCATION_CATALOG, JSON.stringify(cleaned));
        return cleaned;
    },

    getDisabledBaseWarehouseLocationSlots() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCATION_CATALOG_BASE_DISABLED) || "[]";
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            const out = [];
            const seen = new Set();
            for (const v of arr) {
                const s = String(v || "").trim();
                if (!s) continue;
                const k = s.toUpperCase();
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(s);
            }
            return out;
        } catch {
            return [];
        }
    },

    setDisabledBaseWarehouseLocationSlots(nextList) {
        const arr = Array.isArray(nextList) ? nextList : [];
        const cleaned = [];
        const seen = new Set();
        for (const v of arr) {
            const s = String(v || "").trim();
            if (!s) continue;
            const k = s.toUpperCase();
            if (seen.has(k)) continue;
            seen.add(k);
            cleaned.push(s);
        }
        localStorage.setItem(STORAGE_KEYS.LOCATION_CATALOG_BASE_DISABLED, JSON.stringify(cleaned));
        return cleaned;
    },

    getDisabledCustomWarehouseLocationSlots() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.LOCATION_CATALOG_CUSTOM_DISABLED) || "[]";
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            const out = [];
            const seen = new Set();
            for (const v of arr) {
                const s = String(v || "").trim();
                if (!s) continue;
                const k = s.toUpperCase();
                if (seen.has(k)) continue;
                seen.add(k);
                out.push(s);
            }
            return out;
        } catch {
            return [];
        }
    },

    setDisabledCustomWarehouseLocationSlots(nextList) {
        const arr = Array.isArray(nextList) ? nextList : [];
        const cleaned = [];
        const seen = new Set();
        for (const v of arr) {
            const s = String(v || "").trim();
            if (!s) continue;
            const k = s.toUpperCase();
            if (seen.has(k)) continue;
            seen.add(k);
            cleaned.push(s);
        }
        localStorage.setItem(STORAGE_KEYS.LOCATION_CATALOG_CUSTOM_DISABLED, JSON.stringify(cleaned));
        return cleaned;
    },

    /**
     * Un único token de catálogo efectivo o BOXn; rechaza texto que no coincida con ranuras/cajas reconocidas.
     */
    strictCatalogLocationToken(str) {
        const normalized = this.normalizeWarehouseLocationText(str || "");
        if (!normalized) return "";
        const slots = this.parseWarehouseSlotsFromLocation(normalized);
        if (slots.length) return slots[0];
        const box = this.parseWarehouseBoxFromLocation(normalized);
        if (box != null) return `BOX${box}`;
        return "";
    },

    /**
     * Cadena persistible: solo etiquetas del catálogo efectivo y referencias BOX (sin texto libre intermedio).
     */
    strictEffectiveWarehouseLocationText(str) {
        const normalized = this.normalizeWarehouseLocationText(str || "");
        if (!normalized) return "";
        const segments = normalized
            .split(/\s*,\s*/)
            .map(s => s.trim())
            .filter(Boolean);
        const out = [];
        const seen = new Set();
        const push = t => {
            if (!t) return;
            const k = t.toUpperCase();
            if (seen.has(k)) return;
            seen.add(k);
            out.push(t);
        };
        for (const seg of segments) {
            for (const s of this.parseWarehouseSlotsFromLocation(seg)) push(s);
            for (const b of this.parseWarehouseBoxesFromLocation(seg)) push(`BOX${b}`);
        }
        return out.join(", ");
    },

    /**
     * Importación CSV/XLSX: convierte texto de ubicación al canónico del catálogo (ranuras + BOXn).
     * Más tolerante que `strictEffectiveWarehouseLocationText` cuando el Excel usa otra capitalización,
     * espacios raros o la celda es numérica; si el texto no coincide con ninguna ranura del catálogo
     * Si no hay coincidencia en catálogo, se conserva el texto normalizado (no se pierde la fila en importación).
     */
    resolveImportLocationLabel(raw) {
        if (raw == null) return "";
        let s0 =
            typeof raw === "number" && Number.isFinite(raw)
                ? String(raw)
                : String(raw).replace(/\u00a0/g, " ").trim();
        if (!s0) return "";
        let out = this.strictEffectiveWarehouseLocationText(s0);
        if (out) return out;
        const slots = this.getEffectiveWarehouseLocationSlots();
        const norm = t =>
            String(t || "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/\s+/g, " ")
                .trim()
                .toUpperCase();
        const n0 = norm(s0);
        for (const slot of slots) {
            if (norm(slot) === n0) return slot;
        }
        const subHits = this.parseWarehouseSlotsFromLocation(s0);
        if (subHits.length) return subHits.join(", ");
        const nums = this.parseWarehouseBoxesFromLocation(s0);
        if (nums.length) return nums.map(b => `BOX${b}`).join(", ");
        const loose = this.normalizeWarehouseLocationText(s0);
        if (loose) {
            const strictLoose = this.strictEffectiveWarehouseLocationText(loose);
            if (strictLoose) return strictLoose;
            const parts = loose
                .split(/\s*,\s*/)
                .map(p => p.trim())
                .filter(Boolean);
            if (parts.length >= 1) return parts.join(", ");
        }
        return s0.replace(/\s+/g, " ").trim();
    },

    getEffectiveWarehouseLocationSlots() {
        const base = Array.isArray(this.WAREHOUSE_LOCATION_SLOTS) ? this.WAREHOUSE_LOCATION_SLOTS : [];
        const disabledBase = new Set(
            (this.getDisabledBaseWarehouseLocationSlots ? this.getDisabledBaseWarehouseLocationSlots() : []).map(s =>
                String(s || "").toUpperCase()
            )
        );
        const disabledCustom = new Set(
            (this.getDisabledCustomWarehouseLocationSlots ? this.getDisabledCustomWarehouseLocationSlots() : []).map(
                s => String(s || "").toUpperCase()
            )
        );
        const user = this.getUserWarehouseLocationSlots();
        const out = [];
        const seen = new Set();
        for (const v of [
            ...base.filter(s => !disabledBase.has(String(s || "").toUpperCase())),
            ...user.filter(s => !disabledCustom.has(String(s || "").toUpperCase()))
        ]) {
            const s = String(v || "").trim();
            if (!s) continue;
            const k = s.toUpperCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(s);
        }
        return out;
    },

    normalizeWarehouseLocationText(str) {
        if (str == null) return "";
        const s = String(str).trim();
        if (!s) return "";
        const normalizeSep = raw =>
            String(raw || "")
                .replace(/\s*[,;|]+\s*/g, ", ")
                .replace(/\s{2,}/g, " ")
                .trim();
        const pre = normalizeSep(s)
            .replace(/\s+\b(?:Y|ET|AND)\b\s+/gi, ", ");
        const parts = pre
            .split(/\s*,\s*/)
            .map(p => p.trim())
            .filter(Boolean);
        if (!parts.length) return "";
        const mapped = parts.map(p => {
            const up = p
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toUpperCase()
                .replace(/\s+/g, " ")
                .trim();
            if (/\bB0X\s*\d{1,2}\b/i.test(up)) return up.replace(/\bB0X\b/g, "BOX");
            if (/\bARMOIRE(?:\s+DU\s+M\.?)?\s+EL(?:EC|C)?TRIQUE\b/i.test(up)) return "ARMOIRE ELECTRIQUE";
            if (/\bARMOIRE\s+WITH\s+LOCK\b/i.test(up)) return "ARMOIRE AVEC CLE";
            if (/\bCONTAINER\s+AVEC\s+PO+RTES?\b/i.test(up)) return "CONTAINER AVEC PORTES";
            if (/\bCRETAGE\b/i.test(up)) return "CRATAGE";
            if (/\bB8-PROD\b/i.test(up)) return "B8-PROD";
            const hits = this.parseWarehouseSlotsFromLocation(p);
            if (hits && hits.length) return hits[0];
            return p;
        });
        const out = [];
        const seen = new Set();
        for (const p of mapped) {
            const k = p.toUpperCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(p);
        }
        return out.join(", ");
    },

    /** Regex que reconoce una ubicación canónica dentro del texto de ubicación. */
    _warehouseSlotMatchRegex(canon) {
        const c = String(canon).trim();
        const up = c.toUpperCase();
        // E1R … E6L
        const em = /^E([1-6])([RCL])$/i.exec(c);
        if (em) {
            const g1 = em[1];
            const g2 = em[2].toUpperCase();
            return new RegExp(`\\bE${g1}${g2}\\b`, "i");
        }
        if (/^ETOP$/i.test(c)) return /\bETOP\b/i;
        if (/^ETOP[RLC]$/i.test(c)) return new RegExp(`\\b${up}\\b`, "i");
        if (/^KEITH'S OFFICE$/i.test(c)) return /\bKEITH'?S\s+OFFICE\b/i;
        if (/^CONTAINER AVEC PORTES$/i.test(c)) return /\bCONTAINER\s+AVEC\s+PO+RTES?\b/i;
        if (/^CONTAINER RIDEAU$/i.test(c)) return /\bCONTAINER\s+RIDEAU\b/i;
        if (/^ARMOIRE AVEC CLE$/i.test(c)) return /\bARMOIRE\s+(?:AVEC\s+CLE|WITH\s+LOCK)\b/i;
        // BIN 8, BIN 1 — evitar coincidir BIN 11 como BIN 1
        const binSp = /^BIN\s*(\d)$/i.exec(c);
        if (binSp) {
            const d = binSp[1];
            if (d === "8") return /\b(?:BIN\s*8|B8-PROD)\b/i;
            return new RegExp(`\\bBIN\\s*${d}(?!\\d)\\b`, "i");
        }
        // BIN2 (sin espacio) y variante BIN 2
        if (/^BIN2$/i.test(c)) return /\bBIN\s*2\b(?!\d)/i;
        if (/^ARMOIRE ELECTRIQUE$/i.test(c)) {
            return /\bARMOIRE(?:\s+DU\s+M\.?)?\s+EL(?:EC|C)?TRIQUE\b/i;
        }
        if (/^CRATAGE$/i.test(c)) return /\bCR(?:A|E)TAGE\b/i;
        // Mantener compatibilidad con variantes antiguas escritas sin corrección.
        if (/^CONTAINEUR CHANTIER$/i.test(c)) return /\bCONTAIN(?:ER|EUR)\s+CHANTIER\b/i;
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const parts = c.split(/\s+/).filter(Boolean).map(p => esc(p));
        if (parts.length <= 1) return new RegExp(`\\b${parts[0]}\\b`, "i");
        return new RegExp(parts.join("\\s+"), "i");
    },

    /**
     * Ubicaciones de almacén detectadas en `str`, sin duplicados, orden de primera aparición.
     * Las coincidencias no se solapan; si hay conflicto gana la etiqueta más larga.
     */
    parseWarehouseSlotsFromLocation(str) {
        if (str == null || !String(str).trim()) return [];
        const source = String(str);
        const candidates = [];
        const slots = [...this.getEffectiveWarehouseLocationSlots()].sort((a, b) => b.length - a.length);
        for (const canon of slots) {
            let re;
            try {
                re = this._warehouseSlotMatchRegex(canon);
            } catch (e) {
                continue;
            }
            const rg = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
            let m;
            while ((m = rg.exec(source)) !== null) {
                candidates.push({
                    canon,
                    start: m.index,
                    end: m.index + m[0].length
                });
            }
        }
        candidates.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
        const picked = [];
        const blocked = [];
        const overlaps = (s0, e0) => blocked.some(([s1, e1]) => !(e0 <= s1 || s0 >= e1));
        const addBlock = (s0, e0) => {
            blocked.push([s0, e0]);
        };
        for (const h of candidates) {
            if (overlaps(h.start, h.end)) continue;
            picked.push(h);
            addBlock(h.start, h.end);
        }
        picked.sort((a, b) => a.start - b.start);
        const seen = new Set();
        const ordered = [];
        for (const h of picked) {
            if (!seen.has(h.canon)) {
                seen.add(h.canon);
                ordered.push(h.canon);
            }
        }
        return ordered;
    },

    // CSV helpers (idénticos a versión previa) ---------------------
    parseCSV(text){ /* igual que antes */ return this._parseCSV(text); },
    _parseCSV(txt){
        if(!txt)return[];
        txt=txt.replace(/\r\n/g,"\n").replace(/\r/g,"\n").trim();
        const lines=txt.split("\n");
        const delim=[',',';','\t'].reduce((best,d)=>{
            const c=(lines[0].match(new RegExp(`\\${d}`,'g'))||[]).length;
            return c>best.c?{d,c}:best;},{d:',',c:0}).d;
        const headers=this.splitCSVLine(lines[0],delim);
        return lines.slice(1).map(l=>{
            const vals=this.splitCSVLine(l,delim); const o={};
            headers.forEach((h,i)=>o[h.trim()]=(vals[i]||'').trim()); return o;
        });
    },
    splitCSVLine(line,delim=','){const r=[];let cur='',q=false;
        for(let i=0;i<line.length;i++){const ch=line[i],nx=line[i+1];
            if(ch=='"'){ if(!q)q=true; else if(nx=='"'){cur+='"';i++;} else q=false; }
            else if(ch==delim&&!q){r.push(cur);cur='';} else cur+=ch;}
        r.push(cur);return r;},
    toCSV(data,headers){const head=headers.join(',');
        const rows=data.map(o=>headers.map(h=>{let v=o[h]??'';if(typeof v==='string'){v=v.replace(/"/g,'""');if(/["\n,;]/.test(v))v=`"${v}"`;}return v;}).join(','));return [head,...rows].join('\n');},

    downloadArrayBuffer(
        buffer,
        filename,
        mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) {
        const blob = new Blob([buffer], { type: mimeType });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    },

    /**
     * Tabla XLSX con encabezado naranja (tema G-NEEX), texto centrado y negrita.
     * Requiere `vendor/xlsx-js-style.min.js` (global `XLSX`).
     * @param {string[]} headers
     * @param {Record<string, unknown>[]} rowObjects
     * @param {{ kind?: string, title?: string, details?: string[] } | null} manifestMeta Hoja «Info» opcional.
     * @returns {Uint8Array|null}
     */
    buildStyledXlsxBuffer(headers, rowObjects, manifestMeta = null) {
        const XLSX = typeof window !== "undefined" ? window.XLSX : null;
        if (!XLSX || !XLSX.utils || typeof XLSX.write !== "function") {
            console.error("G-NEEX: xlsx-js-style (window.XLSX) not loaded");
            return null;
        }
        const H = Array.isArray(headers) ? headers : [];
        const rows = Array.isArray(rowObjects) ? rowObjects : [];
        const dataRows = rows.map(o =>
            H.map(h => {
                const v = o[h];
                if (v === null || v === undefined) return "";
                if (typeof v === "number" && !Number.isFinite(v)) return "";
                return v;
            })
        );
        const aoa = [H, ...dataRows];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        const thin = {
            top: { style: "thin", color: { rgb: "FFB8B8B8" } },
            bottom: { style: "thin", color: { rgb: "FFB8B8B8" } },
            left: { style: "thin", color: { rgb: "FFB8B8B8" } },
            right: { style: "thin", color: { rgb: "FFB8B8B8" } }
        };
        const hdrFill = { patternType: "solid", fgColor: { rgb: "FFFF6B35" } };
        const hdrFont = { bold: true, color: { rgb: "FFFFFFFF" } };
        const bodyFont = { bold: true, color: { rgb: "FF222222" } };
        const align = { horizontal: "center", vertical: "center", wrapText: true };
        const ref = ws["!ref"];
        if (ref) {
            const range = XLSX.utils.decode_range(ref);
            for (let R = range.s.r; R <= range.e.r; R++) {
                for (let C = range.s.c; C <= range.e.c; C++) {
                    const addr = XLSX.utils.encode_cell({ r: R, c: C });
                    if (!ws[addr]) ws[addr] = { t: "s", v: "" };
                    const isHeader = R === 0;
                    ws[addr].s = {
                        font: isHeader ? hdrFont : bodyFont,
                        alignment: align,
                        border: thin,
                        ...(isHeader ? { fill: hdrFill } : {})
                    };
                }
            }
        }
        const colWidths = H.map((h, ci) => {
            let max = String(h == null ? "" : h).length;
            dataRows.forEach(row => {
                const cell = row[ci];
                const len = cell != null ? String(cell).length : 0;
                if (len > max) max = len;
            });
            return { wch: Math.min(56, Math.max(8, max + 2)) };
        });
        ws["!cols"] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Datos");

        if (manifestMeta && typeof manifestMeta === "object") {
            const esc = s => String(s ?? "");
            const infoAoa = [
                ["Phoenix Cell G-NEEX"],
                [esc(manifestMeta.title)],
                [
                    `${
                        typeof I18n !== "undefined" && I18n.t ? I18n.t("export.manifest.kindLabel") : "Kind"
                    }: ${esc(manifestMeta.kind)}`
                ],
                [
                    `${
                        typeof I18n !== "undefined" && I18n.t
                            ? I18n.t("export.manifest.exportedUtcLabel")
                            : "Exported (UTC)"
                    }: ${new Date().toISOString()}`
                ],
                [
                    `${
                        typeof I18n !== "undefined" && I18n.t
                            ? I18n.t("export.manifest.exportedLocalLabel")
                            : "Exported (local)"
                    }: ${this.formatDateTime(new Date())}`
                ],
                ...(Array.isArray(manifestMeta.details) ? manifestMeta.details.map(d => [esc(d)]) : [])
            ];
            const wsInfo = XLSX.utils.aoa_to_sheet(infoAoa);
            XLSX.utils.book_append_sheet(wb, wsInfo, "Info");
        }

        try {
            const out = XLSX.write(wb, {
                bookType: "xlsx",
                type: "array",
                cellStyles: true
            });
            return out instanceof Uint8Array ? out : new Uint8Array(out);
        } catch (e) {
            console.error(e);
            return null;
        }
    },

    /**
     * Guarda un XLSX con formato en la carpeta Inform del proyecto (o descarga).
     * @returns {Promise<"ok"|"cancelled"|"downloaded"|"failed">}
     */
    async exportStyledXlsxToInformFolder(filename, headers, rowObjects, manifestMeta = null) {
        const buf = this.buildStyledXlsxBuffer(headers, rowObjects, manifestMeta);
        if (!buf || !buf.byteLength) {
            if (typeof I18n !== "undefined") this.showToast(I18n.t("msg.errorExportingReport"), "error");
            return "failed";
        }
        let fn = String(filename || "export.xlsx").trim();
        if (!/\.xlsx$/i.test(fn)) fn = fn.replace(/\.csv$/i, "") + ".xlsx";

        if (!this.canWriteToProjectBackupFolder()) {
            this.downloadArrayBuffer(buf, fn);
            if (typeof I18n !== "undefined") this.showToast(I18n.t("msg.dataExported"), "success");
            return "downloaded";
        }
        const r = await this.writeProjectExportFile(this.PROJECT_EXPORT_INFORM, fn, buf, { binary: true });
        if (r === "ok") {
            if (typeof I18n !== "undefined") this.showToast(I18n.t("msg.dataExported"), "success");
            return "ok";
        }
        if (r === "cancelled") return "cancelled";
        this.downloadArrayBuffer(buf, fn);
        if (typeof I18n !== "undefined") this.showToast(I18n.t("msg.dataExported"), "success");
        return "downloaded";
    },

    /**
     * CSS compartido para todas las ventanas de impresión del programa: papel A4 vertical,
     * tablas sin table-layout:fixed (evita columnas aplastadas); columna código legible (nowrap).
     */
    PRINT_DOCUMENT_CSS: `@page{
  size:A4 portrait;
  margin:10mm 12mm;
}
html{
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
*,*::before,*::after{box-sizing:border-box}
body{
  font-family:"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  margin:0 auto;
  padding:12px;
  color:#111;
  background:#fff;
  font-size:9pt;
  line-height:1.35;
  width:100%;
  max-width:186mm;
}
h1{font-size:11pt;margin:0 0 6px;font-weight:700}
.sub{color:#444;font-size:8.5pt;margin-bottom:12px}
table{
  border-collapse:collapse;
  font-size:8pt;
}
table:not(.movement-print-meta){
  width:auto;
  max-width:100%;
  table-layout:auto;
}
thead{display:table-header-group}
th,td{
  border:1px solid #333;
  padding:3px 5px;
  text-align:left;
  vertical-align:top;
  word-wrap:break-word;
  overflow-wrap:break-word;
  word-break:normal;
  hyphens:auto;
  -webkit-hyphens:auto;
}
th{
  background:#e5e7eb!important;
  font-weight:600;
}
tbody tr:nth-child(even){background:#f9fafb!important}
table.inventory-table{
  width:100%;
  max-width:100%;
  table-layout:fixed;
}
table.inventory-table th,table.inventory-table td{
  overflow-wrap:break-word;
  word-break:normal;
}
th.print-cell-code,td.print-cell-code{
  white-space:nowrap;
  overflow-wrap:normal;
  word-wrap:normal;
  word-break:normal;
  font-size:8.25pt;
  font-weight:600;
  max-width:none;
}
.movement-print-meta{
  width:100%;
  max-width:100%;
  margin-bottom:12px;
  table-layout:auto;
}
.movement-print-meta th{width:34%;vertical-align:top;background:#f3f4f6!important}
.print-section-title{font-size:9pt;font-weight:600;margin:12px 0 6px}
.movement-print-document{width:100%;max-width:100%}
.movement-print-document table{page-break-inside:auto}
.movement-print-document tbody tr{page-break-inside:avoid}
.detail-items-list,.detail-info,.movement-detail-header{margin-bottom:12px}
.detail-item-row{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #ddd}
@media print{
  body{padding:0;max-width:none}
  table{font-size:7.5pt}
  table.inventory-table{font-size:7pt}
  thead{display:table-header-group}
  tbody{display:table-row-group}
  tr{page-break-inside:avoid}
  table{page-break-inside:auto}
  th.print-cell-code,td.print-cell-code{font-size:8pt;font-weight:600}
  th,td{padding:2px 4px}
}
.reception-print-pkg-block{margin:0 0 6px 0;padding:0}
.reception-print-pkg-line{display:block;margin:2px 0}
`,

    /**
     * z-index por encima de otros overlays activos (p. ej. Configuración a 3500) para diálogos encadenados.
     */
    nextModalStackZIndex() {
        let max = 2100;
        try {
            document.querySelectorAll(".modal.active, .gneex-help-overlay:not([hidden])").forEach(el => {
                let z = NaN;
                if (el.style && el.style.zIndex) z = parseInt(el.style.zIndex, 10);
                if (!Number.isFinite(z)) z = parseInt(window.getComputedStyle(el).zIndex, 10);
                if (Number.isFinite(z)) max = Math.max(max, z);
            });
        } catch (e) {}
        return max + 2;
    },

    /**
     * Encabezado de columna para dimensiones por paquete N (L/W/H) en exportaciones e informes.
     * @param {number} index1Based
     * @param {'L'|'W'|'H'} axis
     */
    packageDimColumnLabel(index1Based, axis) {
        const ax = String(axis || "").trim().toUpperCase().slice(0, 1);
        const letter = ax === "L" || ax === "W" || ax === "H" ? ax : String(axis || "").slice(0, 1);
        if (typeof I18n !== "undefined" && I18n.t) {
            return I18n.t("export.packageDimHeader")
                .replace(/\{n\}/g, String(index1Based))
                .replace(/\{axis\}/g, letter);
        }
        return `Pkg ${index1Based} ${letter}`;
    },

    /**
     * Ventana de impresión con HTML arbitrario (tablas, detalle de movimiento, etc.).
     * Usa {@link Utils.PRINT_DOCUMENT_CSS} (A4 vertical; tablas auto-ancho, código sin partir).
     */
    printHtmlDocument(title, subtitle, innerHtml) {
        const esc = s => this.escapeHtml(s);
        const w = window.open("", "_blank");
        if (!w) {
            if (typeof I18n !== "undefined" && I18n.t) {
                Utils.showToast(I18n.t("inventory.printBlocked"), "warning");
            }
            return;
        }
        const langHtml =
            typeof I18n !== "undefined" && I18n.currentLang
                ? { es: "es", en: "en", fr: "fr" }[I18n.currentLang] || "en"
                : "es";
        const css = this.PRINT_DOCUMENT_CSS;
        w.document.write(`<!DOCTYPE html><html lang="${langHtml}"><head><meta charset="UTF-8"><title>${esc(title)}</title>
      <style>${css}</style></head><body>
      <h1>${esc(title)}</h1>
      ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}
      ${innerHtml || ""}
      </body></html>`);
        w.document.close();
        w.focus();
        w.print();
    },

    async pickColumns(headers, title) {
        const cols = Array.isArray(headers) ? headers.map(h => String(h || "")).filter(Boolean) : [];
        if (!cols.length) return [];
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "modal active";
            overlay.style.zIndex = String(this.nextModalStackZIndex());
            const esc = s => this.escapeHtml(String(s ?? ""));
            const allLabel = typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.columnsAll") : "Select all";
            const noneLabel = typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.columnsNone") : "Clear all";
            const okLabel = typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.download") : "Apply";
            const cancelLabel = typeof I18n !== "undefined" && I18n.t ? I18n.t("buttons.cancel") : "Cancel";
            const dialogTitle =
                title ||
                (typeof I18n !== "undefined" && I18n.t ? I18n.t("reports.columnsLabel") : "Columns");
            overlay.innerHTML = `<div class="modal-content" style="max-width:680px">
                <h3>${esc(dialogTitle)}</h3>
                <div class="btn-group" style="margin:8px 0 12px 0;display:flex;gap:8px;flex-wrap:wrap;">
                  <button type="button" class="btn btn-secondary btn-sm" data-cols-all="1">${esc(allLabel)}</button>
                  <button type="button" class="btn btn-secondary btn-sm" data-cols-none="1">${esc(noneLabel)}</button>
                </div>
                <div data-cols-wrap="1" style="max-height:44vh;overflow:auto;border:1px solid var(--border-color);border-radius:8px;padding:8px;">
                  ${cols
                      .map(
                          (h, i) =>
                              `<label style="display:flex;gap:8px;align-items:center;padding:6px 2px;">
                                <input type="checkbox" data-col-idx="${i}" checked>
                                <span>${esc(h)}</span>
                              </label>`
                      )
                      .join("")}
                </div>
                <div class="modal-actions" style="margin-top:12px;">
                  <button type="button" class="btn btn-secondary" data-cols-cancel="1">${esc(cancelLabel)}</button>
                  <button type="button" class="btn btn-primary" data-cols-ok="1">${esc(okLabel)}</button>
                </div>
              </div>`;
            const cleanup = out => {
                overlay.remove();
                resolve(out);
            };
            overlay.addEventListener("click", e => {
                const t = e.target;
                if (t === overlay) return cleanup(null);
                if (t.closest("[data-cols-cancel='1']")) return cleanup(null);
                if (t.closest("[data-cols-all='1']")) {
                    overlay.querySelectorAll("input[data-col-idx]").forEach(cb => (cb.checked = true));
                    return;
                }
                if (t.closest("[data-cols-none='1']")) {
                    overlay.querySelectorAll("input[data-col-idx]").forEach(cb => (cb.checked = false));
                    return;
                }
                if (t.closest("[data-cols-ok='1']")) {
                    const selected = [];
                    overlay.querySelectorAll("input[data-col-idx]").forEach(cb => {
                        if (!cb.checked) return;
                        const idx = parseInt(cb.getAttribute("data-col-idx"), 10);
                        if (Number.isFinite(idx) && cols[idx]) selected.push(cols[idx]);
                    });
                    cleanup(selected.length ? selected : null);
                }
            });
            document.body.appendChild(overlay);
        });
    },

    /**
     * True si el foco está en un control donde las flechas deben conservar su comportamiento nativo (texto, número, fecha…).
     */
    _isTextLikeEditingTarget(el) {
        if (!el || !el.closest) return false;
        if (el.closest("textarea, select")) return true;
        const inp = el.closest("input");
        if (!inp) return false;
        const t = (inp.getAttribute("type") || "text").toLowerCase();
        const textLike = [
            "text",
            "search",
            "email",
            "url",
            "tel",
            "password",
            "number",
            "date",
            "time",
            "datetime-local",
            "month",
            "week",
            ""
        ];
        return textLike.includes(t);
    },

    /** Contenedor con scroll (barra u overflow) asociado a tablas con navegación por flechas; no limpiar selección al interactuar aquí. */
    ARROW_NAV_TABLE_SCROLL_SELECTORS: [
        ".inventory-table-container",
        ".orderlines-view-pane",
        ".orderlines-table-wrap",
        ".history-details-wrap",
        ".consumo-ledger-table-wrap",
        ".selected-items-table-container",
        ".transport-prepared-table-wrap",
        ".me-legacy-table-wrap"
    ].join(","),

    _arrowNavTableScrollRegion(tbody) {
        if (!tbody || !tbody.closest) return null;
        return tbody.closest(this.ARROW_NAV_TABLE_SCROLL_SELECTORS);
    },

    /**
     * Flechas arriba/abajo entre filas (Explorer: fila enfocable, clic en la fila toma el foco).
     * `tbody` conserva el listener aunque se re-rendericen las filas.
     */
    installTableBodyArrowNav(tbody) {
        if (!tbody || tbody.dataset.gneexRowNav === "1") return;
        tbody.dataset.gneexRowNav = "1";

        const isDataRow = tr =>
            tr &&
            tbody.contains(tr) &&
            !tr.querySelector("td[colspan]") &&
            tr.querySelector("td");

        const getRows = () => [...tbody.querySelectorAll("tr")].filter(isDataRow);

        const skipRowFocusSelector =
            "button, a, input, select, textarea, label[for], [contenteditable='true'], [data-jump-kind], .inv-row-actions-pop";

        const clearRowFocusStyles = rows => {
            rows.forEach(r => {
                r.classList.remove("gneex-row-selected");
                r.tabIndex = -1;
            });
        };

        const focusRow = tr => {
            const rows = getRows();
            clearRowFocusStyles(rows);
            if (!isDataRow(tr)) return;
            tr.classList.add("gneex-row-selected");
            tr.tabIndex = 0;
            try {
                tr.focus({ preventScroll: true });
            } catch (err) {
                tr.focus();
            }
        };

        tbody.addEventListener("click", e => {
            const tr = e.target.closest("tr");
            if (!isDataRow(tr)) return;
            if (e.target.closest(skipRowFocusSelector)) return;
            focusRow(tr);
        });

        tbody.addEventListener("keydown", e => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (this._isTextLikeEditingTarget(e.target)) return;

            const rows = getRows();
            if (!rows.length) return;

            let curTr = e.target.closest("tr");
            if (!curTr || !rows.includes(curTr)) {
                curTr = rows.find(r => r.classList.contains("gneex-row-selected")) || rows[0];
            }
            let i = curTr ? rows.indexOf(curTr) : -1;
            if (e.key === "ArrowDown") {
                i = Math.min(rows.length - 1, i + 1);
            } else {
                i = i < 0 ? rows.length - 1 : Math.max(0, i - 1);
            }
            if (i < 0 || i >= rows.length) return;
            e.preventDefault();
            focusRow(rows[i]);
        });

        if (tbody.dataset.gneexOutsideClear !== "1") {
            tbody.dataset.gneexOutsideClear = "1";
            const scrollRegion = this._arrowNavTableScrollRegion(tbody);
            document.addEventListener(
                "click",
                e => {
                    if (tbody.contains(e.target)) return;
                    if (scrollRegion && scrollRegion.contains(e.target)) return;
                    const topSb = scrollRegion && scrollRegion.previousElementSibling;
                    if (
                        topSb &&
                        topSb.classList &&
                        topSb.classList.contains("gneex-top-scrollbar-wrap") &&
                        topSb.contains(e.target)
                    ) {
                        return;
                    }
                    clearRowFocusStyles(getRows());
                },
                true
            );
        }
    },

    /** Clase visual para ítem de lista/carrusel con foco (historial). */
    LIST_ITEM_SELECTED_CLASS: "gneex-list-item-selected",

    /**
     * Flechas arriba/abajo entre elementos enfocables (p. ej. botones-fila vista lista del historial).
     * Clic fuera del contenedor quita foco y estilo de selección.
     */
    installListArrowNav(container, itemSelector) {
        if (!container || !itemSelector || container.dataset.gneexListNav === "1") return;
        container.dataset.gneexListNav = "1";
        const selClass = this.LIST_ITEM_SELECTED_CLASS;

        const syncSelectedClass = focusedEl => {
            const items = [...container.querySelectorAll(itemSelector)];
            items.forEach(el => el.classList.toggle(selClass, el === focusedEl));
        };

        const clearListSelection = () => {
            container.querySelectorAll(itemSelector).forEach(el => el.classList.remove(selClass));
            const ae = document.activeElement;
            if (ae && ae.matches(itemSelector) && container.contains(ae)) ae.blur();
        };

        container.addEventListener("focusin", e => {
            const item = e.target && e.target.closest ? e.target.closest(itemSelector) : null;
            if (!item || !container.contains(item)) return;
            syncSelectedClass(item);
        });

        if (container.dataset.gneexListOutsideClear !== "1") {
            container.dataset.gneexListOutsideClear = "1";
            const listScrollScope =
                container.closest(".history-results-scope") ||
                container.closest(".transport-board") ||
                null;
            document.addEventListener(
                "click",
                e => {
                    if (container.contains(e.target)) return;
                    if (listScrollScope && listScrollScope.contains(e.target)) return;
                    clearListSelection();
                },
                true
            );
        }

        container.addEventListener("keydown", e => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (this._isTextLikeEditingTarget(e.target)) return;
            const items = [...container.querySelectorAll(itemSelector)];
            if (!items.length) return;
            const ae = document.activeElement;
            let i = items.indexOf(ae);
            if (i < 0) {
                if (!container.contains(ae)) return;
                if (e.key === "ArrowUp") return;
                i = -1;
            }
            if (e.key === "ArrowDown") i = Math.min(items.length - 1, i + 1);
            else i = Math.max(0, i - 1);
            e.preventDefault();
            try {
                items[i].focus({ preventScroll: true });
            } catch (err) {
                items[i].focus();
            }
        });
    },

    downloadFile(content,filename,type='text/csv'){
        const blob=new Blob(['\ufeff'+content],{type:`${type};charset=utf-8;`});
        const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href);
    },

    /** Separador entre comentarios y filas CSV; `importDataCSV` / importación lo ignoran. */
    CSV_DATA_MARKER: "# --- CSV data ---",

    /**
     * Quita el preámbulo informativo de exportaciones G-NEEX (líneas #) para importar el CSV.
     * @param {string} text
     * @returns {string}
     */
    stripCsvPreamble(text) {
        if (text == null) return "";
        const s = String(text);
        const marker = this.CSV_DATA_MARKER;
        const i = s.indexOf(marker);
        if (i === -1) return s;
        return s.slice(i + marker.length).replace(/^\r?\n/, "");
    },

    /**
     * @param {string} csvBody
     * @param {{ kind: string, title: string, details?: string[] }} meta
     * @returns {string}
     */
    csvWithExportManifest(csvBody, meta) {
        const esc = s => String(s ?? "").replace(/\r\n|\r|\n/g, " · ");
        const title = esc(meta && meta.title);
        const kind = esc(meta && meta.kind);
        const kindLabel =
            typeof I18n !== "undefined" && I18n.t ? esc(I18n.t("export.manifest.kindLabel")) : "Kind";
        const utcLabel =
            typeof I18n !== "undefined" && I18n.t
                ? esc(I18n.t("export.manifest.exportedUtcLabel"))
                : "Exported (UTC)";
        const localLabel =
            typeof I18n !== "undefined" && I18n.t
                ? esc(I18n.t("export.manifest.exportedLocalLabel"))
                : "Exported (local)";
        const details = Array.isArray(meta && meta.details) ? meta.details : [];
        const hint =
            typeof I18n !== "undefined" && I18n.t
                ? esc(I18n.t("export.manifest.csvHint"))
                : "Comment lines describe this file; data rows start after the --- line.";
        const lines = [
            "# Phoenix Cell G-NEEX",
            `# ${hint}`,
            `# Export: ${title}`,
            `# ${kindLabel}: ${kind}`,
            `# ${utcLabel}: ${new Date().toISOString()}`,
            `# ${localLabel}: ${this.formatDateTime(new Date())}`,
            ...details.map(d => `# ${esc(d)}`),
            this.CSV_DATA_MARKER,
            ""
        ];
        return lines.join("\r\n") + csvBody;
    },

    /** Subcarpetas bajo la carpeta del proyecto elegida por el usuario. */
    PROJECT_EXPORT_BACKUP: "Backup",
    /** CSV de informes, pedidos, inventario (vistas exportadas), etc. */
    PROJECT_EXPORT_INFORM: "Inform",
    PROJECT_EXPORT_PREVIOUS_PERIODS: "Previous_Periods",

    /** Handles de archivos adjuntos (lectura); no se copian archivos al proyecto. */
    _ATTACHMENT_FS_DB: "phoenix-attachment-handles",
    _ATTACHMENT_FS_STORE: "handles",

    _openAttachmentHandlesIdb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this._ATTACHMENT_FS_DB, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(this._ATTACHMENT_FS_STORE)) {
                    req.result.createObjectStore(this._ATTACHMENT_FS_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    canLinkLocalAttachments() {
        return typeof window.showOpenFilePicker === "function" && typeof indexedDB !== "undefined";
    },

    async _attachmentHandlePut(attachmentId, fileHandle) {
        const db = await this._openAttachmentHandlesIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._ATTACHMENT_FS_STORE, "readwrite");
            tx.objectStore(this._ATTACHMENT_FS_STORE).put(fileHandle, attachmentId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async _attachmentHandleGet(attachmentId) {
        const db = await this._openAttachmentHandlesIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._ATTACHMENT_FS_STORE, "readonly");
            const rq = tx.objectStore(this._ATTACHMENT_FS_STORE).get(attachmentId);
            rq.onsuccess = () => resolve(rq.result || null);
            rq.onerror = () => reject(rq.error);
        });
    },

    async removeLinkedAttachmentHandle(attachmentId) {
        if (!attachmentId) return;
        try {
            const db = await this._openAttachmentHandlesIdb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(this._ATTACHMENT_FS_STORE, "readwrite");
                tx.objectStore(this._ATTACHMENT_FS_STORE).delete(attachmentId);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn("removeLinkedAttachmentHandle", e);
        }
    },

    async _ensureFileHandleReadable(fileHandle) {
        try {
            const q = await fileHandle.queryPermission({ mode: "read" });
            if (q === "granted") return true;
            const r = await fileHandle.requestPermission({ mode: "read" });
            return r === "granted";
        } catch {
            return false;
        }
    },

    /**
     * Registra adjuntos como enlace al archivo original (sin copiar). Requiere showOpenFilePicker.
     * @param {FileSystemFileHandle[]} fileHandles
     * @returns {Promise<{ saved: object[] }>}
     */
    async saveLinkedAttachmentHandles(fileHandles) {
        const arr = Array.from(fileHandles || []).filter(Boolean);
        if (!arr.length) return { saved: [] };
        const saved = [];
        for (const handle of arr) {
            const id = this.generateId();
            try {
                const file = await handle.getFile();
                await this._attachmentHandlePut(id, handle);
                saved.push({
                    id,
                    originalName: file.name,
                    size: file.size || 0,
                    mimeType: file.type || "",
                    addedAt: new Date().toISOString(),
                    linkKind: "localHandle"
                });
            } catch (e) {
                console.error(e);
            }
        }
        return { saved };
    },

    /**
     * Abre el archivo enlazado en una pestaña (objeto temporal). No aplica a adjuntos antiguos con solo relPath en carpeta del proyecto.
     * @param {{ id?: string, relPath?: string, linkKind?: string } | null} meta
     * @returns {Promise<boolean>}
     */
    async openLinkedAttachment(meta) {
        if (!meta) return false;
        if (meta.relPath && meta.linkKind !== "localHandle") {
            if (typeof I18n !== "undefined" && I18n.t) {
                this.showToast(I18n.t("attachments.legacyNoOpen"), "info");
            }
            return false;
        }
        if (!meta.id) {
            if (typeof I18n !== "undefined" && I18n.t) {
                this.showToast(I18n.t("attachments.handleMissing"), "warning");
            }
            return false;
        }
        const handle = await this._attachmentHandleGet(meta.id);
        if (!handle) {
            if (typeof I18n !== "undefined" && I18n.t) {
                this.showToast(I18n.t("attachments.handleMissing"), "warning");
            }
            return false;
        }
        if (!(await this._ensureFileHandleReadable(handle))) {
            if (typeof I18n !== "undefined" && I18n.t) {
                this.showToast(I18n.t("msg.fsPermissionDenied"), "warning");
            }
            return false;
        }
        let file;
        try {
            file = await handle.getFile();
        } catch (e) {
            console.error(e);
            if (typeof I18n !== "undefined" && I18n.t) {
                this.showToast(I18n.t("attachments.openFailed"), "error");
            }
            return false;
        }
        const url = URL.createObjectURL(file);
        const w = window.open(url, "_blank", "noopener,noreferrer");
        if (!w) {
            URL.revokeObjectURL(url);
            if (typeof I18n !== "undefined" && I18n.t) {
                this.showToast(I18n.t("attachments.popupBlocked"), "warning");
            }
            return false;
        }
        window.setTimeout(() => URL.revokeObjectURL(url), 180000);
        return true;
    },

    /** Fecha y hora local para nombres de archivo (cada exportación es única). */
    _localBackupExportStamp() {
        const d = new Date();
        const y = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, "0");
        const da = String(d.getDate()).padStart(2, "0");
        const h = String(d.getHours()).padStart(2, "0");
        const mi = String(d.getMinutes()).padStart(2, "0");
        const s = String(d.getSeconds()).padStart(2, "0");
        return `${y}-${mo}-${da}_${h}-${mi}-${s}`;
    },

    /**
     * Fixed names for Backup folder / download: GNEEX_Backup_…json and GNEEX_Inventory_…csv
     */
    backupFolderFilename(kind) {
        const stamp = this._localBackupExportStamp();
        if (kind === "backup") return `GNEEX_Backup_${stamp}.json`;
        if (kind === "inventory") return `GNEEX_Inventory_${stamp}.xlsx`;
        if (kind === "movements") return `GNEEX_Movements_${stamp}.json`;
        if (kind === "transports") return `GNEEX_Transports_${stamp}.json`;
        return `GNEEX_export_${stamp}.txt`;
    },

    /** Extrae un array de movimientos desde JSON suelto, archivo de archivo, export propio o un respaldo completo (`data`). */
    extractMovementsArrayFromImportPayload(parsed) {
        if (!parsed) return null;
        if (Array.isArray(parsed)) return parsed;
        if (Array.isArray(parsed.movements)) return parsed.movements;
        if (Array.isArray(parsed._rawMovements)) return parsed._rawMovements;
        try {
            const data = parsed.data;
            if (data && typeof data === "object") {
                const raw = data[STORAGE_KEYS.MOVEMENTS];
                if (typeof raw === "string") {
                    const arr = JSON.parse(raw);
                    if (Array.isArray(arr)) return arr;
                }
            }
        } catch (e) {
            /* noop */
        }
        return null;
    },

    extractTransportsPayloadFromImport(parsed) {
        if (!parsed) return null;
        if (Array.isArray(parsed)) return { transports: parsed, pendingElecObra: {}, pendingElecProd: {} };
        if (Array.isArray(parsed.transports)) {
            return {
                transports: parsed.transports,
                pendingElecObra: parsed.pendingElecObra && typeof parsed.pendingElecObra === "object" ? parsed.pendingElecObra : {},
                pendingElecProd: parsed.pendingElecProd && typeof parsed.pendingElecProd === "object" ? parsed.pendingElecProd : {}
            };
        }
        try {
            const data = parsed.data;
            if (data && typeof data === "object") {
                const rawT = data[STORAGE_KEYS.TRANSPORT];
                const transports = typeof rawT === "string" ? JSON.parse(rawT) : null;
                if (Array.isArray(transports)) {
                    const rawObra = data[STORAGE_KEYS.PENDING_ELEC_OBRA];
                    const rawProd = data[STORAGE_KEYS.PENDING_ELEC_PROD];
                    return {
                        transports,
                        pendingElecObra: typeof rawObra === "string" ? JSON.parse(rawObra || "{}") : {},
                        pendingElecProd: typeof rawProd === "string" ? JSON.parse(rawProd || "{}") : {}
                    };
                }
            }
        } catch (e) {
            /* noop */
        }
        return null;
    },

    async exportMovementsJSON() {
        if (typeof Auth !== "undefined" && !Auth.guardImportExportFeatures()) return;
        try {
            const movements =
                typeof MovementManager !== "undefined" && MovementManager.movements
                    ? MovementManager.movements
                    : [];
            const now = new Date();
            const payload = {
                meta: {
                    format: "G-NEEX-movements-export",
                    version: 1,
                    app: "G-NEEX",
                    exportedAtUtc: now.toISOString(),
                    exportedAtLocal: this.formatDateTime(now),
                    movementCount: movements.length
                },
                movements
            };
            const content = JSON.stringify(payload, null, 2);
            const filename = this.backupFolderFilename("movements");
            const r = await this.writeProjectExportFile(this.PROJECT_EXPORT_BACKUP, filename, content, {
                bom: false
            });
            if (r === "ok") {
                if (typeof Auth !== "undefined") Auth.logAudit("movements.export.only", String(movements.length));
                this.showToast(I18n.t("msg.movementsExported"), "success");
                return;
            }
            if (r === "cancelled") return;
            this.downloadFile(content, filename, "application/json");
            if (typeof Auth !== "undefined") Auth.logAudit("movements.export.only", String(movements.length));
            this.showToast(I18n.t("msg.movementsExported"), "success");
        } catch (err) {
            console.error(err);
            this.showToast(I18n.t("msg.movementsExportError"), "error");
        }
    },

    async exportTransportsJSON(options = {}) {
        if (typeof Auth !== "undefined" && !Auth.guardImportExportFeatures()) return;
        try {
            const allTransports =
                typeof TransportManager !== "undefined" && Array.isArray(TransportManager.transports)
                    ? TransportManager.transports
                    : [];
            const shippedOnly = !!options?.shippedOnly;
            const transports = shippedOnly
                ? allTransports.filter(t => !!t?.expeditionShippedAt && !t?.expeditionAnnulled)
                : allTransports;
            if (!transports.length) {
                this.showToast(shippedOnly ? I18n.t("msg.transportsExportShippedEmpty") : I18n.t("msg.transportsMergeEmpty"), "warning");
                return;
            }
            const pendingElecObra =
                typeof TransportManager !== "undefined" && TransportManager.pendingElecObra
                    ? TransportManager.pendingElecObra
                    : {};
            const pendingElecProd =
                typeof TransportManager !== "undefined" && TransportManager.pendingElecProd
                    ? TransportManager.pendingElecProd
                    : {};
            const now = new Date();
            const payload = {
                meta: {
                    format: shippedOnly ? "G-NEEX-transports-export-shipped" : "G-NEEX-transports-export",
                    version: 1,
                    app: "G-NEEX",
                    exportedAtUtc: now.toISOString(),
                    exportedAtLocal: this.formatDateTime(now),
                    transportCount: transports.length,
                    scope: shippedOnly ? "shipped_only" : "all"
                },
                transports,
                pendingElecObra,
                pendingElecProd
            };
            const content = JSON.stringify(payload, null, 2);
            const filename = shippedOnly
                ? this.backupFolderFilename("transports").replace(".json", "_shipped.json")
                : this.backupFolderFilename("transports");
            const r = await this.writeProjectExportFile(this.PROJECT_EXPORT_BACKUP, filename, content, { bom: false });
            if (r === "ok") {
                this.showToast(shippedOnly ? I18n.t("msg.transportsExportShipped") : I18n.t("msg.transportsExported"), "success");
                return;
            }
            if (r === "cancelled") return;
            this.downloadFile(content, filename, "application/json");
            this.showToast(shippedOnly ? I18n.t("msg.transportsExportShipped") : I18n.t("msg.transportsExported"), "success");
        } catch (err) {
            console.error(err);
            this.showToast(options?.shippedOnly ? I18n.t("msg.transportsExportShippedError") : I18n.t("msg.transportsExportError"), "error");
        }
    },

    async exportReceptionsXlsx(receptions = [], opts = {}) {
        if (typeof Auth !== "undefined" && !Auth.guardReceptionsEdit()) return;
        const list = Array.isArray(receptions) ? receptions : [];
        if (!list.length) {
            this.showToast(I18n.t("msg.reportEmpty"), "warning");
            return;
        }
        const fmtDim = v => {
            const n = parseFloat(v) || 0;
            if (!(n > 0)) return "0";
            return String(this.roundDecimal(n, 4)).replace(/\.?0+$/, "");
        };
        const colWhen = I18n.t("reception.exportWhen");
        const colProject = I18n.t("reception.project");
        const colItem = I18n.t("reception.item");
        const colCat = I18n.t("reception.materialCategory");
        const colQty = I18n.t("reception.quantityShort");
        const colDims = I18n.t("reception.dimensionsCol");
        const colPo = I18n.t("reception.purchaseOrder");
        const colSup = I18n.t("reception.supplier");
        const colProv = I18n.t("reception.provisional");
        const colGlass = I18n.t("reception.glassPackingCol");
        const colPkg = I18n.t("transport.cargoPackageCol");
        const colL = I18n.t("transport.cargoAxisL");
        const colW = I18n.t("transport.cargoAxisW");
        const colH = I18n.t("transport.cargoAxisH");
        const headers = [
            colWhen,
            colProject,
            colItem,
            colCat,
            colQty,
            colDims,
            colPo,
            colSup,
            colProv,
            colGlass,
            colPkg,
            colL,
            colW,
            colH
        ];
        const rows = [];
        for (const r of list) {
            const d = r && r.dimensions ? r.dimensions : {};
            const unitDims = Array.isArray(r?.dimensionsItems) ? r.dimensionsItems : [];
            let glassPacking = "";
            if (r?.glassPacking === "standard_box") glassPacking = I18n.t("reception.glassPackingStandard");
            else if (r?.glassPacking === "loose_mixed") glassPacking = I18n.t("reception.glassPackingLoose");
            const cat = r?.materialCategory || "OTRO";
            const catLabel =
                I18n.t(`reception.mat.${cat}`) !== `reception.mat.${cat}` ? I18n.t(`reception.mat.${cat}`) : cat;
            const base = {
                [colWhen]: r?.dateReceived ? this.formatDateTime(r.dateReceived) : "",
                [colProject]: r?.projectId || "",
                [colItem]: r?.itemName || "",
                [colCat]: catLabel,
                [colQty]: r?.quantity ?? "",
                [colDims]: `${fmtDim(d?.L)}x${fmtDim(d?.W)}x${fmtDim(d?.H)}`,
                [colPo]: r?.purchaseOrder || "",
                [colSup]: r?.supplier || "",
                [colProv]: r?.provisional ? I18n.t("history.yes") : I18n.t("history.no"),
                [colGlass]: glassPacking
            };
            const n = Math.max(unitDims.length, 1);
            for (let i = 0; i < n; i++) {
                const p = unitDims[i] || {};
                rows.push({
                    ...base,
                    [colPkg]: unitDims.length ? String(i + 1) : "",
                    [colL]: unitDims.length ? fmtDim(p?.L) : "",
                    [colW]: unitDims.length ? fmtDim(p?.W) : "",
                    [colH]: unitDims.length ? fmtDim(p?.H) : ""
                });
            }
        }
        const selected = Array.isArray(opts?.selectedHeaders) && opts.selectedHeaders.length
            ? opts.selectedHeaders.filter(h => headers.includes(h))
            : headers;
        const projected = rows.map(r => {
            const o = {};
            selected.forEach(h => {
                o[h] = r[h] ?? "";
            });
            return o;
        });
        const scope = opts?.scopeLabel || I18n.t("history.filterAll");
        const filename = `GNEEX_Receptions_${this.fileStamp ? this.fileStamp() : new Date().toISOString().slice(0, 10)}.xlsx`;
        await this.exportStyledXlsxToInformFolder(filename, selected, projected, {
            kind: "receptions:filtered",
            title: I18n.t("export.manifest.receptions"),
            details: [`${I18n.t("export.manifest.rows")}: ${projected.length}`, `${I18n.t("history.filterType")}: ${scope}`]
        });
    },

    importMovementsMergeJSON(file) {
        if (typeof Auth !== "undefined" && !Auth.guardMergeMovementsImport()) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const parsed = JSON.parse(e.target.result);
                const arr = this.extractMovementsArrayFromImportPayload(parsed);
                if (!arr || !arr.length) {
                    this.showToast(I18n.t("msg.movementsMergeEmpty"), "warning");
                    return;
                }
                if (typeof MovementManager === "undefined" || !MovementManager.mergeMovementsFromImportArray) {
                    throw new Error("MovementManager.mergeMovementsFromImportArray");
                }
                const result = MovementManager.mergeMovementsFromImportArray(arr);
                if (result.added === 0) {
                    this.showToast(I18n.t("msg.movementsMergeNoneNew"), "info");
                    return;
                }
                let msg = I18n.t("msg.movementsMergeDone")
                    .replace("{added}", String(result.added))
                    .replace("{skipped}", String(result.skipped));
                if (result.receptionSkipped > 0) {
                    msg +=
                        " " +
                        I18n.t("msg.movementsMergeReceptionSkipped").replace(
                            "{n}",
                            String(result.receptionSkipped)
                        );
                }
                this.showToast(msg, result.receptionSkipped > 0 ? "warning" : "success");
                if (typeof Auth !== "undefined") {
                    Auth.logAudit("movements.merge.import", `${result.added} added, ${result.skipped} skipped`);
                }
            } catch (err) {
                console.error(err);
                this.showToast(I18n.t("msg.movementsMergeError"), "error");
            }
        };
        reader.readAsText(file);
    },

    importTransportsMergeJSON(file) {
        if (typeof Auth !== "undefined" && !Auth.guardMergeMovementsImport()) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const parsed = JSON.parse(e.target.result);
                const payload = this.extractTransportsPayloadFromImport(parsed);
                const arr = payload?.transports;
                if (!arr || !arr.length) {
                    this.showToast(I18n.t("msg.transportsMergeEmpty"), "warning");
                    return;
                }

                const manager = typeof TransportManager !== "undefined" ? TransportManager : null;
                const existing = manager && Array.isArray(manager.transports)
                    ? manager.transports.slice()
                    : (() => {
                        try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.TRANSPORT) || "[]"); } catch { return []; }
                    })();
                const existingIds = new Set(existing.map(t => String(t?.id || "")).filter(Boolean));
                let added = 0;
                for (const t of arr) {
                    if (!t || typeof t !== "object") continue;
                    const copy = JSON.parse(JSON.stringify(t));
                    if (!copy.id) copy.id = this.generateId();
                    const id = String(copy.id || "");
                    if (!id || existingIds.has(id)) continue;
                    existingIds.add(id);
                    existing.push(copy);
                    added++;
                }

                const mergePendingMap = (base, incoming) => {
                    const out = base && typeof base === "object" ? JSON.parse(JSON.stringify(base)) : {};
                    const src = incoming && typeof incoming === "object" ? incoming : {};
                    Object.keys(src).forEach(pid => {
                        const list = Array.isArray(src[pid]) ? src[pid] : [];
                        if (!Array.isArray(out[pid])) out[pid] = [];
                        const seen = new Set(out[pid].map(x => `${x?.movementId || ""}::${x?.ref || ""}`));
                        list.forEach(x => {
                            const key = `${x?.movementId || ""}::${x?.ref || ""}`;
                            if (seen.has(key)) return;
                            seen.add(key);
                            out[pid].push(x);
                        });
                    });
                    return out;
                };

                const baseObra = manager?.pendingElecObra || (() => {
                    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_ELEC_OBRA) || "{}"); } catch { return {}; }
                })();
                const baseProd = manager?.pendingElecProd || (() => {
                    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.PENDING_ELEC_PROD) || "{}"); } catch { return {}; }
                })();

                const mergedObra = mergePendingMap(baseObra, payload?.pendingElecObra);
                const mergedProd = mergePendingMap(baseProd, payload?.pendingElecProd);

                if (manager) {
                    manager.transports = existing.map(t => manager.migrateTransport(t));
                    manager.pendingElecObra = mergedObra;
                    manager.pendingElecProd = mergedProd;
                    manager.save();
                    manager.savePending();
                    manager.render();
                } else {
                    localStorage.setItem(STORAGE_KEYS.TRANSPORT, JSON.stringify(existing));
                    localStorage.setItem(STORAGE_KEYS.PENDING_ELEC_OBRA, JSON.stringify(mergedObra));
                    localStorage.setItem(STORAGE_KEYS.PENDING_ELEC_PROD, JSON.stringify(mergedProd));
                }

                if (added > 0) {
                    this.showToast(I18n.t("msg.transportsMergeDone").replace("{n}", String(added)), "success");
                } else {
                    this.showToast(I18n.t("msg.transportsMergeNoneNew"), "info");
                }
            } catch (err) {
                console.error(err);
                this.showToast(I18n.t("msg.transportsMergeError"), "error");
            }
        };
        reader.readAsText(file);
    },

    /** Archivo de movimientos archivados: rango desde–hasta (fechas locales YYYY-MM-DD) + marca de exportación. */
    archivedMovementsFilename(fromDateStr, toDateStr) {
        const stamp = this._localBackupExportStamp();
        return `GNEEX_Archived_Movements_${fromDateStr}_to_${toDateStr}_${stamp}.json`;
    },

    canWriteToProjectBackupFolder() {
        return typeof window.showDirectoryPicker === "function";
    },
    _FS_DB: "phoenix-fs-export",
    _FS_STORE: "handles",
    _FS_KEY_ROOT: "projectRoot",

    _openFsIdb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this._FS_DB, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(this._FS_STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async _idbGetRootHandle() {
        const db = await this._openFsIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._FS_STORE, "readonly");
            const rq = tx.objectStore(this._FS_STORE).get(this._FS_KEY_ROOT);
            rq.onsuccess = () => resolve(rq.result || null);
            rq.onerror = () => reject(rq.error);
        });
    },
    async _idbSetRootHandle(handle) {
        const db = await this._openFsIdb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this._FS_STORE, "readwrite");
            tx.objectStore(this._FS_STORE).put(handle, this._FS_KEY_ROOT);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    async _ensureDirWritable(handle) {
        try {
            const q = await handle.queryPermission({ mode: "readwrite" });
            if (q === "granted") return true;
            const r = await handle.requestPermission({ mode: "readwrite" });
            return r === "granted";
        } catch {
            return false;
        }
    },
    /** Carpeta raíz del proyecto (donde está index.html). Primera vez: diálogo del sistema (Chrome/Edge). */
    async getOrResolveProjectRootDir() {
        if (!this.canWriteToProjectBackupFolder()) return null;
        let handle = await this._idbGetRootHandle();
        if (handle && (await this._ensureDirWritable(handle))) return handle;
        this.showToast(I18n.t("msg.fsPickFolderHint"), "info", 12000);
        let picked;
        try {
            picked = await window.showDirectoryPicker({
                mode: "readwrite",
                id: "gneex-project-root"
            });
        } catch (e) {
            if (e && e.name === "AbortError") return null;
            console.error(e);
            this.showToast(
                (e && e.message) || I18n.t("msg.fsFolderPickerError"),
                "error",
                10000
            );
            return null;
        }
        await this._idbSetRootHandle(picked);
        return picked;
    },
    /**
     * Escribe en Backup/archivo (respaldo e inventario comparten esta carpeta).
     * @returns {"ok"|"cancelled"|"unsupported"}
     */
    async writeProjectExportFile(subFolder, filename, content, options = {}) {
        const { bom = true, binary = false } = options;
        if (!this.canWriteToProjectBackupFolder()) return "unsupported";
        let root;
        try {
            root = await this.getOrResolveProjectRootDir();
        } catch (e) {
            console.error(e);
            this.showToast(I18n.t("msg.fsFolderPickerError"), "error");
            return "unsupported";
        }
        if (!root) return "cancelled";
        if (!(await this._ensureDirWritable(root))) {
            this.showToast(I18n.t("msg.fsPermissionDenied"), "warning");
            return "cancelled";
        }
        try {
            const nameLc = (root.name || "").toLowerCase();
            const subLc = String(subFolder || "")
                .toLowerCase()
                .replace(/\s+/g, "_");
            const dest =
                nameLc === subLc
                    ? root
                    : await root.getDirectoryHandle(subFolder, { create: true });
            const fh = await dest.getFileHandle(filename, { create: true });
            const writable = await fh.createWritable();
            if (content instanceof Blob) {
                await writable.write(await content.arrayBuffer());
            } else if (content instanceof ArrayBuffer || content instanceof Uint8Array) {
                await writable.write(content);
            } else if (binary && typeof content !== "string") {
                await writable.write(content);
            } else {
                if (bom) await writable.write("\ufeff");
                await writable.write(content);
            }
            await writable.close();
            return "ok";
        } catch (e) {
            console.error(e);
            this.showToast(
                `${I18n.t("msg.fsWriteError")}: ${e && e.message ? e.message : e}`,
                "error",
                12000
            );
            return "unsupported";
        }
    },

    /**
     * Guarda un CSV en la subcarpeta Inform del proyecto (informes, pedidos, exportes de inventario/alertas).
     * Mismo flujo de permisos que el respaldo JSON (carpeta raíz del proyecto). Sin API o si cancela: descarga.
     * @returns {Promise<"ok"|"cancelled"|"downloaded">}
     */
    /**
     * @param {string} filename
     * @param {string} csv
     * @param {{ kind: string, title: string, details?: string[] } | null} [manifestMeta] Si se indica, se anteponen líneas # legibles (tipo, fecha…).
     */
    async exportCsvToInformFolder(filename, csv, manifestMeta = null) {
        const payload =
            manifestMeta && typeof manifestMeta === "object"
                ? this.csvWithExportManifest(csv, manifestMeta)
                : csv;
        if (!this.canWriteToProjectBackupFolder()) {
            this.downloadFile(payload, filename);
            if (typeof I18n !== "undefined") this.showToast(I18n.t("msg.dataExported"), "success");
            return "downloaded";
        }
        const r = await this.writeProjectExportFile(this.PROJECT_EXPORT_INFORM, filename, payload, { bom: true });
        if (r === "ok") {
            if (typeof I18n !== "undefined") this.showToast(I18n.t("msg.dataExported"), "success");
            return "ok";
        }
        if (r === "cancelled") return "cancelled";
        this.downloadFile(payload, filename);
        if (typeof I18n !== "undefined") this.showToast(I18n.t("msg.dataExported"), "success");
        return "downloaded";
    },

    // Toasts y debounce igual que antes
    showToast(msg,type='info',durationMs=6500){
        let c=document.getElementById('toast-container');
        if(!c){
            c=document.createElement('div');
            c.id='toast-container';
            c.className='toast-container';
            document.body.appendChild(c);
        }
        const t=document.createElement('div');
        t.className=`toast ${type}`;
        const m=document.createElement('div');
        m.className='toast-msg';
        m.textContent=String(msg ?? '');
        const x=document.createElement('button');
        x.type='button';
        x.className='toast-close';
        x.setAttribute('aria-label','Close');
        x.textContent='×';
        x.addEventListener('click',()=>t.remove());
        t.appendChild(m);
        t.appendChild(x);
        c.appendChild(t);
        const ms=typeof durationMs==='number'&&durationMs>0?durationMs:6500;
        setTimeout(()=>t.remove(),ms);
    },
    debounce(fn,w=300){let tm;return(...a)=>{clearTimeout(tm);tm=setTimeout(()=>fn(...a),w);}},

    /** Copia texto al portapapeles (Clipboard API o fallback). Usado por pulsación larga en códigos y otros módulos. */
    async copyTextToClipboard(text) {
        const raw = String(text || "").trim();
        if (!raw) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(raw);
                return true;
            }
        } catch (e) {
            /* fallback below */
        }
        try {
            const ta = document.createElement("textarea");
            ta.value = raw;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return !!ok;
        } catch (e2) {
            return false;
        }
    },

    // Exportadores generales --------------------------------------
    async exportDataCSV(key, filename) {
        const stored = localStorage.getItem(key);
        if (!stored) {
            this.showToast(I18n.t("msg.noDataToExport"), "warning");
            return;
        }
        const json = JSON.parse(stored);
        const headers = Object.keys(json[0] || {});
        const manifest = {
            kind: `storage:${String(key)}`,
            title:
                typeof I18n !== "undefined" && I18n.t
                    ? I18n.t("export.manifest.genericStorage").replace("{key}", String(key))
                    : `Local storage export (${key})`,
            details:
                typeof I18n !== "undefined" && I18n.t
                    ? [`${I18n.t("export.manifest.storageKeyLabel")}: ${String(key)}`]
                    : [`Key: ${String(key)}`]
        };
        let fn = String(filename || "export.xlsx");
        if (!/\.xlsx$/i.test(fn)) fn = fn.replace(/\.csv$/i, "") + ".xlsx";
        await this.exportStyledXlsxToInformFolder(fn, headers, json, manifest);
    },
    /**
     * @param {{ silentToast?: boolean }} [options] Si `silentToast`, no muestra el aviso genérico «datos importados» (el caller muestra su propio mensaje).
     */
    importDataCSV(file, key, callback, options = {}) {
        const silentToast = !!(options && options.silentToast);
        const finish = parsed => {
            try {
                localStorage.setItem(key, JSON.stringify(parsed));
                if (callback) callback(parsed);
                if (!silentToast) this.showToast(I18n.t("msg.dataImported"), "success");
            } catch (err) {
                console.error(err);
                this.showToast(I18n.t("msg.errorImportingData"), "error");
            }
        };

        const nameLc = (file && file.name) ? String(file.name).toLowerCase() : "";
        const isExcel = nameLc.endsWith(".xlsx") || nameLc.endsWith(".xls");

        if (isExcel) {
            const reader = new FileReader();
            reader.onload = e => {
                try {
                    const XLSX = typeof window !== "undefined" ? window.XLSX : null;
                    if (!XLSX || typeof XLSX.read !== "function") {
                        this.showToast(I18n.t("msg.errorImportingData"), "error");
                        return;
                    }
                    const buf = new Uint8Array(e.target.result);
                    const wb = XLSX.read(buf, { type: "array" });
                    const names = wb.SheetNames || [];
                    const sheetName =
                        names.find(n => String(n).toLowerCase() === "datos") ||
                        names.find(n => String(n).toLowerCase() !== "info") ||
                        names[0];
                    const sheet = sheetName ? wb.Sheets[sheetName] : null;
                    if (!sheet) {
                        this.showToast(I18n.t("msg.errorImportingData"), "error");
                        return;
                    }
                    const parsed = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
                    finish(parsed);
                } catch (err) {
                    console.error(err);
                    this.showToast(I18n.t("msg.errorImportingData"), "error");
                }
            };
            reader.readAsArrayBuffer(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = e => {
            try {
                const parsed = this.parseCSV(this.stripCsvPreamble(e.target.result));
                finish(parsed);
            } catch (err) {
                console.error(err);
                this.showToast(I18n.t("msg.errorImportingData"), "error");
            }
        };
        reader.readAsText(file);
    },

    async exportZIP(){
        if (typeof Auth !== "undefined" && !Auth.guardImportExportFeatures()) return;
        try {
            const backup = {};
            // Cada clave en STORAGE_KEYS (incl. empleados, ocasionales, proveedores) entra en data; SESSION se anula para no copiar la sesión.
            Object.values(STORAGE_KEYS).forEach(key => {
                // No incluir sesión: al importar el respaldo en otro equipo no debe abrir ya logueado como quien exportó.
                if (key === STORAGE_KEYS.SESSION) {
                    backup[key] = null;
                } else {
                    backup[key] = localStorage.getItem(key);
                }
            });

            const inventorySnapshot = (() => {
                try {
                    const raw = backup[STORAGE_KEYS.INVENTORY];
                    const items = JSON.parse(raw || "[]");
                    if (!Array.isArray(items)) return null;
                    const boxRows = [];
                    const locationRows = [];
                    let itemsWithBoxes = 0;
                    let itemsWithLocationStocks = 0;
                    for (const it of items) {
                        const code = String(it?.code || "").trim();
                        const boxStocks = Array.isArray(it?.boxStocks) ? it.boxStocks : [];
                        const locationStocks = Array.isArray(it?.locationStocks) ? it.locationStocks : [];
                        if (boxStocks.length) itemsWithBoxes++;
                        if (locationStocks.length) itemsWithLocationStocks++;
                        for (const b of boxStocks) {
                            const n = parseInt(b?.boxNumber, 10);
                            if (!Number.isFinite(n) || n < 1) continue;
                            boxRows.push({
                                code,
                                boxNumber: n,
                                locationLabel: String(b?.locationLabel || "").trim(),
                                qty: Number.isFinite(parseFloat(b?.qty)) ? parseFloat(b.qty) : 0,
                                qtyBoxes: Math.max(0, parseInt(b?.qtyBoxes, 10) || 0),
                                empty: !!b?.empty
                            });
                        }
                        for (const ls of locationStocks) {
                            const location = String(ls?.location || "").trim();
                            const qty = parseFloat(ls?.qty) || 0;
                            if (!location || qty <= 0) continue;
                            locationRows.push({ code, location, qty });
                        }
                    }
                    return {
                        itemCount: items.length,
                        itemsWithBoxes,
                        itemsWithLocationStocks,
                        boxRows,
                        locationRows
                    };
                } catch {
                    return null;
                }
            })();

            const now = new Date();
            const content = JSON.stringify({
                exportedAt: now.toISOString(),
                app: "G-NEEX",
                meta: {
                    format: "G-NEEX-backup",
                    exportTitle:
                        typeof I18n !== "undefined" && I18n.t ? I18n.t("export.manifest.backupFullTitle") : "Full local database backup",
                    exportedAtUtc: now.toISOString(),
                    exportedAtLocal: this.formatDateTime(now),
                    inventoryExpiration: {
                        description: "phoenix-inventory items include expDate, daysToExpire, expirationDate, shelfLifeMonths, expirations[]"
                    },
                    inventoryBoxes: inventorySnapshot
                        ? {
                            itemCount: inventorySnapshot.itemCount,
                            itemsWithBoxes: inventorySnapshot.itemsWithBoxes,
                            itemsWithLocationStocks: inventorySnapshot.itemsWithLocationStocks,
                            boxRowsCount: inventorySnapshot.boxRows.length,
                            locationRowsCount: inventorySnapshot.locationRows.length
                        }
                        : null
                },
                artifacts: {
                    inventoryBoxStockSnapshot: inventorySnapshot
                        ? {
                            headers: ["Codigo", "Caja", "UbicacionCaja", "CantidadCaja", "CantidadCajas", "Vacia"],
                            rows: inventorySnapshot.boxRows.map(r => ({
                                Codigo: r.code,
                                Caja: r.boxNumber,
                                UbicacionCaja: r.locationLabel,
                                CantidadCaja: r.qty,
                                CantidadCajas: r.qtyBoxes,
                                Vacia: r.empty ? 1 : 0
                            }))
                        }
                        : null,
                    inventoryLocationStockSnapshot: inventorySnapshot
                        ? {
                            headers: ["Codigo", "Ubicacion", "Cantidad"],
                            rows: inventorySnapshot.locationRows.map(r => ({
                                Codigo: r.code,
                                Ubicacion: r.location,
                                Cantidad: r.qty
                            }))
                        }
                        : null
                },
                data: backup
            }, null, 2);

            const filename = this.backupFolderFilename("backup");
            const r = await this.writeProjectExportFile(this.PROJECT_EXPORT_BACKUP, filename, content, {
                bom: false
            });
            if (r === "ok") {
                localStorage.setItem("phoenix-last-backup", new Date().toISOString());
                this.showToast(I18n.t("msg.backupExported"), "success");
                if (typeof Dashboard !== "undefined" && Dashboard.refresh) Dashboard.refresh();
                return;
            }
            if (r === "cancelled") return;
            this.downloadFile(content, filename, "application/json");
            localStorage.setItem("phoenix-last-backup", new Date().toISOString());
            this.showToast(I18n.t("msg.backupExported"), "success");
            if (typeof Dashboard !== "undefined" && Dashboard.refresh) Dashboard.refresh();
        } catch (err) {
            console.error(err);
            this.showToast(I18n.t("msg.backupExportError"), "error");
        }
    },

    importBackupJSON(file){
        if (typeof Auth !== "undefined" && !Auth.getCurrentUser()) {
            this.showToast(I18n.t("auth.noPermission"), "warning");
            return;
        }
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const parsed = JSON.parse(e.target.result);
                const data = parsed?.data;
                if (!data || typeof data !== "object") {
                    throw new Error(I18n.t("msg.invalidBackupFormat"));
                }

                const normalizeInventoryPayload = raw => {
                    try {
                        const arr = JSON.parse(raw || "[]");
                        if (!Array.isArray(arr)) return raw;
                        const normalized = arr.map(it => {
                            const boxStocks = Array.isArray(it?.boxStocks) ? it.boxStocks : [];
                            const locationStocks = Array.isArray(it?.locationStocks) ? it.locationStocks : [];
                            return { ...it, boxStocks, locationStocks };
                        });
                        return JSON.stringify(normalized);
                    } catch {
                        return raw;
                    }
                };
                if (Object.prototype.hasOwnProperty.call(data, STORAGE_KEYS.INVENTORY) && data[STORAGE_KEYS.INVENTORY] != null) {
                    data[STORAGE_KEYS.INVENTORY] = normalizeInventoryPayload(data[STORAGE_KEYS.INVENTORY]);
                }

                const movKey = STORAGE_KEYS.MOVEMENTS;
                if (Object.prototype.hasOwnProperty.call(data, movKey) && data[movKey] != null) {
                    try {
                        const arr = JSON.parse(data[movKey]);
                        if (Array.isArray(arr)) {
                            const mig = Utils.applyImportedMovementReferencePrefixing(arr);
                            if (mig.changed) {
                                data[movKey] = JSON.stringify(arr);
                                Utils.patchLinkedRefsAfterMovementRefMigrate(mig.refMap, data);
                            }
                        }
                    } catch (err) {
                        console.warn("Normalización de referencias en respaldo omitida:", err);
                    }
                }

                Object.values(STORAGE_KEYS).forEach(key => {
                    const value = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
                    if (value === null || typeof value === "undefined") {
                        localStorage.removeItem(key);
                    } else {
                        localStorage.setItem(key, value);
                    }
                });

                this.showToast(I18n.t("msg.backupImportedReload"), "success");
                setTimeout(() => window.location.reload(), 500);
            } catch (err) {
                console.error(err);
                this.showToast(I18n.t("msg.backupImportError"), "error");
            }
        };
        reader.readAsText(file);
    }
};
