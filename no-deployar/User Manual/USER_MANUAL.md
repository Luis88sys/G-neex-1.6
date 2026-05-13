# User Manual — Phoenix Cell G-NEEX 1.7

*Phoenix Cell G-NEEX is developed by **Luis Goire**, as a hobby and with a strong interest in programming, on the path toward working as a professional developer.*
*Updated: May 2026 (v1.7)*

## What's new in 1.7 (May 2026) — read first

> If you're coming from 1.6, the points below are the only new pieces. The rest of the manual still applies.

- **Cinematic welcome splash (~6 s):** after login a "boot up" sequence runs; total length is driven by **`--welcome-duration`** in CSS (default **6 s**) and also acts as a **real loading buffer** for the app. A **Matrix-green scanner** (`#00ff41`) sweeps slowly down the screen, **orbital rings** close around the logo, **"WELCOME TO"** is revealed via clip-path wipe, **"G-neex"** flashes with a **strong neon flicker** before staying lit, and finally **"PHOENIX EVOLUTION"** and **your name** appear. A linear progress bar spans almost all of that useful time. It does not repeat on tab reload; it shows again on the next login.
- **Header logo as the "Update inventory" shortcut:** clicking the logo (header, top left) spins it counter-clockwise and triggers the unified **Update inventory** action, in this order:
  1. **Normalize locations and boxes** (free-text from older backups → canonical catalog; syncs `boxStocks` and `locationStocks`).
  2. **Reconcile main stock:** adjusts `mainStock = max(current, sum(boxes) + sum(locations))`. **Never reduces** main stock; it only raises it if your boxes/locations add up to more.
  3. **Refresh lot expiry:** lots whose expiry was **computed** are recomputed on the fly from the item's current shelf life. **Hand-typed expiries are preserved.**
  A confirmation modal previews the per-section detail (up to 5 rows each) before applying. If nothing is pending, an info toast appears and nothing is changed. Same action is available from the tools menu (↺) and via Enter / Space on the focused logo.
- **Boxes integrated into main stock:** consuming, moving or editing a box updates main stock automatically. If you have older backups out of sync, **Update inventory** repairs them without touching anything else.
- **Lots editor on the item:** in ⚙️ → edit item there is a new section **Lots (expiry per purchase)** where you add, one per row, **expedition date + optional explicit expiry + quantity**. Effective expiry is computed on the fly from the item's **shelf-life in months** unless you type an explicit one. Stock purchases auto-feed one lot per row; you can edit or remove them later.
- **Expiration: expired or soon-to-expire — new "Affected quantity" column:** sum of units in expired + soon-to-expire lots, with a breakdown tooltip. Helps prioritize what to move first.
- **Lot tooltip in the table:** when at least one explicit lot exists, a synthetic "Unassigned (rest of main stock)" row appears so the sum reconciles to main stock. With no lots, the tooltip stays empty (no noise).
- **Stock-only template (export/import):** two new options in the tools menu:
  - 🧾 **Export stock-only template** → XLSX with `Code`, `Description`, `MainStock` (editable). Nothing else.
  - ♻ **Import stock-only update** → reads that same XLSX back and only updates main-stock quantities. Locations, lots and catalog are not touched.
- **Equivalence (`≈`) clarity:** the inventory column now shows a higher-contrast badge in both light and dark themes.
- **Alignment with the future `gneex-hosted-api`:** the app stays 100 % offline; the `GneexApiClient` is prepared to connect to the backend once it ships (JWT login + sync + backup import). See `no-deployar/docs/BACKEND_ALINEACION.md`.

## Background and purpose

### Shop-floor need

Phoenix Cell G-NEEX comes from a real industrial need: **tighter inventory control** when the only technology available was a **PC**, without budget or infrastructure for anything else.

### From spreadsheet to manager

It began as an **Excel workbook** that gained **macros and automation** as daily shop-floor issues and operational errors appeared, one by one. It grew from a control sheet into an **inventory manager** built inside that workbook.

### Learning while automating

That work also became **hands-on training**: solving real problems with automation built **scripting and programming** skills. Operations and learning moved forward together.

### The “Phoenix” name and project DNA

After **severe file damage**—and **recovery** after heavy work—the project was named **Phoenix**: rising from the ashes. That recovered workbook is the **direct predecessor** and, in many ways, the **DNA** of the **G-NEEX** web application.

### Today and next steps

The **Phoenix spreadsheet** still supports operations wherever it adds value until **G-NEEX** is fully mature for everyday **web** use. This release is a deliberate step toward a tool intended to **keep evolving**.

