# Bancada — ARCHITECTURE.md

Vamos construir o projeto "Bancada": um e-commerce full stack de equipamentos para a mesa de trabalho de devs (teclados, mouses, headsets, suportes, hubs, canecas). É um projeto de portfólio para vagas full stack, e o foco é o FLUXO DE PAGAMENTO e o CONTROLE DE ESTOQUE feitos do jeito certo: pedidos idempotentes, estoque sem venda dupla sob concorrência, estoque auditável, webhooks do Mercado Pago validados e processados uma única vez, e máquina de estados do pedido. A loja tem uma área administrativa para cadastrar produtos e controlar o estoque.

PRIMEIRA AÇÃO: salve este prompt inteiro em ARCHITECTURE.md na raiz do repositório (e a seção 15 também em ROADMAP.md, com checkboxes). Esse arquivo é a fonte da verdade; todo agente deve lê-lo antes de qualquer tarefa. Se uma tarefa contradisser este documento, pare e pergunte em vez de improvisar.

========================================
1. ESCOPO
========================================
Loja (cliente, sem login): catálogo, carrinho, checkout com Mercado Pago (Checkout Pro), página de acompanhamento do pedido, modo de pagamento simulado.
Administração (com login): cadastro e edição de produtos com upload de imagem, ativar/desativar produto, ajuste de estoque com histórico, lista de pedidos.
Infra: testes, Docker e CI.
Fora do escopo (não implementar sem pedido explícito): login de cliente, cupons, frete, e-mails, expiração automática de pedidos por job (o cancelamento MANUAL pelo admin existe, ver 8.8), apagar imagens antigas do S3, busca na loja, múltiplos níveis de permissão de admin.

========================================
2. ESTRUTURA (monorepo com npm workspaces)
========================================
bancada/
  apps/api/             Express + TypeScript + PostgreSQL
  apps/web/             React + Vite (loja + admin)
  packages/contracts/   schemas Zod e tipos compartilhados entre API e web
  docker-compose.yml
  ARCHITECTURE.md, ROADMAP.md, CLAUDE.md

Regra de dependência: api e web podem importar contracts. contracts não importa nada dos apps. api e web nunca importam um do outro.

========================================
3. STACK
========================================
- Node 22, TypeScript 5.9 strict (não usar TS 7, incompatível com ts-jest)
- API: Express 5, Zod 4, Pino (logs), pg (SQL puro, SEM ORM)
- Banco: PostgreSQL 16, migrações .sql versionadas com runner próprio
- Pagamento: SDK oficial "mercadopago" (Preference, Payment, WebhookSignatureValidator)
- Autenticação: bcryptjs (não bcrypt nem argon2, para funcionar no Windows sem compilação nativa), jsonwebtoken, cookie-parser, express-rate-limit
- Imagens: S3 (@aws-sdk/client-s3 + @aws-sdk/s3-presigned-post); MinIO localmente
- Testes da API: Jest 30 + ts-jest + Supertest, contra um Postgres real
- Web: React 19, Vite, React Router 7, TanStack Query 5, Zustand 5, React Hook Form 7 + @hookform/resolvers + Zod
- Qualidade: ESLint (typescript-eslint) + Prettier na raiz
- Infra: Docker Compose e GitHub Actions

========================================
4. packages/contracts
========================================
Arquivos:
  product.ts   productSchema (público), adminProductSchema, adminProductInputSchema, adminProductUpdateSchema
  stock.ts     stockAdjustmentSchema, stockMovementSchema
  order.ts     orderStatusSchema, createOrderInputSchema, publicOrderSchema (resposta pública, SEM dados do cliente), orderSchema (completo, só admin)
  auth.ts      loginInputSchema, adminSchema
  upload.ts    uploadRequestSchema, uploadResponseSchema
  payment.ts   simulatePaymentInputSchema e statuses de pagamento do MP (usado por /dev/payments/simulate)
  errors.ts    apiErrorSchema, enum ErrorCode
  index.ts
Regras:
- A API valida o req.body com esses schemas; o web usa os MESMOS schemas no zodResolver dos formulários.
- Tipos sempre via z.infer; nunca redeclarar Product, Order etc.
- Envelope de resposta: sucesso { "data": ... }; erro { "error": { "code", "message", "details?" } }.
- ErrorCode (lista fechada): VALIDATION_ERROR, NOT_FOUND, OUT_OF_STOCK, PRODUCT_UNAVAILABLE, IDEMPOTENCY_KEY_REUSED, CHECKOUT_UNAVAILABLE, INVALID_SIGNATURE, INVALID_JSON, UNAUTHORIZED, INVALID_CREDENTIALS, RATE_LIMITED, SLUG_TAKEN, INVALID_STOCK_ADJUSTMENT, INVALID_FILE_TYPE, ORDER_NOT_CANCELLABLE, CSRF_REJECTED, INTERNAL_ERROR.
- Mensagens de validação em PT-BR.

