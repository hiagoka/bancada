# syntax=docker/dockerfile:1
# Loja e admin da Bancada: build do Vite servido por nginx (sem Node em produção).
# O contexto de build é a RAIZ do repositório (npm workspaces):
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=http://localhost:3333 -t bancada-web .
# VITE_API_URL é lida pelo Vite no BUILD e vira parte do bundle: é o endereço da API que o NAVEGADOR
# usa. Para outra URL, refaça a imagem (não dá para trocar com uma variável em runtime).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web

ARG VITE_API_URL=http://localhost:3333
ENV VITE_API_URL=${VITE_API_URL}
# contracts primeiro (o tsc -b do web resolve @bancada/contracts pelo dist).
RUN npm run build -w @bancada/contracts && npm run build -w @bancada/web

# nginx sem root (escuta na 8080 e não precisa de privilégios).
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/nginx-security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