> The same narrative appears in the app under **⚙️ Settings → Background** tab.

---

# SECTION 1: Settings (overview)

Under **⚙️ Settings** you will find data tools, lists, the article editor, receptions, preferences, and more. **This manual documents how the app works and what each screen does**; how your company deploys or governs the installation is not covered here.

## 1.1 Data, import, and export

### Who can use Import/Export

The **Import/Export** tab is available only to the **administrator account**. Other permission profiles—or **temporary elevation**—do not show this tab; opening Settings lands on **Background** instead. That tab groups full JSON backup (export/import), movements-only merge, shipped transports merge, initial inventory CSV/XLSX, archive/re-import movements, delete database, and the Daily consumption recipients quick view. Non-admin users rely on **Employees** and other tabs allowed for their profile.

### Full backup

**Path:** ⚙️ Settings → **Import/Export** tab (administrator only)

- **Export backup:** Creates a `GNEEX_Backup_YYYY-MM-DD_HH-MM-SS.json` file with all application data (inventory —per-item location text, per-location and per-box stock, warehouse location catalog included—; movements; daily consumption recipient lists —staff and occasional/external—; supplier list; transports; supplier order lines; users; reference counters; etc.)
- **Import backup:** Choose the JSON file, confirm, and follow the on-screen notice; it replaces the working data for this copy. Keys **missing** from that JSON do **not** erase unrelated local data (for example, the units catalog).

> Typical use for a full backup: a safety net or moving an entire working copy. To share only day-to-day activity with another copy, also use the **export / import movements only** flow below.

### Same web app on another PC, tablet, or phone

Open the deployed site (e.g. **HTTPS**) in any browser at the **same URL**. Data lives in each device's **`localStorage`** — nothing syncs automatically between your PC and phone. To carry the same working copy, an administrator **exports** the JSON on one device and **imports** it on the other (email, cloud, cable, etc.). Sign-in and other flows that rely on browser crypto need **HTTPS** or **`localhost`**; if something fails when you only use `http://` and a LAN IP, use your public deploy URL or read the on-screen error.

**Movements only (merging work):** In the same place, **Export movements only** (`GNEEX_Movements_….json`) and **Import and merge movements** exchange activity between copies. The merge **adds** only movements whose **id** is not already in the target copy and **applies** quantities to inventory (material receptions are recreated when the file has enough data). If the **id** already exists, the local movement is kept. It does not replace user lists, transports, or other data; item catalogs should match, and interleaved dates between copies can make stock order look inconsistent. Always confirm the dialog the app shows.

**Note (backups and overdraft):** The **full backup** and **movements-only** files serialize movements as stored locally (including the technical `hadOverdraft` field). The file format and merge behavior are **unchanged**. On startup, the app may **normalize** inconsistent values for **Stock purchase** and **Material reception**. In **History**, **filters**, **XLSX reports**, and **human-readable exports**, the rule is consistent: a purchase or reception is **not** treated as overdraft solely because of an old incorrect flag.

### Recipient lists (Daily consumption)

**Quick view:** Only the administrator sees this block under ⚙️ Settings → **Import/Export** → “Recipients (quick view)”. **Adding and removing** staff and occasional names is on the **Employees** tab.

### Supplier list (orders)

**Path:** ⚙️ Settings → **Suppliers** tab to maintain the master name list.

Users with **Orders** access can enter a supplier on each line (free text or suggestions loaded from that list). The **PO/OC number** is not entered when creating the order; it is captured when **receiving** goods under Movements → **Stock purchase** (with packing slip).

### Archive old movements

To free up space by removing old movements:

1. Select a **cutoff date** in the "Before" field
2. Click **Archive**
3. Confirm the number of movements
4. The file `GNEEX_Archived_Movements_FROM_to_TO_YYYY-MM-DD_HH-MM-SS.json` is downloaded
5. The archived movements are removed from the application

The JSON contains a readable `movements` summary and `_rawMovements` with the **full** movement objects as stored. The overdraft field in the readable part follows the **same rule** as on-screen history; `_rawMovements` keeps the raw technical data without reinterpretation.

### Re-import archived movements

1. Click **Re-import file**
2. Select the archive JSON file
3. Confirm — the movements are reintegrated into the history sorted by date
4. Movements that already exist are not duplicated

### Load initial inventory (CSV or XLSX)

