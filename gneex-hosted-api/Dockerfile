# Build for linux/amd64 in production if you deploy to x64 servers:
#   docker build --platform linux/amd64 -t gneex-hosted-api .
FROM node:20-alpine

# sqlite: CLI para copias .backup desde el contenedor (ver docs/DESPLEGUE_ORACLE_DOCKER_ES.md)
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3040

# SQLite y respaldos: monte un volumen en /app/data
RUN mkdir -p /app/data

EXPOSE 3040

CMD ["node", "src/index.js"]
