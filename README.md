# G-neex

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
