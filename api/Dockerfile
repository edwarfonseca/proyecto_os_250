# ---------- Etapa 1: dependencias de producción ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---------- Etapa 2: imagen final (sin npm cache ni herramientas de build) ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# /data es donde se monta el volumen "files"; pertenece al usuario sin privilegios.
RUN mkdir -p /data && chown node:node /data
# El código queda como propiedad de root: el proceso (usuario node) no puede modificarlo.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/app.js"]
