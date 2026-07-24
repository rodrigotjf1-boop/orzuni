# Orzuni API (NestJS) — build a partir da subpasta backend/.
# Contexto de build = raiz do repo; este Dockerfile cuida de entrar em backend/.

# 1) build: instala tudo (inclui devDeps) e compila o TypeScript
FROM node:22-slim AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# 2) runtime: só dependências de produção + o dist compilado
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3100
CMD ["node", "dist/main.js"]
