# Phoenix Cell G-NEEX 1.7

### Sistema Integral de Gestión de Inventario y Logística

*Desarrollo: **Luis Goire** — aficionado a la programación, en formación como programador.*
*Actualizado: mayo de 2026 (v1.7)*

---

## Antecedentes del proyecto

- **Necesidad industrial:** control de inventario más estricto solo con un ordenador, sin otra infraestructura.
- **Origen Excel:** hoja de cálculo que creció con macros frente a problemas diarios de fábrica; evolución hacia un gestor integrado.
- **Doble aprendizaje:** automatizar incidencias y, al mismo tiempo, aprender programación y scripts.
- **Phoenix:** tras un fallo grave del archivo y su recuperación, el nombre simboliza «renacer de las cenizas»; esa hoja es el ADN de G-NEEX.
- **Hoy:** la línea Phoenix en Excel sigue donde aporta valor hasta que G-NEEX sea plenamente operativa en web; este producto es un paso hacia lo que vendrá.

---

## El Problema

Las empresas de instalaciones eléctricas y proyectos industriales enfrentan desafíos diarios:

- **Descontrol de materiales** — No se sabe qué hay en stock ni dónde está
- **Movimientos sin registro** — Material que sale sin documentar quién, cuándo ni por qué
- **Transportes desorganizados** — Checklists en papel, camiones sin seguimiento
- **Sin trazabilidad** — Imposible rastrear el origen de una falta o exceso
- **Dependencia de internet** — Sistemas en la nube que fallan cuando más se necesitan

---

## La Solución: G-NEEX

**G-NEEX** es una aplicación web que funciona **100% offline**, directamente en el navegador, sin necesidad de servidores externos ni conexión a internet.

**Datos en el navegador:** inventario, movimientos y sesión se guardan en el almacenamiento local del navegador. Bloquee el equipo, use cuentas personales, exporte respaldos e importe JSON solo si confía en el origen.

**Misma URL siempre:** los datos dependen del *origen* del navegador (protocolo, host, puerto, ruta). Use siempre la misma forma de abrir la app (p. ej. servidor local `http://127.0.0.1:PUERTO/`). No mezcle `file://` con `http://` ni cambie de puerto sin darse cuenta: listas «vacías» suelen ser otro almacén.

**Respaldo e Import/Export:** la pestaña Import/Export y las operaciones críticas de respaldo están reservadas a la **cuenta administrador**; la elevación temporal de permisos no sustituye ese rol. Los fondos del inicio de sesión pueden rotar según `assets/login-bg-manifest.json`. El **respaldo JSON completo** incluye el catálogo de **unidades de medida y equivalencias**. Al importar JSON, las claves que **no vienen** en el archivo **ya no borran** el resto de datos locales (los respaldos viejos sin ciertas secciones no vacían, por ejemplo, el catálogo de unidades).

**Unidades de medida:** ⚙️ Configuración → **Unidades** (símbolos y equivalencias); el catálogo incluye **U** como referencia genérica (no se borra); cada artículo elige unidad de stock en el editor o puede quedar sin unidad; el inventario muestra el símbolo junto al stock principal cuando está definido y, si aplica, una línea **≈** en otra unidad; plantilla/CSV con columnas opcionales `UnidadStockSimbolo` y `UnidadEquivalenteSimbolo`. En **movimientos** las cantidades siguen siendo numéricas: la coherencia con la unidad del artículo es operativa.

Gestiona todo el ciclo de vida del material:

**Entrada** → **Almacén** → **Salida** → **Transporte** → **Obra**

*Capturas reales v1.6 (Playwright). Regenerar: `docs/app-screenshots/README.md`.*

![Inicio de sesión (entrada a la app)](../docs/app-screenshots/capture-es-01-login.png)

---

## Inventario en Tiempo Real

![Pestaña Inventario](../docs/app-screenshots/capture-es-inventario.png)

