# Autenticación en línea, usuarios integrados y respaldos (G-NEEX)

## Resumen

- La aplicación funciona como **SPA en el navegador** con **inicio de sesión por usuario y contraseña** almacenados de forma **derivada** (sal + hash SHA-256); **no hay contraseñas en texto plano en el código fuente**.
- Las **cuentas integradas** (mismos usuarios que antes) se crean automáticamente en `localStorage` la primera vez que hace falta, con los mismos accesos que antes del cambio; el **administrador** puede **cambiar contraseñas** y datos desde **Configuración → Usuarios** (perfil / contraseña).
- Cualquier usuario **con sesión iniciada** puede usar la pestaña **Import/Export**: **importar/exportar respaldo JSON**, **respaldos ZIP**, **fusionar movimientos/transportes**, **CSV/XLSX de inventario inicial**, **exportar solo movimientos**, **exportar transportes expedidos**, archivar/reimportar, etc. **Solo el administrador**: pestaña **Usuarios**, **códigos de elevación**, bloque **Destinatarios (vista rápida)** en Import/Export y **borrar base de datos**.
- **Varios dispositivos (misma URL en la nube):** cada navegador conserva su propio `localStorage`. Abrir la app en el móvil con la misma URL **no** copia sola los datos del PC; para alinear dos equipos hay que **exportar** el JSON en uno e **importarlo** en el otro (o usar en el futuro un backend de sincronización si se despliega). El acceso por **`http://` + IP local** puede impedir el inicio de sesión en algunos navegadores; la URL **HTTPS** del despliegue evita ese problema.

## Fondo de la pantalla de login

- Las imágenes de fondo rotativas se definen en **`assets/login-bg-manifest.json`** (clave `"images"`: lista de rutas relativas `assets/...`).
- Si el archivo falta o está vacío, se usa **`assets/logo.png`**.
- Para regenerar el manifiesto a partir de los archivos presentes en `assets/`, ejecute desde la raíz del proyecto:

```powershell
powershell -NoProfile -File scripts\generate-login-bg-manifest.ps1
```

## Si olvidó la contraseña (versión en línea)

- En la pantalla de acceso, **«¿Olvidó su contraseña?»** abre un mensaje: debe **contactar al administrador Luis Goire**. La aplicación **no** envía correos automáticos ni enlaces de restablecimiento desde el navegador.
- La carpeta opcional **`server/`** expone un API de **bootstrap** y **login** contra un archivo de usuarios en el servidor; **no** sustituye por sí sola al almacenamiento local de la SPA. Ver **`server/README.md`**.

## Seguridad

- Cambie las contraseñas integradas tras el despliegue si la copia de la aplicación es compartida.
- Los hashes presembrados equivalen a las contraseñas anteriores **solo hasta que el administrador las sustituya** en Configuración.

## Notas técnicas

- **Historial (cliente):** hay un filtro de texto **solo en notas del movimiento**; las notas guardadas al crear el movimiento y las **añadidas después** (desde el detalle, sin borrar lo anterior) se buscan ahí. El filtro por código de artículo **no** incluye el texto de `notes`.
- **Respaldo JSON:** el campo `notes` de cada movimiento y cualquier metadato extra en `items` viajan en el string de `phoenix-movements`; importar un archivo antiguo **no** exige reescribir esos campos.
- La elevación temporal de permisos sigue existiendo para **transporte** y otras acciones; **no** sustituye al administrador para **Usuarios**, **códigos de elevación** ni **borrar base de datos**.
- El archivo `login-bg-manifest.json` debe servirse con el mismo origen que la app (misma carpeta o CDN) para que `fetch` funcione sin CORS adicional.
