# syntax=docker/dockerfile:1
# API da Bancada. O contexto de build é a RAIZ do repositório (npm workspaces):
#   docker build -f apps/api/Dockerfile -t bancada-api .
# Duas etapas: "build" compila contracts e API com todas as dependências; "runtime" instala SÓ as
# dependências de produção da API e copia apenas o código compilado (inclui os .sql das migrações,
# que o script de build copia para dist/db/migrations).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app

# Só os manifestos primeiro: a camada do npm ci só é refeita quando as dependências mudam.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
# contracts ANTES da API (a API importa @bancada/contracts, que aponta para o dist dele).
# O postbuild da API confere que migrações e scripts compilados existem.
RUN npm run build -w @bancada/contracts && npm run build -w @bancada/api

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# O package-lock é o do monorepo inteiro: os manifestos de todos os workspaces precisam estar
# presentes para o npm ci aceitá-lo, mas -w @bancada/api instala só o que a API usa em produção
# (nada de React, Vite, TypeScript, Jest...).
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev -w @bancada/api

COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/docker-entrypoint.sh apps/api/docker-entrypoint.sh

# Usuário sem privilégios (já existe na imagem oficial do Node).
USER node
WORKDIR /app/apps/api
EXPOSE 3333

# Migra, semeia se SEED_ON_START=true e sobe o servidor (ver docker-entrypoint.sh).
# Rodado com `sh` para não depender do bit de execução do arquivo.
CMD ["sh", "docker-entrypoint.sh"]