| Función | Descripción |
|---------|-------------|
| **Vista completa** | Tabla con código, descripción, categoría, stock Principal/Producción/Transformación, ubicación y fecha de expiración |
| **Unidades de medida** | Símbolo junto al stock principal si el artículo tiene unidad (y equivalente opcional **≈**); ⚙️ **Unidades** + edición por artículo |
| **3 stocks independientes** | Principal, Producción y Transformación — cada uno con seguimiento propio |
| **Búsqueda instantánea** | Filtro en vivo por código, descripción, categoría o ubicación |
| **Menú herramientas (⋮)** | Primera opción **Ocultar filtros en línea** (flecha): cierra las barras caja / depósito / consumible; **deshabilitada** si ninguna barra está abierta. El menú **⋮** agrupa exportar, imprimir, filtros, stock a fecha, resúmenes, etc. |
| **Filtro caja / ubicación** | Selector: cajas BOX1… (texto Ubicación **y** gestión por caja), catálogo (E1R, ETOP, BIN 8, ARMOIRE…) **y** stock por ubicación en chips; chips en la tabla |
| **Resumen por caja** | Agrupación por caja inferida en el texto; en el modal, fila clicable (E1R, etc. se detectan además en el filtro y en las etiquetas) |
| **Stock por caja operativo** | Gestión real por artículo: alta/edición/baja de cajas, reparto entre cajas / prod. / transf. y transferencia de caja a ubicación directa (sin caja) con saldo por ubicación (`E2R: 12`); hoja unificada **Datos** (**Codigo, Caja, UbicacionCaja, CantidadCaja, CantidadCajas, Vacia**) para plantilla, exportación completa y reimportación |
| **Alertas automáticas** | Stock bajo, negativo, sobrestock y expiración próxima |
| **Modal detalle stock bajo** | Columnas: ignorar alerta, **Acciones** (🛒 lista de compra), **Código**, resto de campos |
| **Modo a fecha** | Consulta el inventario exactamente como estaba en una fecha seleccionada |
| **Código de colores** | El **stock principal** usa una **pastilla** (rojo negativo, violeta sobre-máximo, naranja caducado, próximo ámbar, OK verde, cero remarcado). **Barras naranja / morada** en la fila: cantidad en ventana de alerta de caducidad vs datos de caducidad aún incompletos. **Contorno turquesa**: faltan campos clave del editor para cálculos (**pasar el ratón por la fila**). Pulso rojo en código/descripción = nota de problemas. Marca de consumible en la primera celda. **Resaltado violeta en toda la fila**: selección con teclado (↑/↓). Encima del carrusel, un recuadro fijo muestra el **consejo del día** (366 textos por año civil, hora local, idioma activo). El **carrusel del panel** muestra resumen, actividad, transporte, pendientes, pedidos, caducidad y cajas en cero. |
| **Exportar e imprimir** | XLSX descargable (tabla con estilo) y vista de impresión formateada |

---

## 18 Tipos de Movimiento

![Pestaña Movimientos (rejilla de tipos)](../docs/app-screenshots/capture-es-movimientos.png)

G-NEEX soporta **18 tipos de movimiento** que cubren todas las operaciones de un almacén industrial:

La rejilla de botones usa siempre **6 columnas × 3 filas**; si el ancho no alcanza, la zona permite **desplazamiento horizontal** sin perder la alineación.

| Categoría | Tipos |
|-----------|-------|
| **Operaciones diarias** | Consumo Diario, Ajuste, Ferretería, Especial |
| **Proyectos / Obra** | Lista de Chequeo, M.E. Obra, M.E. Producción, Merma |
| **Venta / envío a obra** | Venta directa (SO obligatorio), Expedición de stock (proyecto y PR obligatorios) |
| **Logística inversa** | Retorno, Desmantelar |
| **Producción** | Enviar a Producción, Transformación, Transferencia |
| **Abastecimiento** | Compra de Stock, Recepción de Material |
| **Planificación** | Stand-By (borradores sin efecto hasta su liberación) |

En la pestaña **Movimientos**, al pulsar un tipo se abre el formulario en una **ventana superpuesta dentro de la aplicación** (la vista sigue mostrando la cuadrícula de tipos detrás).

