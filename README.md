# G-neex

**SPA estática 100 % en el navegador** (HTML / CSS / JS vanilla) para gestión de inventario, movimientos, pedidos a proveedor, transporte y caducidades. Datos en `localStorage`, idiomas ES / EN / FR, temas claro / oscuro.

**Versión actual:** 1.7 (mayo 2026). Cambios destacados respecto a 1.6 al final de este README.

Material que **no** va en el despliegue estático de la SPA (manuales “fuente”, migración, respaldos de trabajo, documentación técnica, scripts auxiliares) está en **`no-deployar/`** — ver `no-deployar/README.md` y la lista **`no-deployar/docs/DEPLOY_CHECKLIST.md`** antes de publicar.

En la **raíz** del repo, la carpeta **`user-manual/`** contiene el manual HTML en ES / EN / FR y las capturas necesarias para que el botón **Ayuda → Manual de usuario** funcione en producción. Si actualiza los manuales en `no-deployar/User Manual/` (por ejemplo tras «ACTUALIZA AHORA»), copie de nuevo los `.html` y `app-screenshots` a `user-manual/` o ejecute el mismo proceso documentado en `no-deployar/README.md`.

## Servidor local (pruebas)

Sirva la app por **HTTP** con **una URL fija** para que `localStorage` (inventario, unidades, sesión, etc.) sea el mismo en cada recarga. No mezcle abrir `index.html` como **archivo** (`file://`) con abrir por **`http://127.0.0.1`** ni cambie de puerto a mitad de trabajo.

Abra una terminal en la **raíz del clon** (donde está `index.html`) y ejecute:

```powershell
py -m http.server 8765
```

En el navegador: **http://127.0.0.1:8765/** (carga `index.html`). Si el puerto está ocupado, use otro número y conserve ese marcador.

Si tiene Node.js, una alternativa es `npx --yes serve -l 8765` en la misma carpeta y abrir la URL que muestre la consola.

## Unidades de medida

- **Catálogo:** ⚙️ Configuración → **Unidades** (`localStorage` `phoenix-measure-units-catalog` y copia interna `phoenix-measure-units-catalog__bak`; incluido en el **respaldo JSON completo**).
- **Por defecto:** la app mantiene la unidad **U** en el catálogo (referencia genérica); **no** se asigna automáticamente a los artículos — pueden quedar sin unidad de stock hasta que elija una en el editor. No se puede eliminar **U** del catálogo.
- **Artículo:** en ⚙️ Edición de artículo se define **unidad de stock** y, opcionalmente, **equivalente** para la tabla de inventario (columna principal: símbolo + línea **≈** si hay cadena de equivalencias).
- **CSV/XLSX inventario:** columnas opcionales finales `UnidadStockSimbolo` y `UnidadEquivalenteSimbolo` (coincidencia por símbolo, sin distinguir mayúsculas).
- **Permiso:** acción fina `cfgTabMeasureUnits` (por defecto alineada con **Consumibles** / nivel de movimientos en la matriz).
- **Limitación:** los formularios de **movimientos** muestran cantidades numéricas como antes; la coherencia con la unidad del artículo es responsabilidad operativa (documentado en manuales).
- **Importar respaldo:** solo se sobrescribe o borra en `localStorage` lo que **vaya explícitamente** en el JSON; una clave ausente en un archivo viejo **no** vacía datos nuevos del navegador (p. ej. catálogo de unidades).

### Lista corta antes de producción (humo manual)

1. ⚙️ Unidades: crear equivalencia de prueba; ver conversión **≈** en inventario.
2. Edición de artículo: con y **sin** unidad de stock; guardar, **F5**, comprobar que persiste igual.
3. Misma URL: no mezclar `file://` con `http://` ni cambiar puerto a mitad de prueba (si algo «desaparece», revisar origen en la barra de direcciones).
4. Respaldo JSON: exportar, importar en copia de prueba; comprobar catálogo de unidades **y** mensaje/import sin borrar lo no incluido.
5. Respaldos antiguos (sin clave de unidades): importar → el catálogo local no debe borrarse por ausencia de clave.
6. Perfil no administrador: visibilidad de la pestaña **Unidades** según matriz de permisos.

