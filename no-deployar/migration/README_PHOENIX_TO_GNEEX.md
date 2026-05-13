# Migración del historial Phoenix (Excel + macros) → G-NEEX

El **ADN** operativo de Phoenix está en la hoja con macros; G-NEEX guarda todo en **localStorage** y el intercambio oficial es un **JSON de respaldo** compatible con **Configuración → Import/Export → Importar respaldo**.

Este documento define cómo construir ese archivo sin perder el histórico que exportes desde Excel.

---

## Leyenda de colores Phoenix → tipo G-NEEX

**Regla:** al ver un **color** en el historial Phoenix, ese color **es** el indicador del **tipo de movimiento** (no es solo formato). La tabla siguiente fija la equivalencia con G-NEEX. En el export desde `.xlsx`, `history_xlsx_export_separate.py` lee el relleno de cada celda con `____` (**RGB, indexado o color de tema + tinte** de Excel) y usa `cellFillRgbToType`. Si falla el mapeo (p. ej. checklist amarillo guardado como “tema” y no como `FFFF00`), antes caía en la subcabecera y una columna `RECEPTION` a la izquierda hacía parecer **compra** (`COMPRA_STOCK`); con la resolución de tema eso se corrige. Si aun así faltara un tono, añade su hex al mapa. Las subcabeceras que son **solo número de proyecto** se ignoran al buscar tipo hacia la izquierda.

En la hoja Phoenix, el **color de fondo** (y el texto de la leyenda) identificaban el **tipo de operación**. Equivalencia usada en `phoenix-type-map.json`:

| Color / etiqueta Phoenix | Abrev. típica | Tipo G-NEEX |
|----------------------------|---------------|-------------|
| Rosa — ADJUST | ADJ | `AJUSTE` |
| Cian — QUINCAILLERIE | QUIC | `FERRETERIA` |
| Amarillo — CHECKLIST | CHC | `LISTA_CHEQUEO` |
| Verde brillante — MATERIELS E. PRODUCTION | MEC | `MAT_ELEC_PROD` |
| Verde oliva — MATERIELS E. CHANTIER | ME2C | `MAT_ELEC_OBRA` |
| Granate / burdeos — TRANSFER | TRAN | `TRANSFERENCIA` |
| Naranja — SEND TO PRODUCTION | PROD | `ENVIAR_PRODUCCION` |
| Salmón / rojo claro — DAILY CONSUME | DAILY | `CONSUMO_DIARIO` |
| Negro — SPECIAL | (vacío en leyenda) | `ESPECIAL` |
| Rojo — SCRAP | SCC | `MERMA` |
| Gris claro — RETOUR | RTC | `RETORNO` |
| Azul oscuro — DISASSAMBLAGE | DIC | `DESMANTELAR` |
| Verde pálido — COLOR AND SHAPE | COL | `TRANSFORMACION` * |
| Pizarra / ERROR | ERROR | `AJUSTE` ** |

\* *COLOR AND SHAPE* se interpreta como **transformación** de artículo (forma/color); si en tu proceso era otro movimiento, cambia solo esa línea en `phoenix-type-map.json`.

\** *ERROR* se trata de forma **conservadora** como ajuste para no perder la fila; conviene revisar tras importar.

Los macros o exportaciones pueden devolver el **nombre completo**, la **abreviatura** o un color codificado; el mapa incluye varias variantes (`ADJ`, `ADJUST`, `DAILY`, `DAILY_CONSUME`, etc.).

### Rejilla `HISTORY` (hoja tipo Libro1.xlsx): lectura por columnas

Regla operativa acordada para **identificar movimientos** al armar el respaldo para G-NEEX:

1. **Fila de fecha (p. ej. fila 8 en Excel)**  
   Cada **fecha** inicia un **bloque de una o más columnas** ese día. El bloque no tiene siempre el mismo ancho: hay tantas columnas como movimientos/distinciones hubo en esa fecha.