Allows importing a **CSV** or **XLSX** file with the initial inventory. The columns must match the expected format.
You can use the **template icon button** to export a styled **.xlsx** sheet with the correct column order (orange header row) and one editable example row. If you prefer CSV, save or export from Excel using the same column order.

### Delete database

1. Click **Delete database**
2. Enter the confirmation code: `DELETE ALL` (or `BORRAR TODO` / `SUPPRIMER TOUT`)
3. All data is deleted and the page reloads

> A fixed confirmation phrase helps prevent accidental data loss; follow your site’s runbook for production machines if applicable.

### Security and browser-stored data

G-NEEX stores inventory, movements, users, and session data in the browser's **local storage** (for example `localStorage`). Passwords are stored as **salted hashes**; they do not appear in plaintext in the application source. Anyone with access to the device or user profile, or a **malicious browser extension**, could read or tamper with that data. The app **does not replace** a central server with corporate identity policies. Use **OS session lock**, personal accounts, and **exported backups** as your organization requires. When **importing a JSON backup**, verify it comes from a trusted source.

---

## 1.2 Article editor

**Path:** ⚙️ Settings → **Article editing** tab

On entry, if the app asks for an **unlock code**, follow the on-screen prompt (create or confirm) and use **Unlock** to continue. Then search by code or description, change any field (code, description, category, default price, stocks, location, min, max, etc.), and **Save**.

For **Location**, you can compose text from **comma-separated labels**; the dropdown lists **effective warehouse slots** and **BOX1…BOX51** (grouped) to append with **Add**, alongside the editable location catalog on the same Settings tab.

### Inventory consumable mode and the master «Consumables» list

If you check **Treat as inventory consumable** and click **Save**, the app **adds** the name (the article **description**, or **code** if there is no description) to the list under **⚙️ Settings → Consumables**, used for purchase receipts without inventory and consumable orders. If you **uncheck** that option and save, it **removes** from that list the entry that matched the description or code **before the change** (when it was only there through this link).

How stock behaves in consumable mode follows the on-screen rules and messages.

---

## 1.3 Expiration settings

**Path:** ⚙️ Settings → **Expirations** tab

1. Set the global **alert days** (e.g., 30 = alert 30 days before expiration)
2. Search for a specific article
3. Assign a **shelf life in months** from the issue date
4. Click **Save**

---

# SECTION 2: Using the app

## 2.1 Accessing a session

Enter **username** and **password**. Session validation happens in the browser; the **administrator** account can manage users and passwords under **⚙️ Settings → Users**.

When **adding a user** with role **User**, you can pick a **template**: **Supervisor** and the built-in **reference profiles** (e.g. Keith Lake, Guest, Patrick). Legacy operator templates are no longer offered for new accounts. Each option has a short description on hover (`title`). For a new **administrator**, choose role **Administrator**; that role does not use a permission matrix template. The spreadsheet **`PlantillasPermisos.xlsx.csv`** at the repository root lists template keys and behaviour for documentation and future API alignment.

Login **background images** are listed in `assets/login-bg-manifest.json` (paths under `assets/`). If the list is missing or empty, the logo is used. When several images are defined, they may **rotate** automatically.

After signing in, you reach the panel (see **§2.2**).

---

## 2.2 Dashboard (Summary panel)

Upon entering the application, a panel is displayed with today's information. The **top bar** has module buttons (e.g. **📦 Inventory** for §2.3, **➕ Movements** for §2.4, and so on):

![Dashboard and main navigation bar](../docs/app-screenshots/capture-en-panel.png)

| Card | What it shows |
|------|---------------|
| **Movements today** | Number of movements created today, with breakdown by type |
| **Active alerts** | Low stock + negative stock + articles about to expire |
| **Pending transports** | Transports that have not been dispatched or voided |
| **Last backup** | When the last backup was made (alerts if more than 7 days ago or never) |

Click **Hide** / **Show** to collapse/expand the panel.

---

## 2.3 Inventory

What you see after clicking **Inventory** (📦) in the navigation bar: search, filters, stat cards, and the article table.

![Inventory tab](../docs/app-screenshots/capture-en-inventario.png)

### Search articles

Type in the search field to filter by **code, description, category, or location**.

### Tools menu (⋮)

Next to the search field, the **⋮** menu groups inventory actions: export XLSX, print, show or hide the inline filter strips (**Box / location**, **Depot**, **Consumable inv.**), problems-only and “low-stock alert ignored” filters, **Stock as-of date**, box summary, box stock management, and more.

