# ---------- Etapa 1: dependencias de producción ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------- Etapa 2: imagen final ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
# El worker no abre ningún puerto: solo habla con PostgreSQL y con el volumen.
CMD ["node", "src/index.js"]