2. **Fila inmediatamente debajo (subcabecera / “proyecto”)**  
   En cada columna del bloque, esta fila indica el **contexto del movimiento**:  
   - puede ser una **etiqueta de tipo** (`RECEPTION`, `ADJUST`, `ASSEMBLAGE`, `DAILY CONSUME`, `INITIAL QUANTITY`, …);  
   - o un **identificador de proyecto** (p. ej. número);  
   - o **texto libre / nombre** → se considera **movimiento especial** (en G-NEEX: tipo `ESPECIAL`, con `projectId`/`notes` fieles al texto; p. ej. referencias tipo **Daveen Bélanger**).

3. **Filas de artículo (debajo)**  
   Para cada código, la celda en esa columna aporta el **delta** y, en el texto pegado típico, el **balance después del movimiento** y la parte `PROJECT: …`.  
   Formato habitual:  
   `variacion ____ balance   YYYY-MM-DD   PROJECT:   referencia`  
   El script toma la **cantidad** preferentemente del número **pegado al marcador** `____` (p. ej. `12 ____` o `-5 ____`), no del primer entero al inicio de la celda: así no confunde `-5/16` (rosca) ni notas con guiones con un signo de movimiento. Las cantidades admiten **coma o punto decimal** (`50,83`, `12.5`). Si la celda llegó como texto **solo dígitos** porque desapareció la coma decimal (p. ej. `50833333333333` en lugar de `50,833333…`), `phoenix_sheet_utils.py` aplica una **reparación heurística** para evitar deltas astronómicos en la migración.

**Equivalencias texto de cabecera → tipo G-NEEX** (además de la tabla por color más arriba):

| Texto / concepto en Phoenix | Tipo G-NEEX | Nota |
|------------------------------|-------------|------|
| `RECEPTION` | `COMPRA_STOCK` | Compra de stock. |
| `RECEPTION CHANTIER` | `RETORNO` | Retorno desde chantier / obra (no es compra). |
| `ADJUST` / color ADJUST | `AJUSTE` | Ajuste de inventario. |
| `ASSEMBLAGE` (y `ASSAMBLAGE` si aparece mal escrito) | `ENVIAR_PRODUCCION` | Envío a producción. |
| `DISASSAMBLAGE` / `DISASSEMBLAGE` / DIC | `DESMANTELAR` | Desmantelar. |
| `DAILY CONSUME` | `CONSUMO_DIARIO` | Consumo diario. |
| `INITIAL QUANTITY` | *(no es un tipo de movimiento)* | Columna de **balance / arranque** dentro del día; no generar un movimiento “INITIAL” salvo que haya lógica explícita. |
| Proyecto con **nombre o texto largo atípico** | `ESPECIAL` | Ej. entradas tipo **Daveen Bélanger**; conservar texto en `notes` y `projectId` según convenga. |
| Columna final con **solo el año `2025`** en una fila, y fecha `2025-12-19` arriba | *(contexto de cierre)* | El consumo detallado de 2025 quedó en **otro archivo**; en esta rejilla solo queda el **stock con que cerró 2025** para encadenar con 2026. El generador debe tratar ese bloque como **arranque de saldo**, no como un “movimiento” con signo, salvo que en la celda del artículo haya texto de variación explícita. |

**Criterio cerrado:** `RECEPTION CHANTIER` se mapea a **`RETORNO`** (retorno de material desde obra), no a compra de stock.

---

## 1. Formato del respaldo G-NEEX (oficial)

El archivo que importa la app tiene esta forma:

```json
{
  "exportedAt": "2026-04-18T12:00:00.000Z",
  "app": "G-NEEX",
  "meta": {
    "format": "G-NEEX-backup",
    "inventoryExpiration": {
      "description": "phoenix-inventory items include expDate, daysToExpire, expirationDate, shelfLifeMonths, expirations[]"
    }
  },
  "data": {
    "phoenix-inventory": "[...]",
    "phoenix-movements": "[...]",
    "...": "cada clave es un string tal como iría en localStorage"
  }
}
```