The **first item** is **Hide inline filter bars** (right-pointing chevron): it closes all three filter strips in one step when any strip is open and resets each dropdown to **All** when needed. It is **disabled** when no inline strip is open; when a strip is open, use it to collapse the filter area without toggling each filter separately.

### Inventory "as-of date" view

Use the **as-of date** filter to view inventory exactly as it was on a selected date. This affects table values, cards, and print/export outputs while active.

### Statistics cards

The top cards display:
- **Total articles**: total count
- **Low stock**: articles with stock at or below the minimum
- **Expiration**: expired or soon-to-expire articles
- **Overstock**: articles above the maximum stock
- **Negative stock**: articles with stock below 0

> Clicking any card (except "totals") opens a **detail modal** with the list of affected articles, option to export XLSX, and print.

In the **low stock** modal, the first columns are **Ignore low-stock alert**, **Actions** (🛒 to add the item to the **purchase list**), **Code**, then the remaining fields (description, stocks, dates, location).

### Inventory table

Columns: Code, Description, Category, Default price, Main Stock, Production Stock, Transformation Stock, Location, Expiration.

In the **Description** column, the **📝** control (faded more when the item has no notes yet) opens a dialog to **view and edit** notes when it is active; **Save** persists changes. If editing is not offered but the item **has** notes, you can often open the same dialog in **read-only** mode; if there are no notes, the cell is plain text.

Row and cell colors indicate the article's status (red = negative, yellow = low, orange = expiring, green = OK, etc.). Additionally: a **soft violet/indigo highlight with outline on the whole row** means the row is **keyboard-selected** (Up/Down in the table). A **vertical violet bar** on the **first cell (code)** only marks **inventory consumable** items. In the **main stock** cell, a **violet badge** can mean **overstock** (above the configured maximum).

If the window is narrow, **scroll the table horizontally** to see all columns without squashing the headers.

**Location (article text field):** for validations (movements, imports, stock consistency) only **effective warehouse catalog** labels and **BOXn** references count as **canonical** location. If stored text cannot be fully normalized to those tokens, saving from the editor may show a **warning**; no automatic relocation placeholder is inserted anymore.

Use the **Box / location** dropdown for quick visual filtering by box number inferred from **Location** text and from **box numbers** that have stock in box management, and by **predefined warehouse locations** in the app catalog (e.g. E1R, ETOP, BIN 8, CONTAINEUR CHANTIER, ARMOIRE AVEC CLE) when the location text matches **or** the same location appears only in **per-location stock** (quantity chips); tags appear next to the cell. Next to export and print, **Box summary (from location text)** groups items when **Location** looks like **BOX1**, **BOX 1**, or variants (“box”, “caja” + number; optional space after BOX). Several boxes may appear in the same field, **comma-separated** (e.g. “BOX1, caja 2”). In that modal, **click a row** to see the article lines for that group. If an item has multiple boxes in location, it is counted under **each detected box**. Also, in **Box stock management**, you can **add, edit, delete, and redistribute** stock between **boxes** and **Production** / **Transformation** stock columns; you can also transfer from **box to direct location (no box)**. That action deducts from the origin box, appends the location to item text (without duplicates), and stores per-location quantity (chips such as `E2R: 12`) in the Location cell. You can still **export** all box stock (same layout as the template) for backup or editing and **re-import** it, download an empty template when needed, and import box quantities. The official first row is **Codigo, Caja, UbicacionCaja, CantidadCaja, CantidadCajas, Vacia** (**Datos** sheet, the one G-NEEX generates). In **Vacia**, use `1/true/yes` to mark a box as empty (forces quantity 0). For negative movements (consumption/output), box selection is optional: if selected, stock is discounted from both box and main inventory; if not selected, discount applies only to main inventory. When you **save** a quantity change in **Box stock management** for a **linked item**, the app also records an **Adjustment (AJUSTE)** movement in History (optional reason), in addition to updating box and main stock.

Recommended quick test (Location):
- `BOX1`
- `E1R` or `e1r` (case-insensitive)
- `BIN 8`, `BIN2`, or `BIN 2`
- `CONTAINEUR CHANTIER`
- `BOX1, BOX2`
- `caja 3, BOX4`
- `no box`
- `BOX52` (out of range, ignored)
- `BOX1, BOX1` (same box is not duplicated)

### Export and print

- **Export XLSX**: Downloads the current inventory view (formatted table)
- **Print list**: Opens the print window with the formatted table

Print windows across the app use **A4 portrait** (standard margins); tables **do not compress every column to the same width** (the article **code** stays on one line and readable); other long text **wraps inside cells** as needed (inventory, history, movement detail, and other printable lists).

