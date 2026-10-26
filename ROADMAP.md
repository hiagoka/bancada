# Bancada — ROADMAP

Uma tarefa por vez (api e web podem andar em paralelo quando não dependem uma da outra). Só marcar como concluída depois de verificar os critérios de aceite. Fonte da verdade: [ARCHITECTURE.md](ARCHITECTURE.md).

## Fase 0 · Fundação
- [ ] **T01** [org] Monorepo: workspaces, tsconfig.base.json, ESLint + Prettier, .gitignore, docker-compose com db, minio e minio-init. Aceite: npm install na raiz, docker compose up sobe banco e MinIO com bucket criado, lint passa.
- [ ] **T02** [api] packages/contracts com todos os schemas da seção 4 (inclui publicOrderSchema e os ErrorCodes ORDER_NOT_CANCELLABLE e CSRF_REJECTED). Aceite: importável nos dois apps, com teste unitário.
- [ ] **T03** [git] CI no GitHub Actions com Postgres como service: lint, typecheck, testes e build.

## Fase 1 · API base
- [ ] **T04** [api] Esqueleto: env, pool, errors, http, createApp, server, /health. Aceite: /health 200; env inválida derruba o processo com mensagem clara.
- [ ] **T05** [api] Migração 001 completa (seção 6), runner de migrações, stock.repository (applyStockMovement), seed e setup de testes. Aceite: migrate idempotente; seed gera movimentos 'initial'; build copia os .sql sem comandos Unix.
- [ ] **T06** [api] Produtos públicos: GET /products e /products/:id com imageUrl. Aceite: testes de listagem, inativo e 404.

## Fase 2 · Pedidos e pagamento
- [ ] **T07** [api] Criar pedido (fluxo 8.1, sem gateway ainda) e GET /orders/:id público (publicOrderSchema). Aceite: testes de pedido, idempotência, estoque, movimentos, concorrência e "resposta pública não contém customer".
- [ ] **T08** [api] Gateway de pagamento (8.4), checkout fora da transação, Preference com expires: true e expiration_date_to = agora + 30 min. Aceite: teste de falha seguida de retry; teste da expiração da Preference.
- [ ] **T09** [api] Webhook, máquina de estados e /dev/payments/simulate. Aceite: todos os testes de webhook.

## Fase 3 · Administração (API)
- [ ] **T10** [api] Autenticação (8.5): login, logout, me, requireAdmin, rate limit, proteção CSRF (requireCsrfHeader, D15), script create-admin. Aceite: testes de auth e "POST em rota admin com cookie válido e sem o header dá 403".
- [ ] **T11** [api] Produtos e estoque do admin (8.6) + lista de pedidos + POST /admin/orders/:id/cancel (8.8). Aceite: testes de produto, slug, ajuste, desativação, imageKey (ausente/null/string), concorrência admin x pedidos, cancelamento (antes de 30 min: 409; depois: cancela e devolve estoque; PAID: 409) e estorno sem mexer no estoque.
- [ ] **T12** [api] StorageService + rota de upload (8.7). Aceite: testes de upload; upload real funcionando no MinIO local.

## Fase 4 · Loja (web)
- [ ] **T13** [web] Esqueleto: Vite, router, QueryClient, Layout, tokens.css, cliente http com credentials, header X-Requested-With: bancada-web e ApiError.
- [ ] **T14** [web] Catálogo e carrinho (Zustand + persist), com ProductImage. Aceite: respeita o estoque, sobrevive ao F5, sem rolagem horizontal em 360px.
- [ ] **T15** [web] Checkout com RHF + contracts e Idempotency-Key estável. Aceite: duplo clique gera um pedido só; ao dar certo, limpa o carrinho e redireciona.
- [ ] **T16** [web] Página do pedido com polling e checkout simulado. Aceite: fluxo completo catálogo -> carrinho -> simulado -> pedido pago.

## Fase 5 · Administração (web)
- [ ] **T17** [web] Login, RequireAdmin e AdminLayout. Aceite: sem login redireciona; depois do login volta à página pedida; "Sair" limpa a sessão.
- [ ] **T18** [web] Lista, criação e edição de produtos com upload de imagem. Aceite: produto criado no admin aparece na loja com a imagem.
- [ ] **T19** [web] Painel de estoque (ajuste + histórico) e lista de pedidos com botão "Cancelar pedido" (só quando cancellable). Aceite: ajuste reflete na loja; pedido pago aparece com status correto; cancelar pedido abandonado devolve o estoque na loja.

## Fase 6 · Entrega
- [ ] **T20** [api] Docker completo: Dockerfiles da API e do web, compose com db, minio, minio-init, api e web. Aceite: docker compose up --build deixa loja e admin funcionando.
- [ ] **T21** [org] README com prints, diagrama Mermaid dos fluxos de pagamento e estoque, decisões, como criar o admin, modo fake e modo Mercado Pago (com ngrok), tabela de endpoints, e seção "Próximos passos" (expiração automática de pedidos por job, limpeza de imagens órfãs no S3).
- [ ] **T22** [org + api] Teste com o Mercado Pago real (credenciais de teste + túnel + webhook cadastrado no painel).
- [ ] **T23** [org] Deploy: API na AWS (App Runner ou ECS + RDS + S3) e web na Vercel. Links no README.