**`meta` (opcional):** la app **Importar respaldo** solo usa `data`; ignora `meta`. Los respaldos generados por la app y por `build-gneex-backup.mjs` incluyen `meta.inventoryExpiration` para documentar que cada ítem de inventario puede llevar fecha de caducidad y lotes (`expDate`, `expirationDate`, `daysToExpire`, `shelfLifeMonths`, `expirations`).

**Importante:** en `data`, cada valor debe ser **string** (como devuelve `localStorage.getItem`). Los arrays se serializan con `JSON.stringify` una vez.

La importación recorre **todas** las claves definidas en `STORAGE_KEYS` en `js/utils.js` (incluye `phoenix-employees`, `phoenix-occasional-recipients`, `phoenix-suppliers`, `phoenix-me-legacy`, etc.). Si una clave **no** viene en `data`, la app **borra** esa entrada del almacenamiento. Por eso un respaldo de migración debe incluir **todas** las claves con un valor seguro (por ejemplo `[]`, `{}`, `""`) o usar el script de esta carpeta, que rellena valores por defecto.

---

## 2. Esquema resumido que necesita G-NEEX

### Inventario (`phoenix-inventory`)

Array de artículos. Campos habituales (no todos obligatorios):

| Campo | Uso |
|-------|-----|
| `id` | Identificador numérico en string (`"1"`, `"2"`…). El script puede generarlos. |
| `code` | Código de artículo (clave para enlazar líneas de movimiento si en Phoenix solo tienes código). |
| `description`, `category`, `location` | Texto |
| `mainStock`, `prodStock`, `transStock` | Números (stock final **después** de aplicar todo el histórico, o 0 y luego solo movimientos — lo coherente es: inventario = estado final y movimientos = historial que lo explica). |
| `expDate`, `expirationDate`, `daysToExpire`, `shelfLifeMonths` | Caducidad / vida útil (texto o número según uso en la app). |
| `expirations` | Lista de lotes con fechas (si aplica). |
| `defaultPrice` | Precio por defecto del artículo (numérico; columna CSV/XLSX `PrecioDefecto`). |
| `minStock`, `maxStock`, `supplier`, notas… | Opcional; ver `InventoryManager.addItem` en `js/inventory.js` |

**Coherencia:** Lo más simple para una primera migración es: **inventario = snapshot final** en Excel y **movimientos = lista histórica** que ya reflejó esas cantidades; G-NEEX mostrará el historial y el stock actual debe coincidir con Phoenix.

### Movimientos (`phoenix-movements`)

Array de objetos. Campos típicos al crear un movimiento en la app (ver `js/movements.js`, `movement = { ... }`):

| Campo | Uso |
|-------|-----|
| `id` | String numérico único |
| `reference` | Referencia visible: formato actual **3 letras de tipo + 6 dígitos correlativos por tipo** (p. ej. `AJU000042`, `COM000003`). Siglas en `MOVEMENT_REF_PREFIX` (`js/utils.js`). Referencias antiguas con más dígitos, solo numéricas o con guion se **normalizan automáticamente** al generar JSON (`build-gneex-backup.mjs`), al **importar respaldo** en la app y en la primera carga de movimientos; también se actualizan las referencias enlazadas en transporte/colas y M.E. obra legado. Después `syncMovementRefCounterFromMovements` ajusta los contadores por tipo. |
| `type` | Uno de los códigos `MOVEMENT_TYPES` en `js/utils.js`: `AJUSTE`, `CONSUMO_DIARIO`, `FERRETERIA`, `COMPRA_STOCK`, `STANDBY`, etc. |
| `projectId`, `notes` | Texto |
| `date` | ISO 8601 (`new Date().toISOString()`) |
| `items` | Array de líneas: `itemId`, `code`, `description`, `quantity`, `target` (`main` \| `production` \| `transformation`), `annulled`, etc. |
| *(línea, opcional)* | La app y el backend hospedado **persisten** propiedades extra en cada línea si ya vienen en el JSON (p. ej. `metaBoxMgrAjuste` para ajustes desde **Inventario → gestor de cajas**). Los respaldos antiguos sin esos campos siguen siendo válidos; al fusionar o reparar respaldos (`scripts/repair-backup-users.mjs`, etc.) no se eliminan claves desconocidas en movimientos ya deduplicados por `id`. |
| `createdBy` | Nombre visible (texto) |
| `annulled`, `hadOverdraft` | Boolean |
| `overdraftReason` | Si aplica |
| `purchaseMeta` | Para `COMPRA_STOCK`: `poNumber`, `packingSlip`, `supplier` |
| `standbyReleaseType`, `pending` | Para `STANDBY` |