### Pase rápido anti-regresiones (~5–10 min)

| Área | Comprobar |
|------|-----------|
| Inventario | Filtros, clic en etiquetas caja/ubicación sin error de consola |
| Unidades | Añadir símbolo, F5, sigue listado; **U** no se puede eliminar |
| Artículo | Sin unidad en selector → guardar → tabla sin sufijo de unidad; con unidad → símbolo visible |
| Respaldo | Export JSON; en otro perfil/pestaña de prueba importar sin pérdidas extrañas |
| Modo test | Entrar modo prueba, cambio menor, salir confirmando → estado previo restaurado |
| Consola | Abrir herramientas (F12): sin errores rojos al cargar y al cambiar de pestaña principal |

---

## Notas funcionales recientes (inventario y movimientos)

- La jerarquía operativa de stock es: `global (principal/producción/transformación) -> ubicación -> caja -> sin caja`.
- En inventario, la columna `Ubicación` muestra solo etiquetas detectadas interactivas cuando existen (sin duplicar texto libre).
- Clic en etiqueta de `caja` abre la gestión por caja del artículo/caja; clic en etiqueta de `ubicación` solo informa cantidad (toast) y no cambia filtros ni vista.
- En herramientas de inventario queda solo `Cajas sin unidades (total por caja)` para localizar cajas vacías reutilizables.
- En Ayuda, los enlaces de `Presentaciones` dentro de `user-manual/` se muestran solo para perfil administrador.
- En movimientos, la validación de `Origen stock` se aplica solo en tipos/líneas que descuentan stock desde ese origen; con sobregiro permitido exige causa obligatoria, y en los demás casos bloquea hasta corregir origen/distribución.
- **Pedidos ↔ Compra de stock:** el vínculo automático exige **mismo código de artículo** (pedido vs línea de compra) y **mismo proveedor**; el **número de PO/OC** se informa **por fila** en el formulario de Compra de stock y **no** se usa para decidir si la compra corresponde al pedido — al recepcionar, ese PO (y proveedor) actualizan la línea de pedido cuando aplica. Si registra la compra solo desde Movimientos y existe una línea pendiente que cumpla eso, pueden mostrarse cuadros **Sí / No** para enlazar y actualizar cantidad recibida, estado y acciones (véase manual §2.5). Otras confirmaciones siguen con **Confirmar / Cancelar** salvo ese flujo sí/no.
- **Historial:** filtro dedicado **Notas del movimiento** (texto parcial solo en el campo `notes`). El filtro por **código** de artículo ya **no** busca dentro de las notas del movimiento.
- **Historial → detalle:** con permiso de movimientos puede **añadir notas** al final del bloque (cabecera automática con fecha y usuario); el texto ya guardado no se sobrescribe desde ahí.
- **Inventario → gestión de stock por caja:** al **guardar** un cambio de cantidad con artículo vinculado y sincronización al principal, se registra un **AJUSTE** en movimientos (motivo opcional, como en el editor de artículo). Anulación y fusión de movimientos contemplan metadatos de caja en esas líneas.
- **Compatibilidad de respaldos:** los movimientos siguen siendo JSON estándar en `phoenix-movements`. Las líneas pueden incluir campos opcionales nuevos (`metaBoxMgrAjuste`, etc.); los archivos **antiguos sin esos campos** se importan y fusionan igual. El script `scripts/repair-backup-users.mjs` solo fusiona listas y deduplica por `id`; no elimina propiedades desconocidas.

---

## Novedades 1.7 (mayo 2026)

### Pantalla de bienvenida cinemática (~6 s)
Tras autenticarse, antes de mostrar el panel, arranca una secuencia tipo «boot up» cuya duración la define **`--welcome-duration`** en CSS (por defecto **6 s**). Sirve también como **margen de carga real de la app** (la inicialización pesada corre por detrás).

