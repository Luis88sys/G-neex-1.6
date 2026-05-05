# Capturas de G-NEEX (documentación)

PNG generados para **manuales** y **presentaciones** del proyecto. Cada idioma (es / en / fr) incluye: login, panel, inventario, movimientos, historial, transporte, pedidos, recordatorios y **Configuración → Usuarios**.

## Regenerar las imágenes

Requisitos: **Python 3** y el paquete Playwright:

```text
py -m pip install playwright
py -m playwright install chromium
```

Desde la raíz del repositorio:

```text
py no-deployar/scripts/capture_app_screenshots.py
```

Por defecto el script inicia sesión con la cuenta de administrador integrada definida en `js/auth.js` (misma lógica que la app). Puede anular el usuario y la contraseña **sin guardarlos en el código** con variables de entorno:

- `GNEEX_CAPTURE_USER`
- `GNEEX_CAPTURE_PASS`

Abre `index.html` vía `file://`, cambia el idioma en login y en la barra, y vuelca los PNG en esta carpeta.

Tras generar los PNG, copie `no-deployar/docs/app-screenshots/*.png` a `user-manual/app-screenshots/` si publica la ayuda en pantalla desde la raíz del repo.