> **Export** and **print** here need those buttons to be visible and active on your screen.

---

## 2.4 Movements

**Movements** (➕) in the top bar: the movement-type grid; choosing a type opens the overlay form (see below).

![Movements tab — type grid](../docs/app-screenshots/capture-en-movimientos.png)

### Create a movement

1. Go to the **Movements** tab
2. Select the **movement type** by clicking its button — an **in-app overlay window** opens with the form for that type (the Movements view keeps showing only the type grid and recent list).
3. In that window, fill in **Project ID** (required or automatic depending on the type) and **Notes**
4. **Search articles**: type at least 2 characters → select an article → enter **quantity** as for other types → the line is added (**Quantity** column)
5. **Stock source** (types that **subtract** stock): if the **Stock source** column appears, choose **which depot** the quantity comes from: **General warehouse** (main stock, quantity shown); each **box** (same quantity as in **Box stock management**); **locations** from per-location stock (label only in the list); and when available, **production stock** or **transformation stock** (quantity shown). You can **add several lines** for the same item to split quantities across sources. For types that also show a **Destination** column (e.g. Hardware, E.M. Production, E.M. Site), **source** is the physical depot deducted; **destination** classifies the movement and may differ from the source.
6. Review and adjust **quantities** in the list before processing
7. Click **Process movement**. For **Site E.M.**, you are asked for the **total boxes** for that shipment (not per item); boxes are allocated across lines by line quantity for Site E.M. stock

If **all** quantities are **0**, the app **blocks** processing (no stock change).

> Use **Create** and **Process movement** when they appear; if they stay inactive, the form or action is not enabled for the current state.

### Movement types

| Type | Effect on stock | Project |
|------|----------------|---------|
| Adjustment | Add or subtract | Optional |
| Daily Consumption | Subtract | Automatic |
| Hardware | Subtract | Required |
| Special | Add or subtract | Optional |
| Checklist | Subtract | Required |
| Waste | Subtract | Required |
| Return | Add | Optional |
| Dismantle | Add | Required |
| Transfer | Add or subtract | Optional |
| Transformation | Subtract | Optional |
| Send to Production | Subtract | Optional |
| E.M. Production | Subtract | Required |
| E.M. Site | Subtract | Required |
| Stand-By | No effect (pending) | Optional |
| Stock Purchase | Add | Special form |
| Material Reception | Add (or provisional, depending on category rules) | Required |

### Stand-By

Stand-By movements are saved as drafts without affecting inventory:

1. Create a **Stand-By** type movement
2. Select the **release type** (what type it will become when processed)
3. Process the movement

**Stand-By list**: Shows pending drafts with options:
- **Edit**: Modify articles and quantities
- **Process**: Apply the movement to the inventory
- **Cancel**: Delete the draft

### Floating shortcuts (Stand-by and Daily consumption)

With an active session, there are up to two floating shortcuts (bottom-right by default), **hidden until you use them**. To show the **Stand-by** or **Daily consumption** shortcut, open **Movements** and select that type; it stays visible until you hide it.

| Shortcut | Purpose |
|----------|---------|
| **Stand-by** (⏸) | Quick access to pending Stand-by drafts; panel with list, go to Movements, or hide the shortcut. |
| **Daily consumption** (📅) | Panel of lines for Daily consumption not yet processed as a single movement. |

- **Hide:** from each panel (⏬ icon); the choice is stored in this browser.
- **Drag:** press and hold the **round button** and move it anywhere on screen; position is saved on this device. A short tap without movement opens or closes the panel as usual.

**Daily consumption (close & catch-up):** pending lines are tied to the **local calendar day**. If lines were left from a previous day (app closed overnight, date change with the tab open, etc.), on return you may see a notice and an **automatic close/catch-up** may run when stock rules allow; if it cannot run due to overdraft, review the cart manually. **Daily consumption does not use a project number** in the form. **While Daily consumption is the selected movement type**, the nightly auto-close (~23:00) and midnight roll do **not** interrupt you; **when you switch to another movement type**, any pending automatic close runs if applicable.

**Movement date/time (Daily consumption):** each time you add a line to the cart, that moment is stored. When you **process**, the movement’s saved timestamp is the **first line** added in that batch (if an older line had no stamp, the process time is used as a fallback).

**Decimal quantities:** quantities and stocks are shown and stored with **at most four digits** after the decimal separator (rounding).

**Recipient with “Other (name not on list)”:** type the name freely when it is not in the dropdown. This section only requires identifying who receives the material; there is no extra classification.

