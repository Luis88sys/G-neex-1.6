# Poner tu backend G-NEEX en Oracle Cloud con Docker Compose

Esta guía es para alguien que **no ha hecho esto nunca**. Vas a tener:

1. Una **máquina virtual** (un ordenador pequeño en internet) en Oracle Cloud, gratis dentro de lo que Oracle llama “Always Free”.
2. **Docker** en esa máquina (una caja donde corre tu programa igual en todos lados).
3. Tu API **`gneex-hosted-api`** funcionando y guardando la base de datos en un **disco que no se borra** al reiniciar.

Lee los pasos **en orden**. Si un paso falla, no sigas: vuelve atrás o mira la sección **Problemas frecuentes** al final.

---

## Índice (sigue este orden)

Usa **Ctrl+F** en el editor y busca el título de cada parte (ej. `Parte 5`).

1. **Antes de empezar** — requisitos personales  
2. **Software, enlaces oficiales y comprobaciones en tu PC** — **léelo antes de Oracle**  
3. **Parte 1** — cuenta Oracle  
4. **Parte 2** — crear la VM  
5. **Parte 3** — reglas de red (Security List)  
6. **Parte 4** — SSH desde Windows  
7. **Parte 5** — Docker en el servidor  
8. **Parte 6** — subir o clonar el código  
9. **Parte 7** — archivo `.env`  
10. **Parte 8** — `docker compose up`  
11. **Parte 9** — primer usuario (`bootstrap`)  
12. **Parte 10** — HTTPS con Caddy  
13. **Partes 11 a 13** — comandos, backups, alertas de facturación  
14. **Lista para tachar** — comprobación final  
15. **Problemas frecuentes**

---

## Antes de empezar (qué necesitas)

- Un **correo electrónico** tuyo.
- Una **tarjeta bancaria**. Oracle la pide al registrarte. Si solo usas recursos **Always Free** y no creas cosas de pago, el coste debería ser **0 €**; aun así conviene activar **alertas de presupuesto** en Oracle (lo verás más abajo).
- Tu ordenador con **Windows** (vale también Mac o Linux).
- Opcional pero muy recomendable: un **dominio** (ej. `api.tudominio.com`) apuntando a la IP de Oracle, para poder usar **HTTPS**. Si aún no tienes dominio, puedes probar primero con la **IP y el puerto 3040** (menos elegante y el navegador avisará si no hay HTTPS).

Tiempo aproximado: **1 a 3 horas** la primera vez (sobre todo Oracle y la red).

---

## Software, enlaces oficiales y comprobaciones en tu PC

Aquí está **todo lo que entra en juego** y **de dónde sale**. No tienes que descargar programas extra en Windows salvo lo que indica Oracle (la clave SSH).

### En tu PC con Windows (no instales Docker Desktop para esta guía)

| Qué | ¿Hay que descargarlo? | Notas |
|-----|------------------------|--------|
| **Navegador** (Edge, Chrome, Firefox) | No (ya lo tienes) | Lo usas para Oracle y para probar la URL del API. |
| **PowerShell** | No | Viene con Windows. Menú Inicio → escribe *PowerShell* → *Windows PowerShell*. |
| **Cliente SSH** (comando `ssh` y `scp`) | A veces hay que activarlo | Mira el bloque **justo debajo**. |
| **Docker Desktop** | **No** | Docker solo se instala **dentro del servidor Ubuntu** en Oracle. |

#### Activar OpenSSH en Windows (para `ssh` y `scp`)

1. Tecla **Windows** → escribe **Características opcionales** o **Optional features** → Ábrelo.  
2. **Ver características** / **View features** (o “Añadir una característica”).  
3. Busca **Cliente OpenSSH** / **OpenSSH Client** → Instalar.  
4. Cierra y vuelve a abrir PowerShell.

Comprueba que funciona:

```powershell
ssh -V
```

Debe aparecer una línea con la versión de OpenSSH. Si dice que no reconoce `ssh`, reinicia el PC o revisa el paso 1–3.

### Enlaces oficiales que usarás en el navegador (Oracle)