Coreografía:
1. **Fondo + grid HUD** entran en ~0.5 s (vignette naranja + rejilla técnica sutil).
2. **Scanner verde Matrix** (`#00ff41`) cruza la pantalla **lento** (2.6 s, velocidad constante) — se lee como «el sistema te está reconociendo».
3. **Logo arranca** con escala + **dos anillos orbitales** (uno discontinuo gira en bucle).
4. **«BIENVENIDO A»** se revela por **barrido (`clip-path`) con borde brillante naranja**.
5. **«G-neex»** hace **flicker fuerte tipo neón** (cuatro apagones bruscos a opacity 0, picos de glow a 48 px) antes de quedar encendido sostenido.
6. **«PHOENIX EVOLUTION»** entra expandiendo el `letter-spacing` (efecto «tracking out»).
7. **Nombre del usuario** se revela con sweep.
8. **Barra de progreso** lineal cubre casi toda la duración útil definida por `--welcome-duration` (p. ej. ~5,7 s en un total de 6 s).
9. **Fade-out** y entrada al panel.

Implementado en `Auth.showWelcomeSplash()` (`js/auth.js`) y bloque `#welcome-splash` (`index.html`). Estilo en `css/styles.css` (`@keyframes gneex-ws-*`). La duración es **una sola fuente de verdad** vía `--welcome-duration`: el JS la lee con `getComputedStyle()` para programar el cleanup. Cambias el CSS y todo se ajusta. Respeta `prefers-reduced-motion`. Se omite al recargar la pestaña (`sessionStorage`) y vuelve a salir tras `logout()`.

### Logo como atajo «Actualizar inventario»
El logo del header es ahora **clicable**. Al pulsarlo:
1. Da una vuelta antihoraria (≈900 ms, `@keyframes gneex-logo-spin-ccw`).
2. Dispara `Inventory.runRefreshInventoryDataAction()` — la acción unificada que ejecuta en este orden:
   - **Normalización de ubicaciones / cajas** (texto libre importado de respaldos antiguos → catálogo canónico, sincroniza `boxStocks` y `locationStocks`).
   - **Reconciliación de stock principal** (`mainStock = max(actual, suma(cajas + ubicaciones))`).
   - **Refresco de caducidades de lotes** (las calculadas se pasan a cálculo dinámico desde `shelfLifeMonths`; las escritas a mano se preservan).
3. Muestra un modal de confirmación con el detalle por sección antes de aplicar.

Misma acción accesible por el menú herramientas «↺ Actualizar inventario» y el botón oculto `#inventory-refresh-data-btn`. Accesible por teclado (Enter / Espacio) y respeta `prefers-reduced-motion`.

### Cajas integradas en el stock principal
- `upsertItemBoxStock` y `deleteItemBoxStock` ahora aceptan `syncMainStock: true` y mueven el delta a `mainStock`. Operaciones de compra y consumo desde caja actualizan ambos.
- Importaciones masivas (CSV / XLSX) tras tocar cajas dejan el stock principal coherente.

### Lotes y caducidades
- El editor de artículo incluye una sección **Lotes** con expedición, caducidad explícita opcional y cantidad por lote. La caducidad efectiva se calcula al vuelo con `shelfLifeMonths`.
- Compra de stock alimenta el editor con un lote por fila de fecha/cantidad y, si el artículo no tenía `expDate` o `expirationDate`, los autocompleta con la primera entrada.
- El tooltip de lotes en la tabla muestra una fila sintética «Sin lote (resto del stock principal)» **solo si hay al menos un lote explícito**, para que `total mostrado = mainStock`.

### Insight de caducidad con cantidad afectada
En **Caducidad: vencidos o próximos a vencer** se añadió una columna **Cantidad afectada**: suma de unidades en lotes vencidos + próximos a vencer, con desglose en tooltip.

