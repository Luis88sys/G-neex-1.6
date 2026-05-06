# G-neex

Material que **no** va en el despliegue estático de la SPA (manuales “fuente”, migración, respaldos de trabajo, documentación técnica, scripts auxiliares) está en **`no-deployar/`** — ver `no-deployar/README.md`.

En la **raíz** del repo, la carpeta **`user-manual/`** contiene el manual HTML en ES / EN / FR y las capturas necesarias para que el botón **Ayuda → Manual de usuario** funcione en producción. Si actualiza los manuales en `no-deployar/User Manual/` (por ejemplo tras «ACTUALIZA AHORA»), copie de nuevo los `.html` y `app-screenshots` a `user-manual/` o ejecute el mismo proceso documentado en `no-deployar/README.md`.

## Notas funcionales recientes (inventario y movimientos)

- La jerarquía operativa de stock es: `global (principal/producción/transformación) -> ubicación -> caja -> sin caja`.
- En inventario, la columna `Ubicación` muestra solo etiquetas detectadas interactivas cuando existen (sin duplicar texto libre).
- Clic en etiqueta de `caja` abre la gestión por caja del artículo/caja; clic en etiqueta de `ubicación` solo informa cantidad (toast) y no cambia filtros ni vista.
- En herramientas de inventario queda solo `Cajas sin unidades (total por caja)` para localizar cajas vacías reutilizables.
- En Ayuda, los enlaces de `Presentaciones` dentro de `user-manual/` se muestran solo para perfil administrador.
- En movimientos, la validación de `Origen stock` se aplica solo en tipos/líneas que descuentan stock desde ese origen; con sobregiro permitido exige causa obligatoria, y en los demás casos bloquea hasta corregir origen/distribución.
