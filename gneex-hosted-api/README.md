# gneex-hosted-api

Backend **nuevo y separado** del proyecto G-NEEX: autenticación con el **mismo algoritmo de hash** que el cliente (`g-neex-v1|salt|password` → SHA-256), almacén en **SQLite** con claves equivalentes a `localStorage` (p. ej. `phoenix-inventory`, `phoenix-users`, …) e **importación** del JSON de respaldo completo de la app (`format: G-NEEX-backup`).

**Importante:** la SPA en la raíz del repositorio **aún no llama a esta API**; sigue usando solo el navegador. Conectar la interfaz implica desarrollar en el cliente la lectura/escritura contra estos endpoints (o un servicio intermedio).

## Requisitos

- Node.js 18+
- `npm install` (incluye `better-sqlite3`; en Windows suele usarse el binario precompilado)

## Instalación y arranque

```bash
cd gneex-hosted-api
copy .env.example .env
# Edite .env: sobre todo JWT_SECRET en producción
npm install
npm start
```

Por defecto escucha en `http://localhost:3040`.

Base de datos: `data/gneex-hosted.db` (carpeta `data/` creada al arrancar). Haga copias de seguridad de ese archivo en producción.

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto HTTP (default `3040`) |
| `JWT_SECRET` | Secreto para firmar tokens (obligatorio cambiar en producción) |
| `JWT_EXPIRES_DAYS` | Caducidad del token (default `7`) |
| `CORS_ORIGIN` | Origen permitido para CORS; vacío = permisivo para desarrollo |
| `SYNC_WRITE_ROLE` | `admin` (solo administradores escriben datos) o `all` (cualquier usuario autenticado) |
| `JSON_LIMIT` | Tamaño máximo del body JSON (respaldos grandes; default `80mb`) |
| `SQLITE_PATH` | Ruta opcional al fichero SQLite |

## Flujo inicial

### 1. Crear el primer usuario (bootstrap)

Solo funciona si **no hay ningún usuario** en la base.

```bash
curl -X POST http://localhost:3040/api/v1/auth/bootstrap ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin\",\"email\":\"admin@example.com\",\"password\":\"SuClaveSegura\",\"displayName\":\"Admin\",\"role\":\"admin\"}"
```

Respuesta incluye `token` (JWT) y `user`.

### 2. Iniciar sesión

```bash
curl -X POST http://localhost:3040/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin\",\"password\":\"SuClaveSegura\"}"
```

### 3. Subir un respaldo G-NEEX (opcional)

Con el token devuelto (`TOKEN`):

```bash
curl -X POST http://localhost:3040/api/v1/backup/import ^
  -H "Authorization: Bearer TOKEN" ^
  -H "Content-Type: application/json" ^
  --data-binary @ruta/al/GNEEX_Backup_....json
```

Requiere rol **admin**. El cuerpo debe ser el JSON completo exportado por la app; se usa el campo `data` (las mismas claves que `localStorage`). `phoenix-session` se ignora.

Los valores de `data` son **cadenas JSON** tal como en el navegador (p. ej. `phoenix-movements` es un array serializado). Las **líneas** dentro de cada movimiento pueden incluir propiedades opcionales que añada solo el cliente en versiones nuevas; el servidor las **persiste tal cual** — no hace falta migrar respaldos viejos por ausencia de esas claves.

### 4. Leer / escribir estado

- **GET** `/api/v1/sync` — Header `Authorization: Bearer …`. Devuelve `{ data: { clave: valorString }, revision }`.
- **PATCH** `/api/v1/sync` — Body `{ "data": { "phoenix-inventory": "[...]", ... } }`. Fusiona claves (según `SYNC_WRITE_ROLE`).
- **PUT** `/api/v1/sync/full` — Reemplaza por completo el almacén con `data` (misma forma).

- **GET** `/api/v1/backup/export` — Descarga JSON compatible con importación en la app (admin).

## Seguridad en producción

- HTTPS obligatorio delante del API (proxy inverso o hosting gestionado).
- `JWT_SECRET` largo y aleatorio.
- Restringir `CORS_ORIGIN` al dominio de la SPA.
- Considerar **solo admin** para escritura: `SYNC_WRITE_ROLE=admin` (valor por defecto en `.env.example`).

## Despliegue

Guía detallada paso a paso (Oracle Cloud + Docker Compose, en español): **[docs/DESPLEGUE_ORACLE_DOCKER_ES.md](docs/DESPLEGUE_ORACLE_DOCKER_ES.md)**.

Es una API **Node.js** que escucha un puerto HTTP y guarda todo en **SQLite** (`data/gneex-hosted.db`). El archivo debe vivir en **disco persistente** (no en sistemas de ficheros efímeros).

### 1) VPS / servidor Linux (recomendado)

1. Instale Node.js 18+ (o use Docker, más abajo).
2. Copie la carpeta `gneex-hosted-api`, cree `.env` en el servidor (no lo suba a git público).
3. En producción defina al menos: `JWT_SECRET`, `CORS_ORIGIN=https://su-spa.ejemplo.com`, `PORT` si no usa el predeterminado.
4. Instale dependencias y ejecute con un supervisor que reinicie si falla:

```bash
cd gneex-hosted-api
npm ci --omit=dev   # o npm install --omit=dev
NODE_ENV=production npm start
```

Con **PM2** (ejemplo):

```bash
npm install -g pm2
cd gneex-hosted-api
pm2 start src/index.js --name gneex-api
pm2 save
pm2 startup
```

5. Delante del proceso ponga **HTTPS**: **nginx**, **Caddy** o el balanceador de su proveedor. Ejemplo nginx: `proxy_pass http://127.0.0.1:3040` para la ubicación `/api/` (o el dominio solo para API).
6. **Copias de seguridad**: haga backup periódico de `data/gneex-hosted.db` (y del `.env` en lugar seguro).

### 2) Docker / Docker Compose

En la carpeta `gneex-hosted-api`:

```bash
# Cree .env en la misma carpeta que docker-compose.yml con JWT_SECRET=...
docker compose up -d --build
```

El volumen `gneex-api-data` mantiene SQLite entre reinicios. Ajuste `CORS_ORIGIN` en el `.env` que usa Compose.

### 3) Plataformas PaaS (Railway, Render, Fly.io, etc.)

- Debe ofrecer **disco persistente** o volumen montado donde guardar `data/`. Sin eso, cada redespliegue **borra la base**.
- Si solo hay filesystem efímero, esta API **no es adecuada** tal cual; haría falta otra base (PostgreSQL, etc.) o un volumen pagado del proveedor.

### 4) Windows Server / IIS

Puede ejecutar Node como servicio (NSSM, PM2 para Windows) y usar IIS como proxy reverso HTTPS hacia `localhost:3040`, o usar Docker Desktop con el mismo `docker-compose.yml`.

### Comprobar tras desplegar

```bash
curl -s https://su-api.ejemplo.com/api/v1/auth/health
```

Debe devolver JSON con `ok: true`. Luego cree el primer usuario con `POST /api/v1/auth/bootstrap` (solo si la BD está vacía) o use `POST /api/v1/auth/login`.

## Relación con `server/` del repo

La carpeta **`server/`** en la raíz del proyecto es el API **opcional antiguo** (usuarios en JSON). **`gneex-hosted-api`** es el backend **centralizado** nuevo (SQLite + sync + respaldos). No están acoplados; puede convivir en carpetas distintas.