========================================
5. BACK-END (apps/api)
========================================
Pastas:
  src/config/env.ts           valida process.env com Zod e falha cedo
  src/db/pool.ts              createPool() e withTransaction(pool, fn)
  src/db/migrate.ts           aplica migrations/*.sql em ordem (tabela schema_migrations)
  src/db/seed.ts              6 produtos de exemplo via applyStockMovement 'initial' (cria só o que falta por slug e nunca sobrescreve produto existente, D17; um deles com estoque 3)
  src/db/migrations/001_init.sql
  src/modules/products/       products.routes.ts (público), products.repository.ts
  src/modules/stock/          stock.repository.ts (applyStockMovement, listMovements)
  src/modules/orders/         orders.routes.ts, orders.service.ts, orders.repository.ts, order-status.ts
  src/modules/payments/       payment-gateway.ts, mercadopago.gateway.ts, fake.gateway.ts, payment-webhook.service.ts, payments.routes.ts
  src/modules/auth/           auth.routes.ts, auth.service.ts, admins.repository.ts, require-admin.ts
  src/modules/admin/          admin-products.routes.ts, admin-products.service.ts, admin-orders.routes.ts, uploads.routes.ts
  src/modules/storage/        storage.service.ts (interface), s3.storage.ts, fake.storage.ts
  src/shared/                 errors.ts (AppError), http.ts (validateBody, errorHandler), slug.ts, csrf.ts (requireCsrfHeader)
  src/scripts/create-admin.ts
  src/app.ts                  createApp(deps): monta middlewares e rotas
  src/server.ts               lê env, cria dependências, listen() e encerramento limpo

Camadas: routes -> service -> repository -> PostgreSQL; services também usam as interfaces PaymentGateway e StorageService.
- routes: validam a entrada (Zod), chamam o service, escolhem o status HTTP. Sem regra de negócio, sem SQL.
- service: regras de negócio, transações, chama repositories, gateway e storage. Não conhece req/res.
- repository: SQL parametrizado ($1), mapeamento snake_case <-> camelCase. Sem regra de negócio. Recebe Db = Pool | PoolClient.
- Injeção de dependências: createApp({ pool, gateway, storage, logger, webUrl, webhookSecret, jwtSecret, cookieSameSite }). Sem singletons globais. Testes usam FakePaymentGateway e FakeStorageService.
- Erros: lançar AppError(status, code, message, details?). O errorHandler converte ZodError, AppError e erros inesperados (500 + log).
- Dinheiro SEMPRE em centavos (INTEGER). Converter para reais só ao montar a preferência do Mercado Pago e ao exibir no web.
- O script de build copia os .sql para dist usando Node (fs.cpSync), não comandos Unix (o projeto precisa rodar no Windows).

Variáveis de ambiente:
  DATABASE_URL (obrigatória), TEST_DATABASE_URL (padrão .../bancada_test), PORT (3333)
  WEB_URL (http://localhost:5173), API_PUBLIC_URL (http://localhost:3333)
  PAYMENT_PROVIDER ("fake" | "mercadopago", padrão fake), MP_ACCESS_TOKEN e MP_WEBHOOK_SECRET (obrigatórias com mercadopago)
  JWT_SECRET (obrigatória, mínimo 32 caracteres), COOKIE_SAMESITE (lax | none, padrão lax)
  S3_ENDPOINT (vazio na AWS; http://localhost:9000 no MinIO), S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_URL, S3_FORCE_PATH_STYLE (true no MinIO)

========================================
6. MODELO DE DADOS (migração 001_init.sql)
========================================
products: id uuid PK, slug UNIQUE, name, description, category, price_cents INT > 0, stock INT >= 0, active BOOLEAN DEFAULT true, image_key TEXT NULL, created_at, updated_at

admins: id uuid PK, email UNIQUE (salvo em minúsculo), password_hash, name, created_at

orders: id uuid PK, idempotency_key UNIQUE, request_hash, customer_name, customer_email, status order_status DEFAULT 'PENDING', total_cents INT > 0, payment_provider, checkout_id, checkout_url, payment_id, paid_at, created_at, updated_at
  índices: (status), (created_at DESC)
  payment_id = o ÚLTIMO pagamento que mudou o status do pedido; o histórico completo está em payment_events.
  O status de um pedido só muda por DOIS caminhos: o webhook (via external_reference) e o cancelamento manual do admin (8.8). Nenhum outro.

order_items: id bigserial PK, order_id FK -> orders ON DELETE CASCADE, product_id FK -> products, product_name, unit_price_cents, quantity > 0  (snapshot do momento da compra)

stock_movements: id bigserial PK, product_id FK -> products, delta INT <> 0,
  reason TEXT CHECK (reason IN ('initial','restock','adjustment','order','order_cancelled')),
  order_id FK -> orders NULL, admin_id FK -> admins NULL, note TEXT NULL, stock_after INT NOT NULL, created_at
  índice: (product_id, created_at DESC)

payment_events: id bigserial PK, provider, payment_id, status, order_id FK NULL, amount_cents, outcome, received_at, UNIQUE (provider, payment_id, status)  (deduplica webhooks)

order_status = ENUM ('PENDING', 'PAID', 'CANCELLED', 'REFUNDED')

Regras do estoque:
- TODA mudança de estoque passa por applyStockMovement(db, { productId, delta, reason, orderId?, adminId?, note? }), que faz UPDATE products SET stock = stock + delta ... RETURNING stock e insere o movimento com stock_after, na mesma transação. Ninguém faz UPDATE em products.stock diretamente.
- A constraint stock >= 0 é a última barreira.
- O estoque atual deve sempre ser igual à soma dos deltas dos movimentos do produto.
- Produtos NUNCA são apagados, só desativados (order_items aponta para eles).

========================================
7. ENDPOINTS
========================================
Públicos:
  GET  /health                  200 (500 se o banco cair)
  GET  /products                200 (só ativos)
  GET  /products/:id            200 | 404 (inclusive inativo ou id que não é UUID)
  POST /orders                  cabeçalho Idempotency-Key obrigatório. 201 criado | 200 replay | 400 | 409 OUT_OF_STOCK | 409 IDEMPOTENCY_KEY_REUSED | 422 PRODUCT_UNAVAILABLE | 502 CHECKOUT_UNAVAILABLE
  GET  /orders/:id              200 | 404. Resposta = publicOrderSchema: id, status, items, totalCents, checkoutUrl (só enquanto PENDING), paidAt, createdAt. SEM nome e SEM e-mail do cliente.
  POST /webhooks/mercadopago    200 | 401 INVALID_SIGNATURE (erro 500 faz o MP reenviar)
  POST /dev/payments/simulate   só existe com PAYMENT_PROVIDER=fake

Autenticação:
  POST /auth/login              { email, password } -> grava cookie, devolve admin | 401 INVALID_CREDENTIALS | 429 RATE_LIMITED
  POST /auth/logout             limpa o cookie
  GET  /auth/me                 admin logado | 401

Proteção CSRF (D15): toda requisição que ALTERA dados (POST/PATCH/PUT/DELETE) em /auth/* e /admin/* exige o header X-Requested-With: bancada-web e Content-Type: application/json (o web envia body "{}" quando não há dados). Sem eles: 403 CSRF_REJECTED. Não vale para /webhooks/* nem /orders.

Admin (todas exigem requireAdmin):
  GET   /admin/products                 todos, inclusive inativos; filtros ?q= (nome) e ?active=
  GET   /admin/products/:id             detalhe + últimas 20 movimentações
  POST  /admin/products                 { name, description, category, priceCents, initialStock, imageKey? } -> 201 | 409 SLUG_TAKEN
  PATCH /admin/products/:id             { name?, description?, category?, priceCents?, active?, imageKey? } (NÃO altera estoque). imageKey: ausente mantém a imagem; null remove; string troca (D16).
  POST  /admin/products/:id/stock       { delta (inteiro <> 0), reason: 'restock' | 'adjustment', note? } | 409 INVALID_STOCK_ADJUSTMENT
  POST  /admin/uploads/product-image    { contentType } -> { uploadUrl, fields, key } | 400 INVALID_FILE_TYPE
  GET   /admin/orders                   paginada (?status=&page=), mais recentes primeiro. Único lugar onde aparecem os dados do cliente (orderSchema completo, com o campo calculado cancellable: boolean).
  POST  /admin/orders/:id/cancel        cancela pedido PENDING criado há mais de 30 min e devolve o estoque (8.8) | 404 | 409 ORDER_NOT_CANCELLABLE

Respostas de produto incluem imageUrl = S3_PUBLIC_URL/<image_key> (ou null). O banco guarda só a key.

========================================
8. FLUXOS CRÍTICOS
========================================
8.1 Criar pedido (OrdersService.createOrder)
 1. Normalizar itens: somar produtos repetidos e ordenar por productId. request_hash = sha256(customer + itens).
 2. Se a Idempotency-Key já existe: com o mesmo hash, devolver o pedido existente (200) e refazer o checkout se ele não tiver checkout_url; com hash diferente, 409 IDEMPOTENCY_KEY_REUSED.
 3. BEGIN; SELECT ... FROM products WHERE id = ANY($1) AND active ORDER BY id FOR UPDATE (a ordem por id evita deadlock).
 3b. Logo após os locks e ANTES de validar o estoque, reconsultar a Idempotency-Key dentro da transação (D18): se já existir, ROLLBACK e responder replay (200) ou 409 IDEMPOTENCY_KEY_REUSED.
 4. Validar existência/ativo (422) e estoque (409 com details: [{ productId, requested, available }]).
 5. Total calculado com o PREÇO DO BANCO; preço enviado pelo cliente é ignorado.
 6. INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id. Se não voltar linha, outra requisição ganhou a corrida: ROLLBACK e devolver o pedido dela.
 7. Inserir itens e, para cada item, applyStockMovement com reason 'order', delta negativo e order_id. COMMIT.
 8. FORA da transação, chamar gateway.createCheckout() e salvar checkout_id/checkout_url. Se falhar: 502 com details.orderId; o pedido continua salvo e o retry com a mesma chave conclui o checkout.

8.2 Webhook (PaymentWebhookService.handlePaymentNotification)
 1. A rota lê type e data.id (query ou corpo). Se não for "payment", responde 200 e ignora.
 2. Valida a assinatura com WebhookSignatureValidator.validate({ xSignature, xRequestId, dataId, secret }), sem checagem de janela de tempo. Se falhar: 401.
 3. Busca o pagamento em gateway.getPayment(id). NUNCA confiar no corpo do webhook.
 4. BEGIN; trava o pedido (SELECT ... FROM orders WHERE id = external_reference FOR UPDATE). Travar ANTES de inserir o evento: na ordem inversa o INSERT segura FOR KEY SHARE no pedido (FK) e duas notificações simultâneas do mesmo pedido entram em deadlock (D20). Pedido inexistente: grava o evento com order_id NULL e outcome "order_not_found", responde 200.
 5. INSERT INTO payment_events ... ON CONFLICT DO NOTHING. Se não inserir: "duplicate", fim. Calcula o status alvo.
 6. Ordem das regras: sem mudança -> "no_change"; transição proibida -> "invalid_transition"; alvo PAID com valor diferente do total -> "amount_mismatch"; senão atualiza e devolve "applied".
 7. Alvo CANCELLED: para cada item, applyStockMovement com reason 'order_cancelled', delta positivo e order_id. Alvo REFUNDED NÃO devolve estoque (D13). Quando "applied", grava também orders.payment_id (e paid_at se PAID). Grava o outcome no evento. COMMIT.
 Cada combinação (provider, payment_id, status) é processada uma única vez; o mesmo pagamento mudando de status (pending -> approved) gera um evento novo, e uma nova tentativa depois de rejected costuma vir com outro payment_id.

8.3 Máquina de estados
 Status do MP -> status alvo do pedido:
  approved -> PAID
  cancelled -> CANCELLED
  refunded, charged_back -> REFUNDED
  pending, in_process, authorized, rejected -> nenhum (cartão recusado permite nova tentativa no mesmo checkout)
 Transições permitidas: PENDING->PAID, PENDING->CANCELLED, PAID->REFUNDED. Nenhuma outra.
 Estorno (REFUNDED) é devolução de dinheiro, não de mercadoria: o estoque não volta sozinho. Se o item voltar fisicamente, o admin faz ajuste manual com reason 'restock' e observação (D13).
 O cancelamento manual do admin (8.8) é a única outra forma de levar PENDING a CANCELLED.

8.4 Gateway de pagamento
 interface PaymentGateway {
   name: string                                   // 'mercadopago' | 'fake'
   createCheckout(req) -> { checkoutId, checkoutUrl }
   getPayment(paymentId) -> { id, status, orderId, amountCents }
 }
 - MercadoPagoGateway: cria Preference com external_reference = orderId, itens em reais, currency_id BRL, expires: true e expiration_date_to = created_at do pedido + 30 minutos (D19; depois disso o MP não aceita mais pagamento do pedido; D14), requestOptions.idempotencyKey = "preference-<orderId>". Envia auto_return e notification_url só se as URLs forem HTTPS. back_urls apontam para WEB_URL/pedido/:id.
 - FakePaymentGateway: pagamentos num Map em memória; checkoutUrl = WEB_URL/checkout-simulado/:orderId; registerPayment() alimenta /dev/payments/simulate, que chama o MESMO handlePaymentNotification.

8.5 Autenticação do admin
 - Senha com bcryptjs (custo 12).
 - Login: busca o admin pelo e-mail em minúsculo, compara a senha, gera JWT (HS256, expira em 8h, payload { sub: adminId }) e grava no cookie httpOnly "bancada_admin" (Secure em produção, SameSite = COOKIE_SAMESITE). E-mail inexistente e senha errada dão a MESMA resposta 401 INVALID_CREDENTIALS.
 - express-rate-limit no login: 5 tentativas por minuto por IP; excedeu: 429 RATE_LIMITED.
 - requireAdmin: lê o cookie, valida o JWT, coloca req.admin. Sem token ou inválido: 401 UNAUTHORIZED.
 - CORS com credentials: true, origin = WEB_URL e allowedHeaders incluindo Content-Type, Idempotency-Key e X-Requested-With. O web faz fetch com credentials: 'include'.
 - CSRF (D15): middleware requireCsrfHeader em todas as requisições que alteram dados em /auth/* e /admin/*. Exige X-Requested-With: bancada-web e Content-Type: application/json; senão 403 CSRF_REJECTED. Funciona porque site de terceiros não manda header customizado sem preflight de CORS, e o CORS só libera WEB_URL.
 - Deploy: preferir API e web no mesmo site (ex.: api.dominio.com e dominio.com) para manter SameSite=Lax. SameSite=None só se não houver alternativa.
 - O primeiro admin é criado por script: npm run admin:create -w apps/api -- --email x --password y --name z. Não existe rota pública de cadastro de admin.

8.6 Cadastro de produto e ajuste de estoque (AdminProductsService)
 - Criar: gera slug do nome (sem acento, kebab-case); slug repetido: 409 SLUG_TAKEN. Em transação: INSERT do produto com stock 0 e applyStockMovement 'initial' com o estoque inicial (se > 0) e admin_id.
 - Editar: altera dados e preço; não mexe em estoque. Mudar preço não afeta pedidos existentes (snapshot em order_items). imageKey: ausente mantém, null remove, string troca; o arquivo antigo no S3 NÃO é apagado (fica órfão; próximo passo, D16).
 - Desativar (active = false): some do catálogo público; novos pedidos com ele dão 422 PRODUCT_UNAVAILABLE; pedidos pendentes continuam válidos.
 - Ajustar estoque: BEGIN; SELECT ... FOR UPDATE no produto; se stock + delta < 0: 409 INVALID_STOCK_ADJUSTMENT e nada muda; senão applyStockMovement com reason, note e admin_id. COMMIT. Usa o mesmo lock do fluxo de pedido, então ajustes e vendas simultâneas não se atropelam.

8.8 Cancelamento manual de pedido abandonado (AdminOrdersService, D14)
 - Expiração automática por job continua fora do escopo (próximo passo, documentar no README). A Preference já expira no MP em 30 min (8.4).
 - POST /admin/orders/:id/cancel: BEGIN; SELECT ... FROM orders WHERE id = $1 FOR UPDATE; só cancela se status = PENDING E created_at < agora - 30 minutos. Caso contrário (não existe: 404; PAID/CANCELLED/REFUNDED ou com menos de 30 min: 409 ORDER_NOT_CANCELLABLE) nada muda.
 - Se puder: status = CANCELLED e, para cada item, applyStockMovement com reason 'order_cancelled', delta positivo, order_id e admin_id. COMMIT.
 - A regra dos 30 minutos evita cancelar um pedido que o cliente ainda está pagando. O "agora" é o do banco/servidor; o campo cancellable do GET /admin/orders usa a mesma regra e o web só mostra o botão "Cancelar pedido" quando for true.

8.7 Upload de imagem (presigned POST, a imagem não passa pela API)
 1. Web chama POST /admin/uploads/product-image { contentType }.
 2. API aceita só image/jpeg, image/png e image/webp (senão 400 INVALID_FILE_TYPE), gera key = products/<uuid>.<ext> e um presigned POST com content-length-range de 0 a 2 MB, válido por 5 minutos.
 3. Web envia o arquivo direto para o S3/MinIO com os fields recebidos e depois salva o imageKey no produto (POST ou PATCH).
 interface StorageService { createUpload(contentType) -> { uploadUrl, fields, key }; publicUrl(key) -> string }
 Implementações: S3StorageService (funciona com AWS e MinIO) e FakeStorageService (testes).

========================================
9. FRONT-END (apps/web)
========================================
Pastas (por feature):
  src/app/                 main.tsx, router.tsx, queryClient.ts, providers
  src/api/                 http.ts (fetch com credentials: 'include', header X-Requested-With: bancada-web em TODAS as requisições, Content-Type JSON + envelope + ApiError), products.ts, orders.ts, auth.ts, admin.ts
  src/features/catalog/    CatalogPage, ProductCard, useProducts()
  src/features/cart/       cartStore.ts (Zustand + persist), CartPage, CartLine
  src/features/checkout/   CheckoutForm (RHF + zodResolver), useCreateOrder()
  src/features/orders/     OrderPage, OrderTracker, useOrder(), FakeCheckoutPage
  src/features/admin/      AdminLayout, RequireAdmin, LoginPage, ProductsListPage, ProductFormPage, StockPanel, OrdersListPage, ImageUpload, hooks (useMe, useAdminProducts, useAdminProduct, useSaveProduct, useAdjustStock, useAdminOrders, useUploadImage)
  src/components/          Layout, Button, ProductIcon, ProductImage (imagem ou ícone SVG da categoria)
  src/lib/                 format.ts (formatPrice, formatDateTime, parsePriceToCents), idempotency.ts
  src/styles/              tokens.css, global.css

Rotas da loja:
  /                         catálogo
  /carrinho                 carrinho + formulário de checkout
  /pedido/:id               acompanhamento (também é a back_url do MP)
  /checkout-simulado/:id    substitui o MP no modo fake (botões: aprovar, recusar, cancelar, pagar valor diferente)
Rotas do admin:
  /admin/login
  /admin/produtos           tabela: imagem, nome, preço, estoque, status; busca por nome; botão "Novo produto"
  /admin/produtos/novo      formulário de criação com upload e pré-visualização
  /admin/produtos/:id       edição + painel "Estoque": quantidade atual, "Ajustar estoque" (quantidade +/-, motivo, observação) e histórico de movimentações
  /admin/pedidos            tabela de pedidos com filtro por status; botão "Cancelar pedido" só quando cancellable = true (invalida ['admin','orders'], ['admin','products'], ['admin','product', id] e ['products'])

Estado:
- Dados do servidor: SÓ TanStack Query. Chaves: ['products'], ['order', id], ['admin','me'], ['admin','products', filtros], ['admin','product', id], ['admin','orders', filtros]. Nada de useEffect + fetch nas páginas.
- useOrder faz polling (refetchInterval 3000) enquanto o status for PENDING e para depois de 5 min.
- Depois de criar, editar ou ajustar estoque: invalidar ['admin','products'], ['admin','product', id] e ['products'].
- Carrinho: SÓ Zustand com persist (localStorage). lines: { product, quantity }[]; ações add, setQuantity, remove, clear. Nunca passa do estoque.
- Formulários: React Hook Form + zodResolver com os schemas de contracts. Preço digitado em reais ("349,90") e convertido para centavos antes de enviar.
- Idempotency-Key do checkout: gerada com crypto.randomUUID() e guardada em useRef; muda só quando o carrinho ou os dados do cliente mudam; o retry reusa a mesma chave.
- Erros no checkout: OUT_OF_STOCK mostra o disponível por item e oferece "Ajustar ao estoque disponível"; CHECKOUT_UNAVAILABLE mantém a chave e pede para pagar de novo; erro de rede diz que a API está fora do ar.
- RequireAdmin: usa useMe(); se der 401, redireciona para /admin/login guardando a página pedida para voltar depois do login.
- Upload: valida tipo (jpg, png, webp) e tamanho (2 MB) no cliente antes de pedir a URL; mostra progresso e pré-visualização.

Identidade visual:
- Ideia: base de corte quadriculada de bancada de trabalho, com régua/fita métrica.
- Cores (tokens CSS): --mat #2F5D50, --mat-deep #24493F, --paper #F6F7F4 (fundo), --ink #18211E (texto), --muted #5B6863, --line #D6DCD8, --tape #F2C230 (botão principal, texto ink), --danger #B3402A, --ok #2E7D57.
- Tipografia: só Archivo Variable (@fontsource-variable/archivo/wdth.css). Títulos com font-stretch 125% e peso 800; texto em largura normal. Preços com tabular-nums.
- Loja: hero com fundo verde quadriculado (grade fina de 16px e grade forte de 80px) e régua amarela na base; é o ÚNICO elemento chamativo. O resto é discreto: bordas de 1px, raio de 10px, sem sombras, sem gradientes decorativos.
- Header verde escuro com "Bancada" e o link do carrinho com contador amarelo.
- Produto sem imagem mostra um ícone SVG em traço da categoria sobre o fundo verde quadriculado.
- Admin: mesmos tokens, sem o hero; header "Bancada · Admin" com links Produtos e Pedidos e botão "Sair". Tabelas limpas, status com etiqueta (ativo em verde, inativo em cinza).
- Funciona a partir de 360px de largura, foco visível, label em todo input, erros com role="alert", prefers-reduced-motion respeitado.
- Textos da interface em PT-BR, sentence case; botões dizem o que fazem ("Pagar R$ 279,70", "Salvar produto", não "Enviar").

========================================
10. INFRA
========================================
docker-compose.yml:
  db           postgres:16-alpine com healthcheck
  minio        minio/minio (S3 local), portas 9000 (API) e 9001 (console)
  minio-init   minio/mc: cria o bucket e libera leitura pública, depois encerra
  api          Dockerfile multi-stage; no start roda as migrações
  web          build do Vite servido por nginx com fallback de SPA
Produção: API na AWS (App Runner ou ECS + RDS), imagens no S3, web na Vercel.

========================================
11. TESTES
========================================
API: npm test -w apps/api, contra o Postgres de TEST_DATABASE_URL. O globalSetup cria o banco se não existir, recria o schema e roda as migrações; cada teste faz TRUNCATE + seed.
Obrigatórios:
Pedidos e estoque
- total calculado com o preço do banco, ignorando o do cliente
- itens repetidos somados
- replay da mesma chave: 200, mesmo pedido, sem reservar estoque de novo
- 3 requisições simultâneas com a mesma chave geram 1 pedido
- mesma chave com outro corpo: 409
- estoque insuficiente: 409 e o estoque não muda
- 6 pedidos simultâneos para 3 unidades: exatamente 3 dão certo
- falha do gateway: 502, e o retry conclui sem duplicar
- criar pedido grava movimento 'order'; cancelamento grava 'order_cancelled'
Webhook
- aprovado; recusado e depois aprovado; cancelado (com devolução de estoque); estorno; duplicado (só um "applied"); valor adulterado; transição inválida; assinatura válida e inválida
Admin
- login certo grava o cookie; senha errada e e-mail inexistente dão o mesmo 401; a 6ª tentativa no mesmo minuto dá 429
- rotas /admin sem cookie ou com token inválido: 401
- criar produto gera o slug e um movimento 'initial'; nome repetido: 409 SLUG_TAKEN
- ajuste de estoque grava movimento com stock_after correto; ajuste que deixaria negativo: 409 e nada muda
- ajustes do admin e pedidos simultâneos: estoque final igual à soma de todos os movimentos
- cancelar pedido antes de 30 min: 409 ORDER_NOT_CANCELLABLE; depois de 30 min: cancela e devolve o estoque (movimento 'order_cancelled' com admin_id); cancelar pedido PAID: 409
- POST em rota /admin com cookie válido e sem o header X-Requested-With: 403 CSRF_REJECTED
- GET /orders/:id (público) não contém customer (nem nome nem e-mail); GET /admin/orders contém
- Preference criada com expires: true e expiration_date_to = created_at + 30 min (verificado no FakePaymentGateway/mock do SDK)
- estorno não altera o estoque
- produto desativado some do GET /products e novo pedido com ele dá 422
- upload: tipo inválido dá 400 INVALID_FILE_TYPE; tipo válido devolve uploadUrl, fields e key
Web: typecheck e build no CI.

========================================
12. CONVENÇÕES
========================================
- TypeScript strict, sem any. Arquivos kebab-case com sufixo da camada (orders.service.ts); componentes React em PascalCase.tsx.
- SQL sempre parametrizado.
- Interface e mensagens de erro em PT-BR; identificadores de código em inglês.
- Logs com Pino, nunca console.log. Nunca logar senha, token ou cookie.
- Git: Conventional Commits (feat(orders): ..., test(stock): ...), uma branch por tarefa (feat/t07-criar-pedido), commits pequenos. Nunca commitar .env, node_modules, dist ou credenciais.
- Pronto = typecheck, lint e testes verdes.

========================================
13. DECISÕES
========================================
D1  SQL puro, sem ORM: o diferencial é transação, FOR UPDATE e constraints explícitos.
D2  Dinheiro em centavos: evita erro de ponto flutuante.
D3  Gateway atrás de interface, com implementação fake: roda e testa sem credenciais.
D4  Webhook reconsulta o pagamento no MP: o corpo pode ser forjado ou estar desatualizado.
D5  Estoque reservado na criação do pedido: evita pagar por algo que esgotou.
D6  Sem janela de tempo na validação da assinatura: replays já são inofensivos pela deduplicação.
D7  Contratos Zod num pacote compartilhado: uma definição só para API e formulários.
D8  Só o admin tem login; cliente compra sem conta. Mantém o foco no pagamento.
D9  JWT em cookie httpOnly: o JavaScript da página não consegue ler o token (proteção contra XSS).
D10 Upload direto para o S3 com presigned POST: a API não trafega arquivos e o limite de tamanho é imposto pelo próprio S3.
D11 Estoque como livro-razão (stock_movements): toda mudança é auditável e o estoque pode ser conferido pela soma dos movimentos.
D12 Produtos são desativados, nunca apagados: preserva o histórico de pedidos.
D13 Estorno não devolve estoque: é devolução de dinheiro, não de mercadoria (o item pode já ter sido enviado). Se voltar fisicamente, o admin ajusta com reason 'restock' e observação.
D14 Pedido abandonado: a Preference expira no MP em 30 min (expires + expiration_date_to) e o admin pode cancelar manualmente pedido PENDING com mais de 30 min, devolvendo o estoque. Expiração automática por job fica como próximo passo.
D15 CSRF: mutações em /auth/* e /admin/* exigem X-Requested-With: bancada-web e Content-Type: application/json (403 CSRF_REJECTED), somado ao CORS restrito a WEB_URL. Deploy preferencialmente no mesmo site para manter SameSite=Lax.
D16 imageKey no PATCH: ausente mantém, null remove, string troca. Arquivos antigos no S3 não são apagados (órfãos); limpeza é próximo passo.
D17 Seed nunca sobrescreve produtos existentes (ON CONFLICT DO NOTHING): rodar de novo não desfaz edições feitas pelo admin.
D18 Reconsulta da Idempotency-Key depois dos locks (8.1, passo 3b): sem isso, uma requisição repetida simultânea veria o estoque já reservado pela primeira e responderia OUT_OF_STOCK em vez de replay. Toda devolução de estoque (webhook CANCELLED, cancelamento manual) aplica os itens em ordem de productId, a mesma dos locks, para não dar deadlock com a criação de pedido.
D19 A expiração da Preference é ancorada em orders.created_at + 30 min (não em "agora"): coincide com a janela do cancelamento manual (8.8), então um pedido nunca pode ser pago depois de cancelável. Retry do checkout depois dessa janela responde 502 CHECKOUT_UNAVAILABLE com details.reason = 'expired' (o web gera nova chave). Pagamento que chega depois do cancelamento cai em transição inválida: o pedido continua CANCELLED e o evento é gravado com log de alerta (T09).
D20 Webhook, detalhes de implementação: (a) o pedido é travado antes do INSERT do evento (evita deadlock por FK); (b) status desconhecido do MP vira no_change com log, nunca 500; (c) pagamento que o provedor diz não existir (404 no getPayment, ex.: botão de teste do painel do MP) responde 200 "payment_not_found", sem evento; outros erros do provedor viram 5xx para o MP reenviar; (d) um segundo approved com outro payment_id num pedido já PAID é no_change com log de alerta de cobrança em dobro; (e) o status bruto do MP fica em payment_events; (f) schemas de pagamento ficam em contracts/src/payment.ts (simulatePaymentInputSchema, statuses do MP); (g) com NODE_ENV=production e PAYMENT_PROVIDER=fake o servidor recusa subir, a menos que ALLOW_FAKE_PAYMENTS=true (então só avisa em log).
Mudança de arquitetura só registrando uma nova decisão aqui.

========================================
14. PAPÉIS DOS AGENTES
========================================
- organizador: escolhe a próxima tarefa do roadmap, delega citando as seções deste documento, revisa contra os critérios de aceite rodando os comandos, e só então marca como concluída. Não escreve código de produção.
- api: implementa apps/api e packages/contracts. Nos fluxos de pedido, estoque, webhook e auth, escreve o teste antes da implementação.
- web: implementa apps/web. Não altera a API; mudanças em contracts passam pelo organizador.
- git: branches, commits, PRs e CI. Antes de cada commit roda typecheck, lint e testes; se falhar, não commita.

========================================
15. ROADMAP (ordem de execução)
========================================
Uma tarefa por vez (api e web podem andar em paralelo quando não dependem uma da outra). Só marcar como concluída depois de verificar os critérios.

Fase 0 · Fundação
T01 [org] Monorepo: workspaces, tsconfig.base.json, ESLint + Prettier, .gitignore, docker-compose com db, minio e minio-init. Aceite: npm install na raiz, docker compose up sobe banco e MinIO com bucket criado, lint passa.
T02 [api] packages/contracts com todos os schemas da seção 4 (inclui publicOrderSchema e os ErrorCodes ORDER_NOT_CANCELLABLE e CSRF_REJECTED). Aceite: importável nos dois apps, com teste unitário.
T03 [git] CI no GitHub Actions com Postgres como service: lint, typecheck, testes e build.

Fase 1 · API base
T04 [api] Esqueleto: env, pool, errors, http, createApp, server, /health. Aceite: /health 200; env inválida derruba o processo com mensagem clara.
T05 [api] Migração 001 completa (seção 6), runner de migrações, stock.repository (applyStockMovement), seed e setup de testes. Aceite: migrate idempotente; seed gera movimentos 'initial'; build copia os .sql sem comandos Unix.
T06 [api] Produtos públicos: GET /products e /products/:id com imageUrl. Aceite: testes de listagem, inativo e 404.
(GET /orders/:id com publicOrderSchema entra na T07; o teste "resposta pública não contém customer" é dela.)

Fase 2 · Pedidos e pagamento
T07 [api] Criar pedido (fluxo 8.1, sem gateway ainda) e GET /orders/:id público (publicOrderSchema). Aceite: testes de pedido, idempotência, estoque, movimentos, concorrência e "resposta pública não contém customer".
T08 [api] Gateway de pagamento (8.4), checkout fora da transação, Preference com expires: true e expiration_date_to = created_at do pedido + 30 min (D19). Aceite: teste de falha seguida de retry; teste da expiração da Preference.
T09 [api] Webhook, máquina de estados e /dev/payments/simulate. Aceite: todos os testes de webhook.

Fase 3 · Administração (API)
T10 [api] Autenticação (8.5): login, logout, me, requireAdmin, rate limit, proteção CSRF (requireCsrfHeader, D15), script create-admin. Aceite: testes de auth e "POST em rota admin com cookie válido e sem o header dá 403".
T11 [api] Produtos e estoque do admin (8.6) + lista de pedidos + POST /admin/orders/:id/cancel (8.8). Aceite: testes de produto, slug, ajuste, desativação, imageKey (ausente/null/string), concorrência admin x pedidos, cancelamento (antes de 30 min: 409; depois: cancela e devolve estoque; PAID: 409) e estorno sem mexer no estoque.
T12 [api] StorageService + rota de upload (8.7). Aceite: testes de upload; upload real funcionando no MinIO local.

Fase 4 · Loja (web)
T13 [web] Esqueleto: Vite, router, QueryClient, Layout, tokens.css, cliente http com credentials, header X-Requested-With: bancada-web e ApiError.
T14 [web] Catálogo e carrinho (Zustand + persist), com ProductImage. Aceite: respeita o estoque, sobrevive ao F5, sem rolagem horizontal em 360px.
T15 [web] Checkout com RHF + contracts e Idempotency-Key estável. Aceite: duplo clique gera um pedido só; ao dar certo, limpa o carrinho e redireciona.
T16 [web] Página do pedido com polling e checkout simulado. Aceite: fluxo completo catálogo -> carrinho -> simulado -> pedido pago.

Fase 5 · Administração (web)
T17 [web] Login, RequireAdmin e AdminLayout. Aceite: sem login redireciona; depois do login volta à página pedida; "Sair" limpa a sessão.
T18 [web] Lista, criação e edição de produtos com upload de imagem. Aceite: produto criado no admin aparece na loja com a imagem.
T19 [web] Painel de estoque (ajuste + histórico) e lista de pedidos com botão "Cancelar pedido" (só quando cancellable). Aceite: ajuste reflete na loja; pedido pago aparece com status correto; cancelar pedido abandonado devolve o estoque na loja.

Fase 6 · Entrega
T20 [api] Docker completo: Dockerfiles da API e do web, compose com db, minio, minio-init, api e web. Aceite: docker compose up --build deixa loja e admin funcionando.
T21 [org] README com prints, diagrama Mermaid dos fluxos de pagamento e estoque, decisões, como criar o admin, modo fake e modo Mercado Pago (com ngrok), tabela de endpoints, e seção "Próximos passos" (expiração automática de pedidos por job, limpeza de imagens órfãs no S3).
T22 [org + api] Teste com o Mercado Pago real (credenciais de teste + túnel + webhook cadastrado no painel).
T23 [org] Deploy: API na AWS (App Runner ou ECS + RDS + S3) e web na Vercel. Links no README.

========================================
COMO COMEÇAR
========================================
1. Salve este conteúdo em ARCHITECTURE.md e a seção 15 em ROADMAP.md (com checkboxes).
2. Crie também um CLAUDE.md curto dizendo: ler ARCHITECTURE.md antes de qualquer tarefa, trabalhar só na tarefa atribuída, parar e perguntar diante de contradições, e as regras inegociáveis (preço sempre do banco, centavos, SQL parametrizado, webhook reconsulta o provedor, toda mudança de estoque via applyStockMovement, sem any, sem segredos commitados).
3. Me devolva um resumo de 5 linhas do que entendeu e liste qualquer ponto ambíguo ou contraditório. Espere minha confirmação.
4. Depois da confirmação, comece pela T01.