**Editable recipient ledger in History:** under **History → Daily consumption by recipient** you can edit recipient names directly in the table, **save changes**, and **clear the visible table** (based on person/code filters) whenever you need to clean up that register.

### Overdraft

Movements that **withdraw** more stock than available (consumption, transfers, send to production, etc.) may open a modal for a **mandatory reason** and are marked in history with the overdraft indicator (`!` and a notice in the detail view).

**Stock purchase** and **Material reception** are **inbound** goods: they do **not** use that overdraft-justification flow. If older data incorrectly had an overdraft flag on those types, the app does **not** show them as overdraft in lists, filters, or detail, may **fix the stored value on load**, and reports follow the same rule.

When **releasing Stand-by**, the “would overdraft” check uses the Stand-by **target movement type** (not whichever type happened to be selected on the Movements form at that moment), avoiding false positives.

### Stock purchase (detail)

- Same movement type whether you create it **only under Movements** or **after a receipt from the Orders panel** (see §2.5).
- Extra fields on **each purchase line**: **PO / purchase order number** (required per article row), **supplier** per row where applicable; plus **packing slip** and general movement fields.
- Each movement gets a **type prefix + 6-digit sequence per movement type** (e.g. adjustment `AJU000042`, purchase `COM000003`). Older refs with more digits, purely numeric (`000042`) or hyphen form (`COM-001`) normalize when history loads.
- Some reception categories require **PO** and are stored as **provisional reception** (not applied to main stock until corresponding logistics flow).

---

## 2.5 Supplier orders (order lines)

**Path:** **Orders** tab (📋 in the top bar)

![Orders tab](../docs/app-screenshots/capture-en-pedidos.png)

Plan supplier purchase lines tied to inventory (code, description, supplier, quantity). The **PO/OC number** is captured when you **receive** goods in Stock purchase (packing slip), not when you create the draft line.

### List filters

Above the list you can switch **View** between the full **details table** (default) and **tile** cards; the choice is stored in this browser.

Above the table you can **filter** lines by:
- **Text search** (reference, code, description, supplier, quantities only),
- **Status**,
- **Key date** range (from / to),
- **Timeline preset** (with/without receipt, ordered, cancelled).

**Clear filters** resets all. If nothing matches, the message asks you to adjust the filters.

### Line states

| State | Meaning |
|-------|---------|
| **Inactive** | Draft: not yet confirmed as sent; you can edit quantity and supplier. |
| **Ordered** | Order confirmed; order date stored; awaiting goods. |
| **Partial / full receipt** | According to quantity received vs ordered. |
| **Cancelled** | Only if nothing was received yet. |

### Receipt and stock purchase

When you tap **Partial receipt** or **Full receipt (remaining)**, the app switches to **Movements**, selects **Stock purchase**, and fills the same form as a manual order. Review **article code and supplier per line** (and PO per line), then click **Process movement**. Stock is updated when that movement is saved. Linking requires the **same article code** and **same supplier** as the order line; otherwise the purchase still saves but **may not** link (a warning is shown).

**Stock purchase entered only under Movements (not from Orders first):** after **Process movement**, if there is an **Ordered** or **partial receipt** line with the **same article code** and **same supplier** as the purchase line, you may get a prompt asking whether this purchase belongs to that order. Buttons are **Yes** / **No** (**No** only skips linking). Matching does **not** depend on the order line PO matching the purchase PO: the PO entered **on each purchase row** is what is recorded and may update the order line. If you confirm, **Received qty**, **line status**, and **row actions** update like a receipt from the panel. If nothing links, you may be offered to **register** the purchase as a new order line (**Yes** / **No**).

### Timeline and export

- Each line shows a **reference** like `#AJU000012` (prefix per type; legacy rows may still be digits-only) and a **date timeline** (created, ordered, receipts).
- **Export XLSX / Print table:** both use the **current filtered view** (visible rows only).
- **Bulk cleanup:** button removes lines in **full receipt** state older than 1 year.
- **Per-line removal:** for **full receipt** lines, a row action is available when receipt age is over 3 months.
- **Actual receipt date (optional):** in Stock purchase and Material reception, you may set a past “real receipt date” for traceability (notes/timeline reference), while movement registration timestamp remains the actual save time.

### History (link)

If a stock purchase comes from the Orders panel, the movement detail shows a banner; list cards may show a 📋 marker.

> Managing lines, receipts, and the panel XLSX export depends on the actions and buttons you see when using **Orders** and **Movements** in your copy.