En los tipos que **restan inventario**, la columna **Origen stock** permite elegir **de qué depósito** sale la cantidad: **principal** (Almacén general), **cajas**, **ubicaciones** (solo etiqueta en la lista), **stock de producción** y **stock de transformación** (con cantidad cuando aplica); la misma referencia puede ir en **varias líneas** con orígenes distintos. Si el formulario incluye columna **Destino** además del origen, el **origen** define el descuento físico y el **destino** puede ser distinto. **Venta directa** y **Expedición de stock** solo permiten **principal, cajas o ubicaciones** (no producción ni transformación); la venta exige **SO** (`SO` + 4–6 dígitos); la expedición exige **proyecto** y **PR** (`PR` + 4–6 dígitos). Referencias de movimiento: prefijos **VDT** y **EXP** + 6 dígitos por tipo.

**M.E. obra:** las **cantidades** en cada línea son de inventario; al **Procesar movimiento** se introduce el **total de cajas** del envío (se distribuyen entre líneas según las cantidades).

**Calculadora de cantidad (🧮):** junto a la cantidad de cada línea abre un **modal** para operar con números y operadores (+ − × ÷, paréntesis, memoria); **Usar en cantidad** aplica el resultado a esa línea.

Cada movimiento registra automáticamente:
- **Quién** lo realizó
- **Cuándo** se ejecutó
- **Stock anterior** de cada artículo afectado
- **Justificación** en caso de sobregiro

---

## Globos flotantes (Stand-by y Consumo diario)

- Accesos flotantes (por defecto abajo a la derecha), **ocultos hasta** elegir el tipo en **Movimientos**: **Stand-by** (⏸) y **Consumo diario** (📅).
- **Ocultar** cada uno desde el panel (⏬); preferencia en el navegador.
- **Arrastrar** el botón circular para moverlos por la pantalla; la posición se guarda en el equipo. Un toque sin arrastre abre o cierra el panel.
- **Carrito Consumo diario:** líneas pendientes por día local; **cierre/recuperación** automáticos si cambió el día o la app estuvo cerrada (reglas de stock). Con el tipo **Consumo diario** seleccionado en Movimientos no se interrumpe el formulario (~23:00 / cambio de día); al pasar a otro tipo se aplica lo pendiente.
- **Fecha del movimiento (Consumo diario):** cada línea guarda el instante en que se añadió; al **procesar**, la fecha del movimiento es la del **primer** artículo del carrito (respaldo: hora de proceso si faltara marca).
- **Cantidades:** como máximo **cuatro decimales** en pantalla y en valores guardados (redondeo).
- **Destinatario «Otro»:** escriba el nombre libremente cuando no esté en las listas del desplegable.

---

## Pedidos a proveedor (órdenes por línea)

![Pestaña Pedidos](../docs/app-screenshots/capture-es-pedidos.png)

- Pestaña **Pedidos**: líneas vinculadas al inventario (código, proveedor, cantidad); el **OC/PO** se informa **por línea** en **Compra de stock** al recibir (no filtra el vínculo con el pedido: deben coincidir **código de artículo** y **proveedor**).
- Filtros en el panel: búsqueda de texto (referencia/código/descripción/proveedor/cantidades), estado, fecha clave (desde/hasta) e historial (con/sin recepción, con pedido, con anulación).
- Estados: borrador → pedida → recepción parcial/total o cancelada; fechas guardadas para seguimiento.
- La **recepción** abre el mismo formulario **Compra de stock** que en Movimientos; se confirma con **Procesar movimiento**.
- Si registra **Compra de stock** solo desde Movimientos y hay un pedido pendiente con **mismo código y mismo proveedor** que la línea de compra, pueden aparecer diálogos **Sí / No** para enlazar y actualizar cantidad recibida y estado.
- **Exportar / Imprimir tabla** trabajan sobre la vista filtrada; hay limpieza masiva (+1 año) y eliminación por línea (>3 meses).
- **Referencias** de movimiento: **siglas del tipo + 6 dígitos correlativos por tipo** (p. ej. `AJU000001`, `COM000002`); los datos antiguos con más dígitos se normalizan al cargar.
- Algunas categorías se gestionan como **recepción provisional** con PO obligatoria antes de impactar stock principal.
- **Fecha real de recepción (opcional):** puede ser pasada para trazabilidad (notas/seguimiento), manteniendo la fecha/hora real de registro del movimiento.

---

## Vistas de listado (estilo Explorador)

