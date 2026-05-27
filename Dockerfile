# Utilizamos node:22-alpine que soporta la flag --experimental-strip-types
FROM node:22-alpine AS builder

WORKDIR /app

# Instalar todas las dependencias
COPY package*.json ./
RUN apk add --no-cache python3 make g++
RUN npm ci

# Copiar el código fuente y compilar (frontend Vite)
COPY . .
RUN npm run build

# Imagen de producción
FROM node:22-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app

# Establecer entorno de producción
ENV NODE_ENV=production
ENV PORT=3000

# Copiar package.json y package-lock.json
COPY --from=builder /app/package*.json ./

# Copiamos node_modules para que server.ts pueda arrancar sin problemas (incluye vite que es dinámico/estático dependiendo del entorno)
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev

# Copiar el build de frontend
COPY --from=builder /app/dist ./dist

# Copiar nuestro backend
COPY --from=builder /app/server.ts ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Iniciar servidor con flags nativas de Typescript de NodeJS 22+
CMD ["npm", "start"]