### Plantilla solo-stock (export / import)
Dos nuevas acciones en herramientas:
- **🧾 Exportar plantilla solo-stock** — XLSX con `Codigo`, `Descripcion`, `StockPrincipal` (visible/editable), nada más.
- **♻ Importar actualización solo-stock** — re-lee ese mismo XLSX y solo actualiza cantidades del stock principal (sin tocar ubicaciones, lotes, ni ningún otro campo del catálogo).

### Visibilidad de equivalencias
Los símbolos de equivalencia (`≈`) en la tabla de inventario tienen ahora un *badge* con mejor contraste en ambos temas.

### Alineación con futuro `gneex-hosted-api`
La SPA sigue siendo 100 % offline. El cliente `GneexApiClient` (`js/api-client.js`) reserva la base URL en `localStorage` (`gneex-api-base-url`) y queda listo para que el siguiente paso conecte `POST /api/v1/auth/login`, `GET/PATCH /api/v1/sync` y `POST /api/v1/backup/import` cuando el backend esté listo. Ver **`no-deployar/docs/BACKEND_ALINEACION.md`** y **`gneex-hosted-api/README.md`**.

### Mantenimiento del respaldo madre
`scripts/repair-backup-users.mjs GNEEX_Backup_Madre.json` reescribe `data["phoenix-users"]` con las plantillas integradas y fusiona movimientos desde `phoenix-movements`, `_rawMovements` y `movements`, deduplicando por `id`. Disparador conversacional: «**Madre mía**» (regla en `.cursor/rules/madre-backup.mdc`).

---

## Documentación

| Recurso | Carpeta | Notas |
|---|---|---|
| Manual de usuario (ES/EN/FR) | `user-manual/` y fuente en `no-deployar/User Manual/` | HTML para producción, PDF generado vía `no-deployar/docs/export-user-docs-pdf.ps1` |
| Presentaciones (ES/EN/FR) | `user-manual/` y `no-deployar/Presentation/` | MD fuente + HTML/PDF derivados |
| Plan «G-NEEX en línea» | `no-deployar/docs/PLAN_APP_EN_LINEA_CAMINO_A.md` | Camino A (estático + JSON) |
| Alineación cliente ↔ API | `no-deployar/docs/BACKEND_ALINEACION.md` | Endpoints, hash, plantillas |
| Despliegue Oracle + Docker | `gneex-hosted-api/docs/DESPLEGUE_ORACLE_DOCKER_ES.md` | Paso a paso |
| Checklist pre-entrega | `no-deployar/docs/REVISION_PRE_ENTREGA.md` | Modales, permisos finos, exportaciones |
| Plantillas de permisos | `PlantillasPermisos.xlsx.csv` | Resumen por clave; se mantiene alineado con `Auth._getBuiltinUser()` |

### Regenerar screenshots de manuales / presentaciones

Los `.png` de `app-screenshots/` y `user-manual/app-screenshots/` se capturan con **Playwright** desde el equipo local. Procedimiento esperado:

```powershell
# 1) Servir la app en una URL fija (mismo origen que usen los usuarios)
py -m http.server 8765
# 2) Ejecutar el runner de capturas (script local; pendiente de versionar)
#    Salida esperada: capture-{es|en|fr}-{login|panel|inventario|movimientos|...}.png
```

Si no tienes el runner de capturas versionado, las capturas vivas siguen siendo las datadas en mayo de 2026 (anteriores al logo clicable y a la pantalla de bienvenida). Para una próxima entrega oficial, recomiendo:
1. Levantar `python -m http.server 8765`.
2. Lanzar el flujo de Playwright con los tres locales y rutas principales.
3. Reemplazar las imágenes en `app-screenshots/` y sincronizar `user-manual/app-screenshots/` con `no-deployar/docs/sync-user-manual.ps1`.

### Regenerar PDFs de manuales y presentaciones

```powershell
.\no-deployar\docs\export-user-docs-pdf.ps1
```

Requiere **Microsoft Edge** (Chromium) instalado; el script usa impresión headless a PDF (véase `no-deployar/docs/export-user-docs-pdf.ps1`).
