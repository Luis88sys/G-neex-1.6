# No incluir en el despliegue estático de la SPA

Este directorio agrupa **material importante que no forma parte** del paquete mínimo para publicar la aplicación web (HTML, CSS, JS, assets). **No borrar**: respaldos locales, migración Phoenix, manuales, presentaciones, scripts auxiliares y documentación técnica interna.

## Contenido habitual

| Carpeta | Uso |
|---------|-----|
| `Backup/` | Copias JSON/CSV de trabajo (no van al servidor de solo lectura). |
| `migration/` | Scripts y datos Phoenix → G-NEEX. |
| `User Manual/` | Manuales ES / EN / FR (`.md`, `.html`, PDF si existen). |
| `Presentation/` | Presentaciones multiidioma. |
| `tools/` | Utilidades Python u otras no necesarias en el cliente. |
| `scripts/` | Scripts PowerShell auxiliares (iconos, etc.). |
| `docs/` | Planes, capturas `app-screenshots`, export PDF de manuales, `AUTH_AND_BACKUP_ONLINE.md`, `REVISION_PRE_ENTREGA.md`, etc. |

## Despliegue mínimo de la SPA

En la raíz del repo suelen bastar: `index.html`, `css/`, `js/`, `assets/`, `icon/` según el hosting. Los backends `server/` y `gneex-hosted-api/` se despliegan como **servicios aparte**, no como carpeta estática.

## PDF de manuales

Desde la raíz del repositorio:

`powershell -NoProfile -ExecutionPolicy Bypass -File no-deployar\docs\export-user-docs-pdf.ps1`

## Copia para el despliegue web (`user-manual/`)

La aplicación enlaza desde **Ayuda** los archivos `user-manual/MANUAL_DE_USUARIO.html`, `USER_MANUAL.html`, `MANUEL_UTILISATEUR.html` y la carpeta `user-manual/app-screenshots/`. Tras cambiar los manuales en `no-deployar/User Manual/` o las capturas en `no-deployar/docs/app-screenshots/`, ejecute desde la raíz:

`powershell -NoProfile -ExecutionPolicy Bypass -File no-deployar\docs\sync-user-manual.ps1`

Ese script copia los `.html` de manuales sustituyendo `../docs/app-screenshots/` por `./app-screenshots/`, copia las presentaciones sustituyendo `../docs/app-screenshots/` por `../app-screenshots/` (respecto a `user-manual/`), actualiza capturas, `PlantillasPermisos.xlsx.csv` y los PDF generados bajo `no-deployar/` hacia `user-manual/`.

Lista previa a publicación: `docs/DEPLOY_CHECKLIST.md`.