Las líneas deben usar **`itemId`** que exista en el inventario migrado. El script intermedio permite direccionar por **`code`** y el generador resuelve `itemId`.

---

## 3. Formato intermedio (Phoenix → script)

Archivo JSON de trabajo: `intermediate.example.json` (plantilla) o tu export procesado desde Excel.

Estructura prevista:

```json
{
  "meta": {
    "source": "Phoenix Excel",
    "description": "Opcional"
  },
  "inventory": [
    {
      "code": "ABC-001",
      "description": "…",
      "category": "",
      "mainStock": 10,
      "prodStock": 0,
      "transStock": 0,
      "location": ""
    }
  ],
  "movements": [
    {
      "reference": "00000001",
      "date": "2024-06-15T10:30:00.000Z",
      "type": "CONSUMO_DIARIO",
      "projectId": "CONSUMO DIARIO",
      "notes": "",
      "createdBy": "Migración Phoenix",
      "lines": [
        { "code": "ABC-001", "quantity": -2, "target": "main" }
      ]
    }
  ]
}
```

- **`type`:** debe ser ya un código G-NEEX o una etiqueta que mapeemos en `phoenix-type-map.json` cuando nos pases la tabla de equivalencias desde Excel.
- **`lines.quantity`:** convención como en la app (negativo consume en tipos `negative`, etc.).

### 3.1 Pegado desde Excel → TSV → `intermediate.json`

Si copias desde Phoenix la **rejilla** (una fila de encabezado con **fechas** por columna y filas `CODE` / descripción / categoría / **INITIAL QUANTITY** / celdas de movimiento):

1. Pega en un editor y guarda como **`migration/phoenix-grid.txt`** usando **separador tabulador** (en Excel: copiar la selección suele conservar tab entre columnas).
2. Comprueba que la primera fila del archivo sea la de fechas y que las columnas fijas sean, por defecto: índice 0 `CODE`, 1 descripción, 2 categoría, 3 `INITIAL`, y desde la 4 las columnas diarias. Si tu hoja tiene otra disposición, usa las flags `--code-col`, `--desc-col`, `--cat-col`, `--initial-col`, `--first-date-col` (base 0).
3. Ejecuta:

```bash
cd migration
node parse-phoenix-tsv.mjs --input phoenix-grid.txt --output intermediate.json --default-type CONSUMO_DIARIO
```

**Tipos por color:** en texto plano **no viaja el color** de la celda. `parse-phoenix-tsv.mjs` asigna a todos los movimientos el mismo `--default-type` hasta que tengamos un export con etiqueta de tipo o un paso intermedio que lea colores (p. ej. export VBA / Office Open XML). Revisa y corrige `type` en `intermediate.json` o amplía el parser cuando tengamos una columna explícita.

**Stock en inventario (xlsx):** `StockPrincipal` = celda de cada fila bajo la columna **INITIAL QUANTITY más a la izquierda** (la **más reciente** en Phoenix: al mirar la rejilla **de derecha a izquierda** en el tiempo, lo actual queda a la izquierda). Se detecta como la **primera** subcabecera `INITIAL QUANTITY` al recorrer columnas de **izquierda a derecha** (índice mínimo). No se recorren movimientos para el stock. Si esa celda está vacía, se usa `--initial-col` como respaldo. Forzar columna explícita: `--last-initial-col N`.

---

## 4. Generar el respaldo importable

Requisito: **Node.js** instalado.

```bash
cd migration
node build-gneex-backup.mjs --input intermediate.json --output ../Backup/GNEEX_Backup_MIGRATED.json
```

Opciones útiles:

