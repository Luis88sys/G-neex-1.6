# Revisión antes de dar por cerrado el código (SPA G-NEEX)

Checklist orientativo para mantener la UX estable: modales, permisos finos y flujos de movimiento.

## 1. Ventanas emergentes al frente

- Los modales deben usar la pila centralizada (`App._bringModalToFront`, z-index vía `Utils.nextModalStackZIndex`).
- Tras abrir un modal desde código, llamar a `_bringModalToFront` sobre el nodo del modal (patrón ya usado en Configuración → permisos de usuario).
- Si se añaden nuevos overlays o capas fijas, comprobar que no superan el z-index de los modales activos sin pasar por la pila.

## 2. Permisos finos (`data-auth-act`)

- Controles sensibles llevan `data-auth-act` y `data-auth-act-level` (`none` &lt; `view` &lt; `edit`).
- Tras cambiar DOM dinámico en pestañas con permisos finos, llamar a `Auth.syncConfigActionDomState()` cuando aplique (p. ej. tabla Pedidos tras `render()`).
- En handlers que puedan invocarse sin clic (programático), usar `Auth.guardFineAction(clave, nivelMin)` además del estado del DOM.

### Estado del roadmap de pestañas

| Área | Claves `cfg*` / `ord*` | Notas |
|------|------------------------|--------|
| Configuración | `cfg*` | Modal y pestañas Import/Export, respaldos, etc. |
| Pedidos a proveedor | `ord*` (`ordFormNewLine`, `ordLineMutations`, …) | Matriz en `Auth.ORDER_ACTION_KEYS` |

Siguientes fases previstas: Inventario, Panel, Movimientos, Historial, Recordatorios (misma idea de claves por prefijo).

## 3. Movimientos y pedidos

- Recepción desde líneas de pedido: debe seguir abriendo el mismo flujo COMPRA_STOCK (`MovementManager.openCompraStockFromOrderLine` / lote).
- **Venta directa / Expedición de stock:** validación de **SO** / **PR** (4–6 dígitos), origen de stock solo principal/cajas/ubicaciones; filtros de historial **SO** / **PR**; permisos `movType_VENTA_DIRECTA` y `movType_EXPEDICION_STOCK` en matriz.
- Vínculo pedido ↔ compra (recepción): coherencia por **código de artículo + proveedor**; PO por fila en el formulario; comprobar que al editar cantidades en la tabla no se pierden PO/proveedor antes de **Procesar**.
- Tras cambios en Pedidos o Movimientos, probar al menos: línea inactiva → pedida → recepción parcial/total, recepción múltiple con un solo proveedor, y exportación/imprimir si el rol lo permite.

## 4. Referencias en código

- Apilado de modales: buscar `_bringModalToFront`, `_setupModalStackObserver` en `js/app.js` (o equivalente).
- Permisos: `js/auth.js` (`ORDER_ACTION_KEYS`, `getSessionActionLevel`, `guardFineAction`, `syncConfigActionDomState`).
- Pedidos: `js/orderLines.js`, `index.html` sección `#orderlines-tab`.

## 5. Manual de usuario (despliegue)

- El overlay **Ayuda** enlaza `user-manual/*.html` (ES / EN / FR) y `user-manual/app-screenshots/`. Esa carpeta en la **raíz** del repo debe publicarse con la SPA; la fuente editorial sigue en `no-deployar/User Manual/` (sincronizar al actualizar manuales; ver `no-deployar/README.md`).

## 6. Impresión e informes

- Estilos de impresión: `Utils.PRINT_DOCUMENT_CSS` (`js/utils.js`); tablas con clase `inventory-table` para ancho fijo y saltos de página razonables.
- Columnas de dimensiones por paquete: `Utils.packageDimColumnLabel` + clave i18n `export.packageDimHeader` (no dejar “Paquete” fijo en español en exportaciones).

## 7. Historial, notas del movimiento y cajas

- **Filtro “Notas”** en historial: aplica solo al campo **`notes` del movimiento** (no busca en notas de línea ni descripciones de artículo); comprobar UX y textos i18n del placeholder/ayuda.
- **Detalle del movimiento:** las notas del movimiento deben **acumularse** al añadir desde el detalle (no sobrescribir historial previo salvo flujo explícito de edición).
- **Gestión por caja / AJUSTE:** al guardar cantidad desde el gestor de cajas, el movimiento tipo `AJUSTE` debe reflejar `metaBoxMgrAjuste` donde corresponda; historial e informes deben seguir mostrando coherencia de stock.
- **Asistente “Consumo por cajas (orden)”** (`MovementManager`, modal en `index.html`): visible solo cuando aplica el tipo de movimiento; comprobar cierre de modal, foco y que las líneas generadas respetan permisos y destinatario.
- **Respaldo / API:** importar respaldos viejos sin `metaBoxMgrAjuste` u otras propiedades opcionales en líneas no debe romper la carga; documentado en `no-deployar/docs/BACKEND_ALINEACION.md` y `README.md` raíz.