---

## 2.6 History

![History tab](../docs/app-screenshots/capture-en-historial.png)

### View movements

The **History** tab shows filtered movements with color and icon according to the type.

Use the **View** control to pick **Tiles** (icon grid, default), **List** (compact rows, file-explorer style), **Details** (columnar table), or **Chronological carousel** (horizontal card sequence from newest to oldest; the top strip and each card show **day, 3-letter month, 4-digit year, and local time**; side arrows step **one movement**). Minimized cards also show the **Project ID** when applicable. The choice is stored in this browser.

**Date format:** throughout the app, on-screen dates use **day**, **3-letter month**, and **4-digit year**; when time is shown, it is **local time in 24-hour format** (inventory, tables, reminders, transport, readable export metadata, etc.).

**Fully annulled** movements and **partial annulments** (some lines annulled without voiding the whole movement) appear in **Tiles**, **List**, and **Carousel** as a **diagonal stamp** (dashed tilted frame); the label **«Partial annulment»** identifies the latter. In **Details** view and in the modal, **status** uses the same wording.

### Filters

You can filter by:
- Movement type
- Reference (partial)
- Article code or description (partial)
- Movement notes text (partial; searches only the movement’s **notes** field — use this instead of the code filter for text inside notes)
- Recipient (daily consumption, partial)
- Date range
- Location
- Project ID (partial)
- Performed by (partial)
- Overdraft (yes/no; matches movement detail — stock purchase and reception ignore erroneous legacy markers)
- Negative stock (yes/no — based on **current** stock)
- Annulment (all / not fully annulled / partial annulment / fully annulled)

**Clear filters** empties all criteria.

### Movement detail

Click a tile, a list row, or a details-table row to open the same full detail:
- Type, reference, project, date and time, status
- Who performed it
- **Notes:** cumulative movement notes. With **movements** permission, existing notes are read-only; **Add note** appends a new block (timestamp and user header) without replacing earlier text.
- List of articles with **previous stock**, **change** (+/−), and **resulting stock** per line (rebuilt from inventory and history)
- Overdraft information if applicable (see § **Overdraft** above)
- **Attachments (📎):** link PDFs, photos, or documents already on your PC; **nothing is copied** into the app folder. The app stores the link and can **open** them via «Open file» (Chrome or Edge). After restoring a backup on another machine you must **link the files again**. Very old attachments may still point to copies under `Adjuntos/…`; use «Copy path (legacy)» and open from Explorer.
- **Print** opens a window with **tables** (movement header and lines aligned with **Export XLSX**), not a visual copy of the modal.

### Void movement

In the detail modal:
- **Void entire movement**: Reverts all affected stock
- **Void individual line**: Reverts only a specific line

> Voiding or rolling back in the detail view requires the modal to show those actions as active (depending on type and state).

---

## 2.7 Transport

Open the **Transport** (🚚) button. The tab shows the board and actions (create, ship, void, and so on) as enabled for your current screen.

![Transport tab](../docs/app-screenshots/capture-en-transporte.png)

### Transport panel

Shows cards for each transport with: project, dispatch date, line status (Ready/Partial), linked receptions.

**View** switches between **Tiles** (card grid) and **List** (single column of full-width cards); the choice is stored in this browser.

Click a card to expand its detail. In the expanded detail, **Attachments (📎)** links shipment documents from any folder (no copy into the app); viewing works in Chrome/Edge like movement attachments.

At the top of the tab, **Cargo prepared to depart** summarizes each **active** transport (not yet shipped, not voided): counts of linked checklists, site and production electrical movements, and project material **receipts** that are **not** yet marked as shipped. Material may appear **queued** when no active transport exists yet for that project.

### Dispatch and on-premise traceability

When you click **Ship truck**, the app records the shipment and marks the linked **checklist**, **site E.M.**, and **production E.M.** movements on that load, plus any **material receipts** for the same project that were still pending shipment (when several trucks serve one project, each shipment marks only what was still pending). **Movement detail** in History shows the timestamp once it left with a transport. **Void dispatch**, **reopen planning**, or **delete transport** clears those marks tied to that transport.

### Create manual transport

1. Click **+ New transport**
2. Enter the **Project ID**
3. Set the **dispatch date**
4. The transport is created (can link pending site electrical material)

> If an action is unavailable, the on-screen control is inactive or missing.

### Automatic transport

Movements of type **Checklist** and **E.M. Site** automatically create or link transports. If an active transport already exists for the project, lines are added to the existing one.

### Transport actions

