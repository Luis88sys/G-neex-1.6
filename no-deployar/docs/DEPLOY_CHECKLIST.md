# Lista corta antes de publicar la SPA estática

1. **Raíz del sitio:** `index.html`, `css/`, `js/` (incl. `api-client.js`), `assets/`, `favicon.ico`, `icon/` si aplica.
2. **Ayuda embebida:** ejecutar `no-deployar\docs\sync-user-manual.ps1` tras actualizar manuales/PDF en `no-deployar/` (copia a `user-manual/` con rutas `./app-screenshots/`).
3. **PDF:** `no-deployar\docs\export-user-docs-pdf.ps1` (requiere Edge). Luego volver a ejecutar el sync del punto 2 si regeneraste PDF.
4. **No subir:** carpeta `no-deployar/` completa, respaldos locales, `gneex-hosted-api/` si el hosting es solo front estático (salvo que despliegues API aparte).
5. **Prueba humo:** misma URL siempre (`http://127.0.0.1:puerto/` o dominio final); login; cambio de pestaña principal sin errores en consola (F12). Si se documentó la pantalla de bienvenida, comprobar que textos y **duración** coinciden con `--welcome-duration` en `css/styles.css` (p. ej. ~6 s).
6. **Depuración opcional:** en consola del navegador, `window.__GNEEX_DEBUG = true` activa informes extra (importación de cajas, fusión con pedidos, historial/recepciones, export XLSX filtrado, adjuntos de transporte).
7. **Idioma:** al cambiar ES/EN/FR con ⚙️ Configuración abierta en la pestaña Usuarios, la tabla y la auditoría se vuelven a pintar con las etiquetas nuevas (plantilla de usuario incluida).
