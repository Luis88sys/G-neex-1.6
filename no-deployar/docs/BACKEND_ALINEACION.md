# Alineación cliente ↔ backend alojado (`gneex-hosted-api`)

La SPA en la raíz del repositorio **sigue siendo 100 % navegador** (`localStorage`). El backend en `gneex-hosted-api/` está pensado para un despliegue futuro con los mismos datos y reglas de seguridad. Este documento es el contrato vivo entre los dos lados: lo que ya está alineado, lo que falta y los gotchas conocidos.

## Estado a mayo 2026 (v1.7)

| Pieza | Cliente (`js/`) | API (`gneex-hosted-api/`) | Alineación |
|---|---|---|---|
| Hash de contraseña | `Auth._hash` → `g-neex-v1\|salt\|password` SHA-256 hex | `src/hash.js` con el mismo esquema | ✅ idéntico |
| Almacén de datos | `localStorage` con claves `phoenix-*` | SQLite, tabla `data(key, value)` con las mismas claves | ✅ forma compartida |
| Respaldo JSON | Export con `format: "G-NEEX-backup"`, `data: {...stringified}` | `POST /api/v1/backup/import` consume el campo `data` | ✅ formato compatible |
| Líneas de movimiento (`items[]`) | Objetos libres (código, cantidad, `stockSourceId`, metadatos opcionales p. ej. `metaBoxMgrAjuste`, notas en el **movimiento** como string `notes`) | Misma cadena JSON en SQLite (`phoenix-movements`) | ✅ campos extra ignorados por versiones viejas; respaldos sin nuevas claves siguen siendo válidos |
| Usuarios integrados | `Auth._getBuiltinUser()` + plantillas `perfil_*` | `routes/auth.js` permite `bootstrap` + `login` | ⚠️ servidor no conoce plantillas; alta inicial requiere bootstrap + sync |
| Permisos finos | `permissionMatrix` / `permissionActionMatrix` (cliente) | `SYNC_WRITE_ROLE` (`admin` o `all`) | ⚠️ cliente granular, servidor binario; ver §3 |
| Cliente HTTP | `GneexApiClient` (`js/api-client.js`) — base URL + `ping`/`login` (stubs) | n/a | 🛠 hueco preparado, sin red activa |

✅ alineado · ⚠️ alineado parcial · 🛠 pendiente de cableado

## 1. Hash de contraseña

- Cliente y API usan el mismo esquema documentado en `gneex-hosted-api/README.md`: cadena `g-neex-v1|salt|password` y SHA-256 (hex).
- Al migrar usuarios, los objetos en `phoenix-users` (o el almacén equivalente en SQLite) deben conservar `salt` y hash compatibles. Los usuarios integrados (`gneex-builtin-*`) ya incluyen `salt` y `passwordHash` válidos para ambos lados.

## 2. Forma de datos

- El JSON de respaldo exportado por la app (`format: G-NEEX-backup`) y el campo `data` del API comparten la idea de **mapa clave → string JSON** (como en `localStorage`).
- Endpoints relevantes:
  - `GET /api/v1/auth/health` — comprobación rápida.
  - `POST /api/v1/auth/bootstrap` — primer usuario admin si no hay ninguno.
  - `POST /api/v1/auth/login` — devuelve `{ token, user }`.
  - `GET /api/v1/sync` → `{ data, revision }`.
  - `PATCH /api/v1/sync` — fusión por clave; sujeto a `SYNC_WRITE_ROLE`.
  - `PUT /api/v1/sync/full` — reemplazo completo del almacén.
  - `POST /api/v1/backup/import` — admite el JSON completo exportado por la app (admin).
  - `GET /api/v1/backup/export` — descarga JSON listo para importar en la SPA (admin).

## 3. Permisos en cliente vs servidor

- La matriz `permissionMatrix` / `permissionActionMatrix` y las claves `cfg*` / `ord*` son **solo aplicadas en el navegador** hoy.
- En un modelo online, el servidor debe volver a autorizar cada escritura (no confiar solo en el cliente). Mínimo aceptable v1: `SYNC_WRITE_ROLE=admin` y autorización binaria; mid-term: el servidor lee la matriz desde `data["phoenix-users"]` y re-evalúa por clave de acción.

## 4. Plantillas de usuario (`templateKey`)

