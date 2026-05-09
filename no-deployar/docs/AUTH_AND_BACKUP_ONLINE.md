# Autenticación en línea, usuarios integrados y respaldos (G-NEEX)

## Resumen

- La aplicación funciona como **SPA en el navegador** con **inicio de sesión por usuario y contraseña** almacenados de forma **derivada** (sal + hash SHA-256); **no hay contraseñas en texto plano en el código fuente**.
- Las **cuentas integradas** (mismos usuarios que antes) se crean automáticamente en `localStorage` la primera vez que hace falta, con los mismos accesos que antes del cambio; el **administrador** puede **cambiar contraseñas** y datos desde **Configuración → Usuarios** (perfil / contraseña).
- Cualquier usuario **con sesión iniciada** puede usar la pestaña **Import/Export**: **importar/exportar respaldo JSON**, **respaldos ZIP**, **fusionar movimientos/transportes**, **CSV/XLSX de inventario inicial**, **exportar solo movimientos**, **exportar transportes expedidos**, archivar/reimportar, etc. **Solo el administrador**: pestaña **Usuarios**, **códigos de elevación**, bloque **Destinatarios (vista rápida)** en Import/Export y **borrar base de datos**.

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

- La elevación temporal de permisos sigue existiendo para **transporte** y otras acciones; **no** sustituye al administrador para **Usuarios**, **códigos de elevación** ni **borrar base de datos**.
- El archivo `login-bg-manifest.json` debe servirse con el mismo origen que la app (misma carpeta o CDN) para que `fetch` funcione sin CORS adicional.