- **Dispatch**: Only when the status is "Ready" (all lines resolved)
- **Void dispatch**: Reverts the dispatch status
- **Delete**: Deletes the entire transport
- **Merge lines**: Tool to combine or split lines within the transport
- **Truck cargo report**: In the truck detail you can use **Export cargo report** (XLSX) and **Print cargo report** with loaded materials, quantities, and dimensions. If a line has **several packages**, the XLSX and printout list each package on **consecutive rows** with fixed columns **Package**, **L**, **W**, **H** (the table does not grow sideways with “Package 1 L”, “Package 2 L”, …).

> Critical actions (e.g. **Ship**, **Delete**) only become available when line status allows it.

---

## 2.8 Reports and exports

### Generate a report

1. Click the **report** button (available in History and Transport)
2. Select the report type:
   - **Transport summary**
   - **Transport lines**
   - **Filtered movements** (uses active history filters)
   - **Filtered movement lines**
   - **All movements**
   - **Consumption by article** (search by code or description; suggestions from inventory appear as you type; choosing one fills the item **code**)
3. Click **Download XLSX**

Files are descriptively named with the date range (`.xlsx`; **Datos** sheet with themed styling and **Info** sheet with export metadata):
- `GNEEX_All_Movements_2024-03-15_to_2026-04-15.xlsx`
- `GNEEX_Item_Consumption_cable_2025-01-10_to_2026-03-20.xlsx`

> Use the report or XLSX download when the button is visible; pick report types in the dialog.

---

## 2.9 Receptions

**Path:** ⚙️ Settings → **Receptions** tab

Table with all registered receptions. They can be searched by text.

- **Export** / **Print** (filtered list): same layout when a reception has **multiple packages** — stacked rows with **Package**, **L**, **W**, **H**, without widening the sheet with many package columns.

- **Edit**: Modify data of an existing reception (reverts and reapplies stock)
- **Delete**: Delete reception and revert its effect on stock

> **Edit** and **Delete** need those row actions to be active (depends on this copy and the linked movement).

---

## 2.10 Theme, demo mode, and language

- **Theme**: Click 🌙/☀️ in the upper right corner to toggle between **dark** and **light** mode
- **Test / demo mode**: **Test** switch next to Help. Enables a **blue** theme and a **temporary working copy**: you can use the app normally (movements, inventory, settings, etc.). When you **turn the switch off**, the app **restores** inventory, movements, history, users, session, and all other data stored in the browser **to how it was when you turned demo mode on**; anything done only while demo mode was on is **discarded**. **Light/dark theme and language are not reverted** (whatever you chose during the demo stays). A **banner** appears under the header while the mode is on. **Confirmation** is required to exit
- **Language**: Select 🇪🇸 Español, 🇺🇸 English, or 🇫🇷 Français in the language selector

Theme and language preferences are saved automatically. The demo snapshot is separate from the JSON backup file. **Note:** files you export to a folder on your computer during the demo (for example XLSX in the project folder) are **not** removed when you leave demo mode; only **localStorage** in the browser is reverted.

---

## 2.11 Session bar

The top bar shows, among other things, the active session label, a role or mode summary (as your build presents it), and **Log out** to return to the access screen.

---

## 2.12 Inactive buttons and messages

Depending on context (task, data state, current tab), some actions are dimmed or a short message explains that the action does not apply. That is not a fault of the app: in another flow or with other data, the same control can become available again.

---

## 2.13 Reminders

**Path:** reminders button in the top bar, **Reminders** tab when you can open it.

![Reminders tab](../docs/app-screenshots/capture-en-recordatorios.png)

You create and manage operational reminders with due date and priority from that screen when the module is available in your environment.

- Priorities: **When possible**, **Attention**, **Urgent**
- Priority can escalate automatically over working days
- Dashboard shows a reminders preview and quick access
- Completed reminders keep completion date for follow-up
- **Visibility:** each user only sees reminders **they created** (the JSON backup on the machine may hold everyone’s reminders; the UI filters by session).

---

## About the author

The application is created by **Luis Goire**, who builds it as a programming enthusiast and with the goal of growing into a developer role.

**Email:** [blakillbyte@gmail.com](mailto:blakillbyte@gmail.com)

---

# Summary

The manual walks through **Inventory**, **Movements**, **Orders**, **History**, **Transport**, **receptions in Settings**, **reports**, **data import/export**, and **demo mode**. Each module is used with the visible tabs and buttons: when something does not apply, the interface dims or hides it without blocking the rest of your work.