- En cliente, al crear o actualizar un usuario no administrador, el campo lógico **plantilla** (`templateKey` en flujos futuros) debe resolverse contra la misma tabla que `Auth._buildUserTemplatePayload()` en `js/auth.js`: claves genéricas (`operario_*`, `supervisor`) y claves **perfil integrado** (`perfil_keith_lake`, `perfil_alex_beaulieu`, `perfil_guest_demo`, `perfil_patrick`, `perfil_stephane_demers`, `perfil_wen_deng`, `perfil_barbara_bonny`, `perfil_annie_larose`), delegando en los payloads builtin documentados en ese archivo.
- El archivo exportable `PlantillasPermisos.xlsx.csv` en la raíz del repo resume objetivos y restricciones por clave; debe mantenerse alineado cuando cambien las matrices.
- Cuentas con rol **administrador** no usan plantilla de matriz: el API debe aceptar rol `admin` sin `templateKey` o ignorarlo.

## 5. Cliente HTTP en la SPA (`GneexApiClient`)

- Ubicación: `js/api-client.js`.
- Persiste **solo** la base URL en `localStorage` (`gneex-api-base-url`); todo lo demás es opcional y nunca toca red sin URL configurada.
- API pública estable a partir de v1.7:

  | Método | Estado | Notas |
  |---|---|---|
  | `getBaseUrl() / setBaseUrl(url)` | listo | persistencia |
  | `isConfigured()` | listo | devuelve `true` si hay URL |
  | `ping()` | listo (stub seguro) | hace `GET /api/v1/auth/health` con `signal` y timeout corto; nunca lanza, retorna `{ ok, status, error? }` |
  | `login({ username, password })` | listo (stub seguro) | hace `POST /api/v1/auth/login`; no escribe token automáticamente — la app decide qué hacer con la respuesta |
  | `fetchSync()` / `pushSync(...)` / `importBackup(...)` | placeholders | lanzan `not-implemented`; se cablearán cuando exista política de revisión / merge |

- **No hay** llamadas HTTP automáticas desde el resto de `js/`. La SPA puede ignorar este módulo por completo y funcionar igual.

## 6. Roadmap mínimo para activar (Camino B)

1. Operativo (`gneex-hosted-api`): elegir host con disco persistente (Oracle Cloud + Docker recomendado, ver `gneex-hosted-api/docs/DESPLEGUE_ORACLE_DOCKER_ES.md`).
2. Bootstrap: `POST /api/v1/auth/bootstrap` con el admin integrado.
3. Sembrar datos: `POST /api/v1/backup/import` con `GNEEX_Backup_Madre.json` regenerado (regla `Madre mía` → `scripts/repair-backup-users.mjs`).
4. Cliente: invocar `GneexApiClient.setBaseUrl("https://api.ejemplo.com")` desde ⚙️ Configuración (UI pendiente) y `GneexApiClient.ping()` como smoke test.
5. Login híbrido: tras login local, llamar `GneexApiClient.login()` y guardar el token JWT en sesión (no localStorage persistente — la sesión SPA ya gestiona esto).
6. Sync inicial: cliente decide entre `PATCH` (merge) o `PUT /full` (admin one-shot tras importar respaldo). Definir política de revisión antes de habilitar `PATCH` desde usuarios no-admin.

## 7. Gotchas conocidos

- **CSP (`index.html`)**: la SPA declara `connect-src 'self' blob:`. Sin ajuste, **cualquier `fetch` a un origen distinto será bloqueado por el navegador**, incluso si la URL en `GneexApiClient.setBaseUrl()` es válida. Dos formas de resolverlo cuando se active el backend:
  1. Servir el API en el **mismo origen** que la SPA (reverse proxy `nginx`/`Caddy` con `/api/v1/...` proxyado a `gneex-hosted-api`). Es la opción recomendada — no hay que tocar CSP.
  2. Añadir el origen del API a `connect-src` (p. ej. `connect-src 'self' blob: https://api.ejemplo.com`). Implica mantener el CSP sincronizado con el dominio del API.
- **`phoenix-session`** nunca se sincroniza. El API la ignora en `backup/import`; el cliente tampoco la envía.
- **Tamaño**: respaldos completos pueden pasar de varios MB. El API expone `JSON_LIMIT` (`80mb` por defecto). El cliente no fragmenta hoy.
- **Tiempos**: SQLite + `better-sqlite3` es síncrono; sync masivo bloquea el thread del servidor durante el `PUT /full`. Aceptable en intranet, no en multi-tenant.
- **`prefers-reduced-motion`**: las animaciones de la SPA (logo refresh, welcome splash) son puramente cliente — no afectan ni a la API ni a la base de datos.