- `--base ruta/al/GNEEX_Backup_actual.json` — Toma de ese respaldo **usuarios**, tema, idioma, transportes vacíos, etc., y **sustituye** inventario + movimientos por los del intermedio (recomendado si ya tienes operadores en G-NEEX).

Luego en la app: **Configuración → Importar respaldo** y elegir el JSON generado.

**Seguridad:** haz siempre un **respaldo de la app actual** antes de importar.

---

## 5. Lo que necesitamos de ti (Phoenix)

Para cerrar el mapeo automático, envía (texto o capturas):

1. Nombres de **hojas** y **tablas** donde vive el historial (movimientos) y el maestro de artículos.
2. **Columnas** de una fila de movimiento en Phoenix (encabezados exactos).
3. Lista de **tipos de movimiento** en Excel y su significado (entrada/salida, obra, etc.).
4. Cómo se identifica el **artículo** (código interno, descripción, ambos).
5. Formato de **fecha** y de **número de referencia** si existe.
6. Si hay **macros** que exportan CSV o JSON, describe el resultado.

Con eso rellenamos `phoenix-type-map.json` y, si hace falta, ampliamos `build-gneex-backup.mjs` para leer CSV directamente desde un export de Excel.

---

## 6. Archivos en esta carpeta

| Archivo | Rol |
|---------|-----|
| `README_PHOENIX_TO_GNEEX.md` | Esta guía |
| `intermediate.example.json` | Ejemplo mínimo del JSON intermedio |
| `phoenix-type-map.json` | Mapeo etiquetas Phoenix → `type` G-NEEX (se completará contigo) |
| `parse-phoenix-tsv.mjs` | Rejilla Phoenix pegada como TSV → `intermediate.json` |
| `phoenix-grid.sample.tsv` | Ejemplo mínimo de rejilla (tabs) para probar el parser |
| `build-gneex-backup.mjs` | Genera el JSON de respaldo listo para **Importar respaldo** |
| `phoenix_sheet_utils.py` | Funciones compartidas: merges, columna **INITIAL QUANTITY** de inventario (**más a la izquierda** = más reciente), `parse_movement_cell`, auditoría **por filas de artículo** vs inventario. |
| `audit_phoenix_reconcile.py` | Solo escribe CSV/TXT de descuadre: **filas de artículo** donde el cálculo no coincide con inventario; el TXT lista **columnas de movimiento** frecuentes en esas filas. |
| `gneex_inventory_csv_merge.py` | **`--gneex-backup-json`**: cantidades y datos del **respaldo final**. **`--gneex-inventory-csv`** después: **complementa** ubicación, lotes, min/max, etc. (**no** cambia stocks). |
| `history_xlsx_to_inventory_csv.py` | Solo **CSV de inventario**. **`--loc-col`** (default **6**). Opcional **`--gneex-backup-json`** (stocks) y **`--gneex-inventory-csv`** (metadatos). |
| `history_xlsx_export_separate.py` | `GNEEX_Inventario_PHOENIX.csv` + `GNEEX_Respaldo_PHOENIX.json`. **`--gneex-backup-json`** + **`--gneex-inventory-csv`** recomendado: stocks del respaldo, resto útil del CSV. **`build-gneex-backup.mjs`** completa claves `localStorage` como la app. |

### Salida separada (inventario CSV + respaldo JSON)

```bash
py -3 migration/history_xlsx_export_separate.py --input ruta\Libro1.xlsx
# Respaldo = cantidades fiables; CSV = ubicación, lotes y demás (sin tocar stocks):
py -3 migration/history_xlsx_export_separate.py -i ruta\Libro1.xlsx --gneex-backup-json "Backup\GNEEX_Backup_2026-04-17_07-41-14.json" --gneex-inventory-csv "Backup\Inform\GNEEX_Inventory_2026-04-17_07-42-16.csv"
# Opcional: listar hex de relleno reales en celdas ____ (para completar cellFillRgbToType)
py -3 migration/history_xlsx_export_separate.py -i ruta\Libro1.xlsx --dump-fill-stats
# Concordancia inventario vs suma de movimientos (según layout: INITIAL de inventario = más a la izquierda / más reciente)
py -3 migration/history_xlsx_export_separate.py -i ruta\Libro1.xlsx --audit-reconcile
# Solo auditoría (sin generar respaldo):
py -3 migration/audit_phoenix_reconcile.py -i ruta\Libro1.xlsx
```