![Pestaña Historial (vistas mosaico / tabla / carrusel)](../docs/app-screenshots/capture-es-historial.png)

- **Historial**, **Transporte** y **Pedidos** incluyen un selector **Vista** con disposición en **mosaico** (tarjetas o iconos), **lista compacta** y, donde aplica, **tabla detallada**; además, en **Historial** hay **Carrusel cronológico** para recorrer tarjetas en secuencia horizontal. Las tarjetas minimizadas muestran también el **ID Proyecto** cuando corresponde.
- En **Historial**, movimientos anulados en total o con **anulado parcial** muestran un **sello diagonal** (marco discontinuo inclinado); también hay filtro por tipo de anulación.
- Nuevo filtro **Notas del movimiento**; filtros **SO (venta directa)** y **PR (expedición)**; en el detalle se pueden **añadir notas** sin borrar las existentes; las cantidades por **gestión de caja** generan **AJUSTE** en historial.
- **Fechas en pantalla (toda la app):** día, mes en tres letras, año en cuatro cifras; con hora, **24 h** hora local.
- En **Historial → Consumo diario por destinatario**, la tabla permite **editar destinatarios**, **guardar cambios** y **limpiar las filas visibles** según filtros.
- **Adjuntos (📎)** en el detalle de un movimiento y en el transporte expandido: enlazan archivos en cualquier carpeta del equipo (sin copiarlos a la app); se abren con Chrome/Edge. Los respaldos JSON no incluyen los archivos: en otro PC hay que volver a enlazar.
- **Imprimir** en el detalle de un movimiento abre **tablas** (alineadas con la exportación XLSX), no la maqueta en pantalla.
- Impresiones en **A4 vertical**; tablas sin columnas aplastadas por igual; **código** de artículo en una línea legible.

---

## Transporte Inteligente

![Pestaña Transporte](../docs/app-screenshots/capture-es-transporte.png)

El módulo de transporte automatiza la logística de envío a obra:

- **Creación automática** — Los checklists y M.E. Obra generan transportes automáticamente
- **Multi-camión** — Un proyecto puede tener múltiples transportes si la carga lo requiere
- **Panel visual** — Tarjetas con estado, líneas y fecha de expedición
- **Expedición controlada** — Solo se puede expedir cuando todas las líneas están resueltas
- **Creación manual** — Para casos excepcionales sin checklist asociado
- **Historial completo** — Registro de cada acción realizada sobre el transporte
- **Trazabilidad** — Resumen en la pestaña Transporte (recepciones pendientes de expedir, líneas con cantidad en camiones activos, últimos expedidos, stock en empresa) más una **lista manual** editable por tipo de material y fase (en planta / camión / ya salió)
- **Reporte por camión** — Cada camión permite **Exportar** o **Imprimir** una tabla con materiales, cantidades y dimensiones de la carga actual

---

## Dashboard — Visión General al Instante

![Panel tras el inicio de sesión (resumen)](../docs/app-screenshots/capture-es-panel.png)

Al iniciar sesión, un panel muestra el estado actual de la operación:

```
┌──────────────────┬──────────────────┬──────────────────┬──────────────────┐
│  MOVIMIENTOS HOY │  ALERTAS ACTIVAS │    TRANSPORTES   │ ÚLTIMO RESPALDO  │
│                  │                  │    PENDIENTES    │                  │
│       12         │        5         │        3         │     Hoy          │
│  ▸ Consumo: 4    │  ▸ Stock bajo: 2 │                  │                  │
│  ▸ Checklist: 3  │  ▸ Negativo: 1   │                  │                  │
│  ▸ Ajuste: 5     │  ▸ Expiración: 2 │                  │                  │
└──────────────────┴──────────────────┴──────────────────┴──────────────────┘
```

Indicadores visuales alertan si hay stock crítico o si el respaldo tiene más de 7 días.

---

## Recordatorios (Admin)

![Pestaña Recordatorios](../docs/app-screenshots/capture-es-recordatorios.png)

- Pestaña dedicada para recordatorios operativos con fecha objetivo y prioridad.
- Las prioridades pueden escalar automáticamente por antigüedad en días hábiles.
- El dashboard incluye vista previa y navegación rápida a recordatorios.

