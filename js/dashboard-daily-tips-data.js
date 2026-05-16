/**
 * Consejos del día (panel): uno por cada día del año civil (366 posiciones; 29 feb. en bisiesto).
 * Texto compuesto con dos frases descriptivas; sin numeración ni metadatos en pantalla.
 * El índice sigue el día local del dispositivo (cambia a medianoche local).
 */
(function (global) {
  const DAY_COUNT = 366;

  const PREFIX_ES = ["Sabía que", "En G-NEEX,", "Consejo práctico:", "Atajo útil:", "Curiosidad:", "Recuerde:"];
  const PREFIX_EN = ["Did you know", "In G-NEEX,", "Practical tip:", "Handy shortcut:", "Worth noting:", "Remember:"];
  const PREFIX_FR = ["Le saviez-vous :", "Dans G-NEEX,", "Astuce concrète :", "Raccourci utile :", "À noter :", "Rappel :"];

  const CORE_ES = [
    "el logo del encabezado abre «Actualizar inventario» (normalizar, stock, caducidades, N.º cajas).",
    "puede pulsar dos veces el código en inventario (admin) para abrir la edición del artículo.",
    "las filas con borde turquesa avisan de datos incompletos que afectan cálculos; pase el ratón por la fila para el detalle.",
    "la barra naranja en fila indica caducidad próxima dentro del umbral de alerta.",
    "la barra morada en fila indica caducidad activada pero sin datos suficientes para calcular fechas.",
    "el stock principal se muestra como pastilla: rojo negativo, violeta sobre-stock, naranja vencido, ámbar por vencer.",
    "los consumibles de inventario llevan marca en la primera celda y no siguen las mismas reglas de caducidad.",
    "un artículo con «problemas» muestra código y descripción en pastilla roja pulsante.",
    "el buscador de inventario incluye categoría y ubicación, no solo código.",
    "el filtro «fecha de corte» reconstruye stock a fin del día elegido.",
    "los movimientos Stand-by no mueven stock hasta liberarlos a otro tipo.",
    "el historial guarda filtros útiles: combine fechas y tipo de movimiento.",
    "las referencias de movimiento (prefijo + número) son el identificador estable para reclamos.",
    "en transporte, marcar expedido al salir evita perseguir envíos días después.",
    "los pedidos a proveedor muestran líneas activas en el panel y en el carrusel.",
    "desde pedidos puede abrir recepciones enlazadas al mismo flujo de compra.",
    "el carrusel del panel rota cada pocos segundos; al pasar el ratón se pausa.",
    "exporte JSON antes de importaciones masivas: es su red de seguridad.",
    "los lotes en el artículo permiten FEFO con caducidad por compra.",
    "si activa «controlar caducidad», complete vida útil o fechas para que las alertas tengan sentido.",
    "la gestión de stock por caja puede recalcular N.º cajas con cantidad ÷ cantidad por caja.",
    "las cajas marcadas vacías no recalculan N.º cajas en el actualizador global.",
    "el modo caja negra incontable exige cantidad máxima por caja al guardar.",
    "las unidades de medida opcionales ayudan en etiquetas de stock si las configura.",
    "el PIN de edición de artículos limita quién cambia mínimos y máximos.",
    "ignore alerta de bajo stock por artículo si es un falso positivo recurrente.",
    "el panel de alertas abre listados detallados con exportación a XLSX.",
    "los recordatorios aparecen en el carrusel si tiene permiso y hay pendientes.",
    "el consumo diario agrupa líneas hasta procesarlas en un solo movimiento.",
    "si un movimiento dejaría stock negativo, la app pide motivo antes de confirmar.",
    "las recepciones de material pueden dejar stock provisional según categoría.",
    "los transformadores en configuración habilitan destinos en movimientos de transformación.",
    "el globo flotante de Stand-by aparece al usar ese tipo y se puede arrastrar.",
    "las impresiones de tablas usan A4 vertical con columnas legibles.",
    "puede imprimir inventario filtrado para conteos en almacén.",
    "los chips de ubicación y caja en inventario saltan a filtros o gestión.",
    "el resumen por caja desde texto de ubicación agrupa variantes BOX1 / caja 1.",
    "los informes XLSX de movimientos respetan los filtros del historial.",
    "archivar movimientos antiguos reduce tamaño y genera JSON de archivo.",
    "la bienvenida animada solo se muestra al iniciar sesión, no en cada recarga de pestaña.",
    "un ID de proyecto coherente en recepciones y transporte evita duplicados ficticios en informes.",
    "las líneas de transporte muestran M.E. obra y producción pendientes hasta vincular movimientos.",
    "los pedidos cancelados o recepcionados al 100 % dejan de contar como «activos» en el panel.",
    "el tablero «Actividad de hoy» enlaza cada tipo de movimiento al historial ya filtrado.",
    "los artículos con mínimo y máximo bien puestos reducen ruido en alertas de sobre-stock.",
    "guardar notas en movimiento (motivo, obra, contacto) facilita reclamaciones semanas después."
  ];

  const CORE_EN = [
    "the header logo runs “Update inventory” (normalize, stock, lot expiry, box counts).",
    "admins can double-click a code cell in Inventory to jump to the item editor.",
    "turquoise-outlined rows flag incomplete data that affects calculations—hover the row for details.",
    "an orange row bar means expiry is within your configured alert window.",
    "a purple row bar means expiry tracking is on but dates cannot be computed yet.",
    "main stock is a pill: red negative, violet over-max, orange expired, amber expiring soon.",
    "inventory-consumable items show a marker on the first cell and skip strict expiry rules.",
    "items with a “problems” note pulse red on code and description.",
    "inventory search matches category and location, not only code.",
    "the as-of-date filter reconstructs stock at end of the chosen day.",
    "Stand-by movements do not touch stock until you release them to another type.",
    "History keeps rich filters—pair date range with movement type.",
    "movement references (prefix + number) are the stable handle for disputes.",
    "mark transports shipped when loads leave to avoid “where is it?” later.",
    "supplier order lines show in the dashboard cards and carousel when active.",
    "from Orders you can open receipts tied to the same stock flow.",
    "the dashboard carousel auto-advances; hover pauses the rotation.",
    "export JSON before big imports—it is your safety net.",
    "per-item lots enable FEFO with purchase-based expiry.",
    "if “track expiry” is on, add shelf life or dates so alerts stay meaningful.",
    "per-box stock can auto-fill small-box counts from quantity ÷ units per box.",
    "rows marked empty skip that auto box-count in the global updater.",
    "black-box “uncountable” mode requires a max units-per-box value to save.",
    "optional measure units improve stock labels when configured.",
    "the item-edit PIN limits who can change mins and maxes.",
    "per-item “ignore low-stock alert” silences noisy false positives.",
    "the alerts card opens detail modals with XLSX export.",
    "reminders appear in the carousel when permitted and pending.",
    "daily consumption batches lines until you process one movement.",
    "if a movement would go negative, the app asks for a reason before confirm.",
    "material receptions may leave provisional stock by category rules.",
    "transformation companies in Settings unlock transformation destinations.",
    "the Stand-by floating bubble appears after you use that type and can be dragged.",
    "printable tables target A4 portrait with readable columns.",
    "print filtered inventory for floor counts without a laptop in every aisle.",
    "location and box chips in Inventory jump to filters or box management.",
    "the box summary from location text groups BOX1 / “caja 1” variants.",
    "movement XLSX exports respect History filters.",
    "archiving old movements shrinks storage and emits an archive JSON.",
    "the cinematic welcome splash runs on login, not on every tab reload.",
    "a consistent project ID across receipts and transport keeps reports from splitting the same job.",
    "transport lines surface pending site and production electrical refs until movements are linked.",
    "orders that are cancelled or fully received stop counting as “open” on the dashboard.",
    "the “Today” board links each movement chip to History with today’s filter.",
    "sensible mins and maxes cut down meaningless overstock alerts.",
    "notes on movements (reason, job, contact) make week-later disputes much easier to resolve."
  ];

  const CORE_FR = [
    "le logo d’en-tête lance « Mettre à jour l’inventaire » (normaliser, stock, lots, petites caisses).",
    "un admin peut double-cliquer le code en inventaire pour ouvrir l’édition d’article.",
    "un contour turquoise signale des données incomplètes pour les calculs — survolez la ligne pour le détail.",
    "une barre orange indique une péremption dans la fenêtre d’alerte.",
    "une barre violette indique un suivi actif mais des dates encore incalculables.",
    "le stock principal est une pastille : rouge négatif, violet sur-stock, orange périmé, ambre bientôt périmé.",
    "les articles « consommables inventaire » ont un repère sur la première cellule et d’autres règles.",
    "un article avec « problèmes » pulse en rouge sur le code et la description.",
    "la recherche inventaire couvre catégorie et emplacement, pas seulement le code.",
    "le filtre « à la date » reconstitue le stock à la fin du jour choisi.",
    "le Stand-by ne touche pas le stock tant qu’il n’est pas libéré vers un autre type.",
    "l’historique garde des filtres riches : dates + type de mouvement.",
    "les références (préfixe + numéro) sont la poignée stable pour litiges.",
    "marquez expédié quand le chargement part pour éviter les traques une semaine après.",
    "les lignes de commande fournisseur apparaissent au tableau de bord et au carrousel.",
    "depuis Commandes vous ouvrez des réceptions liées au même flux.",
    "le carrousel avance tout seul ; le survol met en pause.",
    "exportez un JSON avant grosses importations : filet de sécurité.",
    "les lots par article permettent le FEFO avec péremption par achat.",
    "si le suivi de péremption est actif, renseignez durée de vie ou dates pour des alertes utiles.",
    "le stock par caisse peut recalculer le nombre de petites caisses = quantité ÷ quantité par caisse.",
    "les caisses marquées vides ne sont pas recalculées dans la mise à jour globale.",
    "le mode caisse noire « inquantifiable » exige un max par caisse à l’enregistrement.",
    "les unités de mesure optionnelles améliorent les libellés si vous les configurez.",
    "le PIN d’édition d’articles limite qui change min / max.",
    "« ignorer alerte sous-stock » coupe les faux positifs bruyants.",
    "la carte alertes ouvre des modales détaillées avec export XLSX.",
    "les rappels apparaissent au carrousel si autorisés et en attente.",
    "la consommation quotidienne regroupe les lignes jusqu’au traitement unique.",
    "si un mouvement rendrait le stock négatif, l’app demande un motif avant validation.",
    "les réceptions matière peuvent laisser du stock provisoire selon la catégorie.",
    "les transformateurs dans Configuration débloquent les destinations de transformation.",
    "le raccourci flottant Stand-by apparaît après usage et se déplace au drag.",
    "les impressions ciblent A4 portrait avec colonnes lisibles.",
    "imprimez l’inventaire filtré pour des inventaires terrain.",
    "les puces emplacement / caisse sautent vers filtres ou gestion des caisses.",
    "le résumé par caisse regroupe BOX1 / « caja 1 » dans le texte d’emplacement.",
    "les exports XLSX de mouvements respectent les filtres d’historique.",
    "archiver d’anciens mouvements réduit la taille et produit un JSON d’archive.",
    "l’écran d’accueil animé s’affiche à la connexion, pas à chaque rechargement d’onglet.",
    "un identifiant de projet stable entre réceptions et transport évite les doublons factices dans les rapports.",
    "les lignes de transport montrent les M.É. chantier et production en attente tant que les mouvements ne sont pas liés.",
    "les commandes annulées ou entièrement réceptionnées ne comptent plus comme « ouvertes » sur le tableau de bord.",
    "le tableau « Activité du jour » relie chaque type de mouvement à l’historique déjà filtré.",
    "des minima et maxima cohérents réduisent le bruit des alertes de sur-stock.",
    "des notes sur le mouvement (motif, chantier, contact) facilitent les litiges plusieurs semaines après."
  ];

  const TAIL_CONN_ES = [
    "Como hábito de almacén,",
    "Antes de cerrar jornada,",
    "Si comparte el equipo con otros turnos,",
    "Cuando prepare un cierre de obra o de mes,",
    "Si ve picos de consumo o recepciones seguidas,",
    "Para formar a alguien nuevo sin perder trazabilidad,",
    "En periodos de muchas entregas al taller,",
    "Si está depurando datos viejos,",
    "Cuando audite diferencias entre piso y sistema,",
    "Para que el siguiente compañero no reinvente el hilo,"
  ];

  const TAIL_CONN_EN = [
    "As a warehouse habit,",
    "Before you clock out,",
    "If crews share the same device across shifts,",
    "When you close out a job or month-end,",
    "If you see bursts of consumption or back-to-back receipts,",
    "When onboarding someone without losing traceability,",
    "During heavy delivery weeks to the shop,",
    "While cleaning up legacy master data,",
    "When reconciling floor counts to the system,",
    "So the next teammate can pick up the thread,"
  ];

  const TAIL_CONN_FR = [
    "Comme habitude d’entrepôt,",
    "Avant de terminer la journée,",
    "Si plusieurs postes partagent le même poste de travail,",
    "Lors d’une clôture de chantier ou de fin de mois,",
    "En cas de pics de consommation ou de réceptions en rafale,",
    "Pour former quelqu’un sans perdre la traçabilité,",
    "Lors des semaines chargées en livraisons atelier,",
    "Pendant que vous nettoyez d’anciennes données,",
    "Quand vous rapprochez stock physique et système,",
    "Pour que le collègue suivant reprenne sans tout rechercher,"
  ];

  const POOL_LEN = 67;

  function sentPrefixCore(prefix, coreFrag) {
    const c = coreFrag.trim();
    const mid = c.charAt(0).toUpperCase() + c.slice(1);
    let s = `${prefix} ${mid}`.replace(/\s+/g, " ").trim();
    if (!/[.!?;:]$/.test(s)) s += ".";
    return s;
  }

  function sentTailConn(conn, coreFrag) {
    const c = coreFrag.trim();
    const low = c.charAt(0).toLowerCase() + c.slice(1);
    let s = `${conn} ${low}`.replace(/\s+/g, " ").trim();
    if (!/[.!?]$/.test(s)) s += ".";
    return s;
  }

  function buildPools(lang) {
    const pre = lang === "en" ? PREFIX_EN : lang === "fr" ? PREFIX_FR : PREFIX_ES;
    const core = lang === "en" ? CORE_EN : lang === "fr" ? CORE_FR : CORE_ES;
    const conn = lang === "en" ? TAIL_CONN_EN : lang === "fr" ? TAIL_CONN_FR : TAIL_CONN_ES;
    const head = [];
    const tail = [];
    const cLen = core.length;
    for (let j = 0; j < POOL_LEN; j++) {
      head.push(sentPrefixCore(pre[j % pre.length], core[j % cLen]));
      tail.push(sentTailConn(conn[j % conn.length], core[(j * 11 + 17) % cLen]));
    }
    return { head, tail };
  }

  const cache = { es: null, en: null, fr: null };

  function poolsFor(lang) {
    const key = lang === "en" || lang === "fr" ? lang : "es";
    if (!cache[key]) cache[key] = buildPools(key);
    return cache[key];
  }

  function normalizeLang(lang) {
    const raw = String(lang || "es").toLowerCase();
    if (raw.startsWith("en")) return "en";
    if (raw.startsWith("fr")) return "fr";
    return "es";
  }

  function getTip(index, lang) {
    let i = Math.floor(Number(index));
    if (!Number.isFinite(i)) i = 0;
    i = ((i % DAY_COUNT) + DAY_COUNT) % DAY_COUNT;
    const loc = normalizeLang(lang);
    const { head, tail } = poolsFor(loc);
    const a = head[(i * 11) % POOL_LEN];
    const b = tail[(i * 13) % POOL_LEN];
    return `${a} ${b}`.replace(/\s+/g, " ").trim();
  }

  /** Índice 0..365 según día del año local (366 en 31-dic de año bisiesto → 365). */
  function dayIndex() {
    const d = new Date();
    const start = new Date(d.getFullYear(), 0, 0);
    const ord = Math.floor((d - start) / 86400000);
    return Math.min(ord, DAY_COUNT) - 1;
  }

  global.DashboardDailyTipsData = {
    DAY_COUNT,
    getTip,
    dayIndex
  };
})(typeof window !== "undefined" ? window : globalThis);
