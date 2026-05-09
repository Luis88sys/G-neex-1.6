# Alineación cliente ↔ backend alojado (`gneex-hosted-api`)

La SPA en la raíz del repositorio **sigue siendo 100 % navegador** (`localStorage`). El backend en `gneex-hosted-api/` está pensado para un despliegue futuro con los mismos datos y reglas de seguridad.

## Hash de contraseña

- Cliente y API usan el mismo esquema documentado en `gneex-hosted-api/README.md`: cadena `g-neex-v1|salt|password` y SHA-256 (hex).
- Al migrar usuarios, los objetos en `phoenix-users` (o el almacén equivalente en SQLite) deben conservar `salt` y hash compatibles.

## Forma de datos

- El JSON de respaldo exportado por la app (`format: G-NEEX-backup`) y el campo `data` del API comparten la idea de **mapa clave → string JSON** (como en `localStorage`).
- Endpoints relevantes: `GET/PATCH /api/v1/sync`, `PUT /api/v1/sync/full`, import/export de respaldo (ver README del API).

## Brecha actual

- No hay llamadas HTTP desde `js/` hacia esta API todavía.
- Conectar la SPA implica un cliente de sync (token JWT, fusión de revisiones, manejo offline) y políticas `SYNC_WRITE_ROLE` acordes al negocio.
- En cliente existe el namespace **`GneexApiClient`** (`js/api-client.js`): solo conserva opcionalmente la URL base en `localStorage` (`gneex-api-base-url`) y lanza si se invoca `fetchSync` sin implementar; sirve como anclaje para el futuro cliente HTTP sin activar red hoy.

## Permisos en cliente vs servidor

- La matriz `permissionMatrix` / `permissionActionMatrix` y las claves `cfg*` / `ord*` son **solo aplicadas en el navegador** hoy.
- En un modelo online, el servidor debe volver a autorizar cada escritura (no confiar solo en el cliente).

## Plantillas de usuario (`templateKey`)

- En cliente, al crear o actualizar un usuario no administrador, el campo lógico **plantilla** (`templateKey` en flujos futuros) debe resolverse contra la misma tabla que `Auth._buildUserTemplatePayload()` en `js/auth.js`: claves genéricas (`operario_*`, `supervisor`) y claves **perfil integrado** (`perfil_keith_lake`, `perfil_alex_beaulieu`, `perfil_guest_demo`, `perfil_patrick`, `perfil_stephane_demers`, `perfil_wen_deng`, `perfil_barbara_bonny`, `perfil_annie_larose`), delegando en los payloads builtin documentados en ese archivo.
- El archivo exportable `PlantillasPermisos.xlsx.csv` en la raíz del repo resume objetivos y restricciones por clave; debe mantenerse alineado cuando cambien las matrices.
- Cuentas con rol **administrador** no usan plantilla de matriz: el API debe aceptar rol `admin` sin `templateKey` o ignorarlo.