---

## Aplicación en pantalla (visión de uso)

![Panel o dashboard (G-NEEX)](../docs/app-screenshots/capture-es-panel.png)

- G-NEEX organiza el trabajo en módulos con acceso directo desde la barra: inventario, movimientos, historial, transporte, pedidos, recordatorios y ajustes.
- El administrador define usuarios en **⚙️ Configuración → Usuarios** con plantillas genéricas o **perfiles de referencia** (mismo comportamiento que las cuentas integradas del proyecto); la tabla **`PlantillasPermisos.xlsx.csv`** documenta cada clave.
- El manual de usuario explica qué hace cada pantalla y flujo. Cómo se despliega o gobierna el acceso en su planta es un tema operativo; aquí se prioriza el **uso cotidiano** de la interfaz y las funciones de inventario.

---

## Reportes y Exportaciones

**6 tipos de reporte** en formato **.xlsx** (encabezado naranja, datos centrados en negrita, anchos de columna) con nombres descriptivos:

- Resumen de transportes
- Líneas de transporte detalladas
- Movimientos filtrados (respeta filtros activos)
- Líneas de movimientos filtrados
- Todos los movimientos
- Consumo por artículo específico

Los archivos incluyen rango de fechas en el nombre:

`GNEEX_All_Movements_2024-03-15_to_2026-04-15.xlsx`

---

## Protección de Datos

| Función | Descripción |
|---------|-------------|
| **Respaldo completo** | Exporta toda la base en un JSON (inventario, movimientos, destinatarios plantilla y ocasionales, etc.) |
| **Restauración** | Importa un respaldo previo y restaura todo el sistema |
| **Archivar movimientos** | Exporta movimientos antiguos y los elimina para liberar espacio |
| **Reimportar archivos** | Reintegra movimientos archivados sin duplicar datos |
| **Export / fusión solo movimientos** | Exporta solo el historial de movimientos; la fusión añade ids nuevos y aplica stock (sin pisar toda la base) |
| **Inventario inicial** | Carga masiva mediante **CSV** o **XLSX** y descarga de plantilla **.xlsx** con columnas y estilo correctos |
| **Alerta de respaldo** | El dashboard avisa si hace más de 7 días sin respaldo |

---

## Multilenguaje y Personalización

### 3 idiomas completos
- 🇪🇸 Español
- 🇺🇸 English
- 🇫🇷 Français

### 2 temas visuales
- 🌙 Modo oscuro
- ☀️ Modo claro

### Modo demostración (opcional)
- Interruptor **Prueba**: tema **azul** y uso normal de la app; al desactivar se **restaura** el estado de datos anterior (inventario, movimientos, etc.) y se **pierden** los cambios de la demostración
- **Tema** claro/oscuro e **idioma** no se revierten
- Confirmación al salir; banda informativa bajo el encabezado

### Diseño responsive
- Se adapta a pantallas de escritorio, tablet y móvil
- Textos optimizados sin saltos de línea innecesarios
- Tipografía profesional (Roboto + Orbitron)

---

## Especificaciones Técnicas

| Aspecto | Detalle |
|---------|---------|
| **Tecnología** | HTML5, CSS3, JavaScript (vanilla) |
| **Almacenamiento** | localStorage del navegador |
| **Conexión** | No requiere internet ni servidor |
| **Instalación** | Abrir `index.html` en cualquier navegador moderno |
| **Compatibilidad** | Chrome, Edge, Firefox, Safari |
| **Referencias** | Movimientos con código tipo siglas + 6 dígitos por tipo (`AJU…`, `COM…`…); datos antiguos se normalizan |
| **Varios equipos** | Cada navegador guarda sus datos en localStorage; no se comparten solamente por abrir la misma carpeta o URL |
| **Dependencias externas** | Fuentes web opcionales; exportación **XLSX** con biblioteca **xlsx-js-style** incluida en `vendor/` |
| **Tamaño** | Ligero, carga en segundos |

---

## ¿Por Qué G-NEEX?

