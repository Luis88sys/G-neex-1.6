# Servidor API G-NEEX (Node.js)

Backend **opcional**: primer usuario (`register-bootstrap`), **login** contra `server/data/users.json` con el mismo esquema de hash que el cliente (`g-neex-v1|salt|password` → SHA-256).

La SPA usa **localStorage** para inventario y datos de trabajo; este API **no** sustituye eso por sí solo. En la pantalla de acceso, si olvidó la contraseña, la interfaz indica **contactar al administrador Luis Goire**.

## Requisitos

- Node.js 18+

## Instalación

```bash
cd server
npm install
copy .env.example .env
```

Edite `.env` si necesita `CORS_ORIGIN` (API y web en distintos dominios).

## Arranque (sirve API + archivos estáticos del repo)

Desde la carpeta `server/`:

```bash
npm start
```

Abra `http://localhost:3000/` — misma máquina sirve `index.html` y `/api/auth/*`.

## Primera cuenta en el servidor

Solo cuando `data/users.json` **no existe** o está vacío `[]`:

```bash
curl -X POST http://localhost:3000/api/auth/register-bootstrap ^
  -H "Content-Type: application/json" ^
  -d "{\"username\":\"admin\",\"email\":\"usted@dominio.com\",\"password\":\"SuClaveSegura\",\"displayName\":\"Admin\",\"role\":\"admin\"}"
```

El campo **email** es obligatorio en el bootstrap (formato válido); puede usarse más adelante si integra notificaciones propias.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/auth/health` | Estado |
| POST | `/api/auth/register-bootstrap` | Solo si no hay usuarios |
| POST | `/api/auth/login` | Comprueba usuario/contraseña en el servidor |

## Datos

- `server/data/users.json` — usuarios (no versionar en git si contiene datos reales).

## Despliegue en un hosting

### Solo la app G-NEEX (archivos estáticos)

Cualquier hosting estático sirve la SPA; **HTTPS** recomendado para el inicio de sesión en el navegador.

### Esta API en producción

Necesita **Node.js** y **persistencia** de `server/data/users.json` (volumen o disco). Configure `PORT` y, si aplica, `CORS_ORIGIN`.

## Relación con la cuenta del navegador

El login del servidor y el login por **localStorage** en la SPA son **independientes** hasta que integre la SPA con este API de forma explícita.