**Windows (doble clic):** arrastra tu `.xlsx` encima de `migration/run-audit-reconcile.bat` (la ventana se queda abierta y escribe los informes en `migration/generated/`).

Genera:

- `phoenix_reconcile_mismatches.csv` — filas descuadradas con columnas `detalle_modos_parseo` (p. ej. `12=-5[qty_before____]`) y `alertas_lectura` si hubo lectura ambigua.
- `phoenix_reconcile_mal_leidas.csv` — **sólo operaciones identificadas como mal leídas o ambiguas**: `line_start_legacy` (primer entero al inicio de celda) o `_____sin_lectura`, con `motivo`.
- `phoenix_reconcile_ops_descuadre.csv` — **todas** las celdas con `____` leídas en filas descuadradas, con `modo_parseo` en cada una (para ver si el fallo viene de `qty_before____` vs `balance_after____` vs legacy).
- `phoenix_reconcile_diagnostico_filas.txt` — **búsqueda de errores en filas problemáticas**: texto por fila con operaciones, trozos de celda, advertencias y pistas (legacy, sin parse, etc.).
- `phoenix_reconcile_by_column.txt` — frecuencia por columna de movimiento en filas descuadradas.

La simulación, **por cada fila de artículo**, usa: `--initial-col`, snapshots **INITIAL QUANTITY** intermedios, y suma de deltas; compara con la **INITIAL QUANTITY de inventario** (columna **más a la izquierda** / más reciente; esa columna **no** se suma como delta: es el **objetivo** de la reconciliación).

- **Celdas combinadas:** inventario, auditoría y export leen el valor (y el relleno del movimiento) desde la **esquina superior izquierda** del merge, como Excel. Si la «suma simulada» es absurda (p. ej. miles negativos) pero el inventario en hoja es razonable, revisa celdas con texto técnico mal interpretado como cantidad (`line_start_legacy`) y el diagnóstico TXT.

- **Solo inventario:** importa el CSV en Configuración (sin historial de movimientos).
- **Solo respaldo:** importa el JSON (incluye inventario embebido coherente con los mismos stocks + todos los movimientos parseados).
- **Los dos archivos:** entregables distintos; el JSON ya trae inventario alineado con `itemId`; el CSV sirve si quieres documentar o reimportar inventario con los mismos `Id` del export.

**Requisitos:** Python + `openpyxl` + **Node.js** (salvo `--no-node`, que deja `intermediate_from_HISTORY.json` para generar el JSON a mano).

**Importante — qué archivo importar en G-NEEX**

| Archivo | ¿Importar en la app? |
|---------|----------------------|
| **`GNEEX_Respaldo_PHOENIX.json`** | **Sí.** Es el respaldo con `exportedAt`, `app`, **`data`** y opcionalmente **`meta`** (documentación de caducidad en inventario; la importación solo lee `data`). |
| **`intermediate_from_HISTORY.json`** | **No.** Es solo trabajo interno (inventario/movimientos “crudos”). **No tiene** la propiedad `data` en el formato del respaldo; la app mostrará error de formato inválido. |
| **`GNEEX_Inventario_PHOENIX.csv`** | Solo vía **Importar CSV** (inventario), no como JSON de respaldo. |

**Inventario solo desde Excel:** con `openpyxl` instalado:

`py -3 migration/history_xlsx_to_inventory_csv.py --input ruta\Libro1.xlsx`

Luego en G-NEEX: **Configuración → Importar CSV** (inventario inicial). El **StockPrincipal** es el valor bajo la columna **INITIAL QUANTITY** de inventario (**más a la izquierda** / más reciente); si la celda está vacía, el valor de `--initial-col`. Códigos duplicados: **prevalece la última fila**.

---

*Phoenix Cell G-NEEX — documentación de migración (abril 2026).*