| Ventaja | Competencia tradicional | G-NEEX |
|---------|------------------------|--------|
| Costo | Licencias mensuales elevadas | **Gratuito** |
| Internet | Requiere conexión permanente | **100% offline** |
| Instalación | Servidores, bases de datos, IT | **Abrir un archivo** |
| Curva de aprendizaje | Semanas de capacitación | **Uso intuitivo inmediato** |
| Personalización | Rígido o costoso | **Adaptable al flujo de trabajo** |
| Datos | En servidores de terceros | **En tu equipo, bajo tu control** |

---

## Resumen de Módulos

```
                        ┌─────────────┐
                        │  DASHBOARD  │
                        └──────┬──────┘
           ┌───────────────────┼───────────────────┬───────────────────┐
           │                   │                   │                   │
    ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
    │ INVENTARIO  │    │ MOVIMIENTOS │    │  PEDIDOS    │    │ TRANSPORTE  │
    │             │    │             │    │ (proveedor)│    │             │
    │ • Artículos │    │ • 18 tipos  │    │ • Líneas OC │    │ • Automático│
    │ • 3 stocks  │    │ • Stand-By  │    │ • Recepción │    │ • Manual    │
    │ • Alertas   │    │ • Overdraft │    │   → compra  │    │ • Expedición│
    │ • Búsqueda  │    │ • Referencia│    │ • XLSX      │    │ • Panel     │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                   │                   │                   │
           └───────────────────┴───────────────────┴───────────────────┘
                        ┌──────▼──────┐
                        │ HISTORIAL + │
                        │  REPORTES   │
                        └──────┬──────┘
                        ┌──────▼──────┐
                        │CONFIGURACIÓN│
                        │             │
                        │ • Listas   │
                        │ • Editor   │
                        │ • Import/  │
                        │   export   │
                        │ • Recepc.  │
                        └─────────────┘
```

---

## Novedades 1.7 (mayo 2026)

- **Pantalla de bienvenida cinemática (~6 s)** tras iniciar sesión: secuencia tipo «boot up» con **scanner verde Matrix** lento, **anillos orbitales** alrededor del logo, **«G-neex» con flicker fuerte tipo neón**, sweep de «BIENVENIDO A», «PHOENIX EVOLUTION» y tu nombre. Sirve también como margen de carga real de la app.
- **Logo como atajo de actualización**: clic en el logo del header → giro antihorario y se dispara la acción unificada **Actualizar inventario** (normaliza ubicaciones / cajas, reconcilia el stock principal con cajas y ubicaciones, refresca caducidades de lotes). Mismo acceso desde el menú herramientas.
- **Cajas en stock principal**: el principal ahora cuadra automáticamente con la suma de cajas + ubicaciones; al consumir desde una caja el principal baja igual. La acción «Actualizar inventario» repara respaldos antiguos donde el principal y los contenedores no estaban alineados.
- **Editor de lotes en el artículo**: añadir varias fechas de expedición / caducidad / cantidad por artículo, con cálculo en vivo de la caducidad efectiva según la **vida útil en meses** declarada. La compra de stock añade un lote por fila automáticamente.
- **Insight de caducidad** con columna nueva **Cantidad afectada** (vencidas + próximas a vencer) y tooltip de desglose.
- **Tooltip de lotes en la tabla** muestra una fila sintética «Sin lote (resto del stock principal)» cuando hay al menos un lote explícito, para que la suma cuadre con el principal.
- **Plantilla solo-stock**: exportar plantilla XLSX con código y stock principal, modificar a mano y reimportar — solo se actualizan cantidades, sin tocar ubicaciones ni catálogo.
- **Equivalencia** (`≈`) en inventario con badge de mayor contraste en tema claro y oscuro.
- **Alineación con `gneex-hosted-api`**: el cliente `GneexApiClient` (offline hoy) deja preparado el hueco para que el siguiente paso enchufe login JWT, `GET/PATCH /api/v1/sync` y `POST /api/v1/backup/import` cuando el backend esté activo en producción.

---

## Contacto

**Phoenix Cell G-NEEX v1.7**

Gestión de inventario industrial — simple, seguro, sin conexión.

**Autor:** Luis Goire — desarrollo por afición; interés en la programación y en consolidarse como programador.

**Correo:** [blakillbyte@gmail.com](mailto:blakillbyte@gmail.com)

---