| Para qué | Enlace (oficial) |
|----------|------------------|
| Información del **Free Tier** / Always Free | [https://www.oracle.com/cloud/free/](https://www.oracle.com/cloud/free/) |
| **Registro** (alta de cuenta; puede variar según país) | [https://signup.oraclecloud.com/](https://signup.oraclecloud.com/) |
| **Consola** (panel una vez tengas cuenta; inicio de sesión) | [https://cloud.oracle.com/](https://cloud.oracle.com/) |

Si un enlace te redirige a otra página de Oracle, es normal; usa siempre dominios **`oracle.com`**.

### En el servidor Ubuntu (todo esto lo haces **después** de entrar por SSH)

No descargas `.exe` a mano: los comandos de la **Parte 5** y **Parte 10** configuran repositorios y `apt` instala los paquetes.

| Software | Cómo se instala en la guía | Origen técnico (oficial) |
|----------|----------------------------|---------------------------|
| **Docker Engine** + plugin **Compose** | Parte 5 — `curl` del repositorio + `apt install` | Paquetes: [https://download.docker.com/linux/ubuntu](https://download.docker.com/linux/ubuntu) — Guía: [Instalar Docker en Ubuntu](https://docs.docker.com/engine/install/ubuntu/) |
| **Git** | Parte 6 — `sudo apt install git` | Repositorios de Ubuntu. |
| **Caddy** (HTTPS, opcional) | Parte 10 — repositorio Cloudsmith + `apt install` | Documentación: [https://caddyserver.com/docs/install](https://caddyserver.com/docs/install) |
| **Tu API** (`gneex-hosted-api`) | Parte 6 — `git clone` **tu** URL de GitHub/GitLab **o** subir carpeta con `scp` desde el PC | El código es **tu** copia del proyecto (esta carpeta del repo). |

### Imagen Docker del API (se construye sola en el servidor)

La primera vez que ejecutas `docker compose up --build`, Docker **baja** la imagen base oficial **`node:20-alpine`** desde [Docker Hub](https://hub.docker.com/_/node) y compila tu app dentro de la imagen. Necesitas **Internet** en el servidor para eso.

### Resumen en una frase

- **PC:** navegador + PowerShell + OpenSSH (y la **clave .key** que descargas de Oracle al crear la VM).  
- **Servidor:** Ubuntu ya viene en la VM; tú añades Docker, Git, (opcional) Caddy y tu carpeta `gneex-hosted-api` siguiendo las partes de abajo.

---

## Parte 1 — Crear cuenta en Oracle Cloud

1. Abre el navegador y entra en la página de registro (enlace oficial de registro: [https://signup.oraclecloud.com/](https://signup.oraclecloud.com/)). Si prefieres leer antes las condiciones del gratis: [https://www.oracle.com/cloud/free/](https://www.oracle.com/cloud/free/).
2. Rellena tus datos y la tarjeta cuando lo pidan.
3. Cuando termine el registro, entra en la **consola** (panel web): [https://cloud.oracle.com/](https://cloud.oracle.com/).

**Importante:** anota tu **usuario** y **contraseña** de Oracle en un sitio seguro.

---

## Parte 2 — Crear la máquina virtual (instancia)

Vamos a crear un “ordenador” en la nube donde instalar Docker y tu API.

### 2.1 Abrir el asistente

1. En la consola de Oracle, arriba a la izquierda, pulsa el **menú** (tres rayas o “hamburguesa”).
2. Busca **Compute** (Cómputo) y entra en **Instances** (Instancias).
3. Pulsa el botón **Create instance** (Crear instancia).

### 2.2 Nombre

1. En **Name**, pon un nombre que recuerdes, por ejemplo: `gneex-api-server`.

### 2.3 Imagen (sistema operativo)

1. Busca la sección **Image and shape** (Imagen y forma).
2. Pulsa **Change image** si hace falta.
3. Elige **Canonical Ubuntu** (22.04 o 24.04 LTS, 64 bits). Es el sistema más cómodo para seguir esta guía.

### 2.4 Forma (potencia de la máquina) — Always Free

1. Pulsa **Change shape**.
2. Marca la casilla **Show only Always Free shapes** (mostrar solo formas gratuitas).
3. Elige una de estas (la que Oracle te deje crear):
   - **VM.Standard.A1.Flex** (ARM, suele tener más RAM; a veces pone “out of capacity”: prueba otro día, otra “availability domain”, o la otra forma).
   - **VM.Standard.E2.1.Micro** (AMD, más pequeña pero suele estar disponible).

Si no sabes cuál elegir: prueba primero **A1.Flex**; si falla, usa **E2.1.Micro**.

### 2.5 Red (dejar que Oracle cree la red la primera vez)

1. En **Primary VNIC** / **Networking**, suele estar bien **Create new virtual cloud network** (crear red nueva).
2. Deja las opciones por defecto si no sabes qué poner: Oracle creará una **VCN** y una **subnet** (subred).

### 2.6 IP pública (para poder conectar desde tu casa)

1. Busca **Public IPv4 address** o similar.
2. Activa **Assign public IPv4 address** (asignar IP pública).  
   Sin esto no podrás usar `ssh` desde tu PC de forma sencilla.

### 2.7 Llave SSH (la “llave” para entrar sin contraseña de Ubuntu)

1. En **Add SSH keys**, elige **Generate a key pair for me** (generar par de claves) **o** sube tu propia clave pública si ya sabes hacerlo.
2. Si Oracle genera las claves: **descarga el archivo `.private`** y guárdalo en tu PC en una carpeta que no pierdas.  
   En Windows el archivo puede llamarse algo como `ssh-key-2026-....key`.

### 2.8 Crear

1. Revisa que en ningún sitio ponga que vas a usar recursos **de pago** fuera de Always Free (revisa el resumen).
2. Pulsa **Create** (Crear).
3. Espera hasta que el estado pase a **RUNNING** (en ejecución).

### 2.9 Anotar la IP pública

1. En la página de tu instancia, busca **Public IP address** (dirección IP pública).
2. Cópiala y pégala en un bloc de notas. Ejemplo: `129.146.xxx.yyy`.

---

## Parte 3 — Abrir “puertas” en el cortafuegos de Oracle (Security List)

Tu máquina tiene un cortafuegos en la **red de Oracle**. Hay que decirle qué tráfico puede entrar.

1. En el menú de Oracle: **Networking** → **Virtual Cloud Networks**.
2. Entra en la **VCN** que creó el asistente (el nombre parecido al de tu instancia).
3. En el menú izquierdo de la VCN, entra en **Security Lists**.
4. Entra en la **Default Security List** (o la que use tu subnet).
5. Pulsa **Add Ingress Rules** (añadir reglas de entrada).

Crea estas reglas **una por una** (o las que necesites):

| Descripción (opcional) | Source CIDR | IP Protocol | Destination Port Range |
|------------------------|-------------|-------------|-------------------------|
| SSH desde cualquier sitio (luego puedes restringir) | `0.0.0.0/0` | TCP | `22` |
| Pruebas API sin proxy | `0.0.0.0/0` | TCP | `3040` |
| Web HTTP (para Caddy o nginx) | `0.0.0.0/0` | TCP | `80` |
| Web HTTPS | `0.0.0.0/0` | TCP | `443` |

**Seguridad:** cuando todo funcione, puedes cambiar la regla del puerto **22** para que **Source** sea solo la IP de tu casa (más seguro). Mientras aprendes, `0.0.0.0/0` en el 22 es lo habitual (con buena clave SSH).

---

## Parte 4 — Conectar por SSH desde tu PC (Windows)

SSH es “entrar en la consola” de tu máquina Linux en Oracle.

**Antes de nada:** si el comando `ssh` no existe en PowerShell, vuelve a la sección **Software, enlaces oficiales y comprobaciones en tu PC** y activa **OpenSSH Client**.

### 4.1 Abrir PowerShell

1. En Windows, pulsa la tecla **Windows**.
2. Escribe **PowerShell**.
3. Abre **Windows PowerShell**.

### 4.2 Ir a la carpeta de tu llave

1. Si descargaste la clave en `Descargas`, escribe (ajusta el nombre del archivo):

```powershell
cd $env:USERPROFILE\Downloads
```

2. En Windows hace falta proteger el archivo de clave:

```powershell
icacls.exe .\TU_ARCHIVO.key /inheritance:r
icacls.exe .\TU_ARCHIVO.key /grant:r "$($env:USERNAME):(R)"
```

(Cambia `TU_ARCHIVO.key` por el nombre real del archivo que descargaste Oracle.)

### 4.3 Conectar

El usuario en **Ubuntu** de Oracle suele ser **`ubuntu`**. Prueba:

```powershell
ssh -i .\TU_ARCHIVO.key ubuntu@TU_IP_PUBLICA
```

Sustituye `TU_IP_PUBLICA` por la IP que anotaste.

La primera vez puede preguntar **yes/no**: escribe `yes` y Enter.

Si entras y ves una línea tipo `ubuntu@...:~$` **¡bien!** Ya estás dentro del servidor.

**Si no conecta:** revisa Parte 3 (puerto 22), que la instancia esté **RUNNING**, y que la IP sea la **pública**.

---

## Parte 5 — Instalar Docker y Docker Compose en Ubuntu

Ya dentro del servidor por SSH, copia y pega **bloque a bloque** (Enter al final de cada bloque).

### 5.1 Actualizar el sistema

```bash
sudo apt update
sudo apt upgrade -y
```

### 5.2 Instalar Docker (método oficial resumido)

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION_ID}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 5.3 Permitir usar Docker sin ser root (opcional pero cómodo)

```bash
sudo usermod -aG docker $USER
```

Cierra la sesión SSH y vuelve a entrar (`exit` y otra vez `ssh ...`). Así el grupo `docker` se aplica.

### 5.4 Comprobar

```bash
docker run --rm hello-world
```

Si ves un mensaje de “Hello from Docker!”, Docker funciona.

---

## Parte 6 — Bajar tu proyecto `gneex-hosted-api` al servidor

Tienes dos caminos. Usa **A** si tu código está en GitHub/GitLab. Usa **B** si no quieres usar git.

### Opción A — Con Git (recomendado)

1. En el servidor:

```bash
cd ~
sudo apt install -y git
```

2. Clona **tu** repositorio (cambia la URL por la tuya):

```bash
git clone https://github.com/TU_USUARIO/TU_REPO.git
cd TU_REPO/gneex-hosted-api
```

Si tu repo no tiene la carpeta `gneex-hosted-api` dentro, entra solo hasta donde esté esa carpeta y haz `cd gneex-hosted-api`.

### Opción B — Subir la carpeta desde tu PC con SCP

1. En **tu PC** (PowerShell), estando en la carpeta que **contiene** `gneex-hosted-api`:

```powershell
scp -i ruta\TU_ARCHIVO.key -r .\gneex-hosted-api ubuntu@TU_IP_PUBLICA:~/
```

2. Vuelve al **SSH** del servidor:

```bash
cd ~/gneex-hosted-api
```

---

## Parte 7 — Crear el archivo `.env` (secretos y opciones)

1. En el servidor, dentro de `gneex-hosted-api`:

```bash
cd ~/gneex-hosted-api
cp .env.example .env
nano .env
```

2. Con el teclado, edita estas líneas:

- **`JWT_SECRET`**: borra el valor de ejemplo y pon **una cadena larga y aleatoria** (mínimo 32 caracteres mezclando letras y números). Nadie debe verla.
- **`CORS_ORIGIN`**: pon la URL **exacta** de tu app en Vercel, por ejemplo `https://tu-proyecto.vercel.app` (sin barra final). Si tienes dominio propio para el front, usa esa URL.

Ejemplo (los valores son inventados; tú pones los tuyos):

```env
PORT=3040
JWT_SECRET=pon_aqui_una_cadena_muy_larga_y_unica_sin_espacios
JWT_EXPIRES_DAYS=7
CORS_ORIGIN=https://mi-app.vercel.app
SYNC_WRITE_ROLE=admin
JSON_LIMIT=80mb
```

3. Guardar en **nano**: `Ctrl+O`, Enter, salir: `Ctrl+X`.

---

## Parte 8 — Arrancar con Docker Compose

1. En el servidor, en la carpeta donde está `docker-compose.yml`:

```bash
cd ~/gneex-hosted-api
docker compose up -d --build
```

2. Espera a que termine de construir la imagen (la primera vez tarda varios minutos).

3. Prueba el “latido” del API **desde el servidor**:

```bash
curl -s http://127.0.0.1:3040/api/v1/auth/health
```

Deberías ver algo con `"ok":true` (o similar en JSON).

4. Prueba **desde tu PC** (navegador o PowerShell):

En el navegador abre (cambia la IP):

`http://TU_IP_PUBLICA:3040/api/v1/auth/health`

En **PowerShell** en tu PC también puedes probar:

```powershell
curl.exe -s "http://TU_IP_PUBLICA:3040/api/v1/auth/health"
```

Si no carga: revisa la regla de Oracle para el puerto **3040** (Parte 3).

---

## Parte 9 — Crear el primer usuario del API (solo si la base está vacía)

Esto solo funciona **la primera vez**, cuando aún no hay usuarios.

En el **servidor** (o en tu PC cambiando localhost por la IP):

```bash
curl -s -X POST http://127.0.0.1:3040/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@example.com","password":"TU_CLAVE_SEGURA","displayName":"Admin","role":"admin"}'
```

Cambia `TU_CLAVE_SEGURA` por una contraseña fuerte. Guarda usuario y contraseña en un sitio seguro.

---

## Parte 10 — HTTPS con dominio (recomendado): Caddy

Sin dominio propio, Let’s Encrypt no puede emitir un certificado fácil para “solo IP”. Lo normal es:

1. Comprar o usar un dominio.
2. En el DNS del dominio, crear un registro tipo **A** que apunte a la **IP pública** de Oracle. Ejemplo: `api.tudominio.com` → `129.146.xxx.yyy`.

Luego en el servidor:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Edita la configuración de Caddy:

```bash
sudo nano /etc/caddy/Caddyfile
```

Deja algo así (cambia `api.tudominio.com` por tu subdominio real):

```text
api.tudominio.com {
    reverse_proxy 127.0.0.1:3040
}
```

Reinicia Caddy:

```bash
sudo systemctl enable --now caddy
sudo systemctl reload caddy
```

Caddy pedirá certificados automáticamente. Prueba en el navegador:

`https://api.tudominio.com/api/v1/auth/health`

Cuando HTTPS funcione, en **`.env`** puedes dejar `CORS_ORIGIN` apuntando solo al front en Vercel (el front no tiene por qué estar en el mismo dominio que el API).

**Puertos 80 y 443** deben estar abiertos en Oracle (Parte 3).

---

## Parte 11 — Comandos que usarás mucho

Dentro de `~/gneex-hosted-api`:

| Qué quieres | Comando |
|-------------|---------|
| Ver si el contenedor corre | `docker compose ps` |
| Ver logs (mensajes del programa) | `docker compose logs -f api` |
| Reiniciar después de cambiar `.env` | `docker compose up -d` |
| Parar todo | `docker compose down` |
| Parar sin borrar datos | `docker compose down` (el volumen `gneex-api-data` **sigue**; no uses `down -v` salvo que quieras **borrar la base**) |

---

## Parte 12 — Copia de seguridad del SQLite (importante)

Los datos viven en el **volumen Docker** `gneex-api-data`, dentro del archivo `gneex-hosted.db`.

### Copia rápida dentro del contenedor

```bash
cd ~/gneex-hosted-api
BACKUP=respaldo-$(date +%F).db
docker compose exec api sqlite3 /app/data/gneex-hosted.db ".backup /app/data/$BACKUP"
docker compose cp api:/app/data/$BACKUP .
```

El archivo `.db` quedará en `gneex-hosted-api` en el servidor; bájalo a tu PC con **scp** desde Windows cuando quieras.

La imagen Docker del proyecto incluye el programa de línea **`sqlite3`** para que este comando funcione. Si usas una imagen antigua construida antes de ese cambio, ejecuta otra vez `docker compose up -d --build` para reconstruir.

Para **bajar la copia a tu PC** (PowerShell, estando en la carpeta donde quieras guardar el archivo; cambia rutas e IP):

```powershell
scp -i ruta\TU_ARCHIVO.key ubuntu@TU_IP_PUBLICA:~/gneex-hosted-api/respaldo-AAAA-MM-DD.db .
```

(Sustituye `respaldo-AAAA-MM-DD.db` por el nombre real del fichero que creaste en el servidor.)

---

## Parte 13 — Alertas en Oracle (para no llevar sustos de factura)

1. En la consola Oracle: menú → **Billing** / **Cost Management** → **Budgets**.
2. Crea un presupuesto con alerta por correo (por ejemplo si supera 1 € o 10 €).

Si **solo** usas Always Free y no creas recursos de pago, no deberías pagar; la alerta es por tranquilidad.

---

## Lista para tachar (cuando termines)

Copia esta lista en un papel o táchala en el editor. Objetivo: saber que no te falta un paso grande.

- [ ] Cuenta Oracle creada y acceso a la consola [cloud.oracle.com](https://cloud.oracle.com/) guardado  
- [ ] VM Ubuntu en estado **RUNNING** con **IP pública** anotada  
- [ ] Archivo **`.key`** de SSH descargado y permisos aplicados con `icacls` (Windows)  
- [ ] Reglas de entrada Oracle: **22**, **3040**, y si usarás HTTPS también **80** y **443**  
- [ ] Entras por SSH desde PowerShell (`ubuntu@IP`)  
- [ ] `docker run hello-world` funciona en el servidor  
- [ ] Carpeta `gneex-hosted-api` en el servidor con **`.env`** (al menos `JWT_SECRET` y `CORS_ORIGIN`)  
- [ ] `docker compose up -d --build` sin error y `docker compose ps` muestra **Up**  
- [ ] `curl` a `/api/v1/auth/health` responde **ok** (desde servidor o desde tu PC con la IP)  
- [ ] Usuario admin creado con **bootstrap** (solo la primera vez)  
- [ ] (Opcional) Dominio con DNS tipo **A** → IP de Oracle  
- [ ] (Opcional) **Caddy** instalado y `https://api.tudominio.com/.../health` funciona  
- [ ] (Opcional) Monitor gratuito (ej. UptimeRobot) pegando a la URL del **health**  
- [ ] (Recomendado) **Presupuesto/alerta** de facturación en Oracle  
- [ ] Sabes cómo hacer una **copia del .db** (Parte 12) y dónde la guardas  

---

## Problemas frecuentes

**PowerShell dice que no reconoce `ssh` o `scp`.**  
Instala **Cliente OpenSSH** (Características opcionales de Windows), cierra PowerShell, vuelve a abrirlo y prueba `ssh -V`. Ver la sección **Software, enlaces oficiales y comprobaciones en tu PC**.

**No puedo entrar por SSH.**  
Comprueba: instancia **RUNNING**, IP **pública**, regla **TCP 22**, archivo de clave correcto y permisos en Windows (`icacls`).

**El navegador no abre `http://IP:3040`.**  
Comprueba regla **TCP 3040** en la Security List y que `docker compose ps` muestre el servicio **Up**.

**`docker compose up` falla al compilar.**  
Espera a que termine el mensaje de error. A veces falta RAM en máquinas muy pequeñas: prueba una forma con más memoria o cierra otros procesos y vuelve a `docker compose build`.

**Creé la VM ARM (A1) y algo raro falla en Docker.**  
La mayoría de veces funciona igual. Si el error habla de arquitectura, copia el mensaje y búscalo en internet o pregunta en foros con el texto exacto.

**Oracle dice “out of host capacity”.**  
Es falta de hueco en esa región/tipo de máquina. Prueba otro día, otra **Availability Domain**, o usa **E2.1.Micro**, o otra región si tu cuenta lo permite.

---

## Qué has conseguido al terminar

- Tu API corre en un contenedor Docker.
- La base **SQLite** se guarda en un volumen que **persiste** al reiniciar la máquina o el contenedor.
- Puedes poner delante **HTTPS** con Caddy y un dominio.
- Tu app en **Vercel** puede (cuando la conectes en el código) llamar a esta API usando la URL pública y `CORS_ORIGIN` bien puesto.

---

## Documentación oficial del propio proyecto

- `gneex-hosted-api/README.md` — variables de entorno, endpoints y seguridad.

Si algo de esta guía no coincide con los menús de Oracle (cambian a veces los nombres), busca en la consola las palabras clave: **Instances**, **VCN**, **Security List**, **Ingress Rules**, **Public IP**.
