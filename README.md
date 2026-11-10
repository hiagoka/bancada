# Bancada

E-commerce full stack de equipamentos para a mesa de trabalho de devs (teclados, mouses, headsets, suportes, hubs, canecas). É um projeto de portfólio: o foco não é o catálogo, e sim o **fluxo de pagamento** e o **controle de estoque** feitos do jeito certo.

O que ele prova, com testes contra um PostgreSQL real:

- **Pedido idempotente**: a mesma `Idempotency-Key` devolve o mesmo pedido; a mesma chave com outro corpo é recusada.
- **Sem venda dupla sob concorrência**: 6 pedidos simultâneos para 3 unidades vendem exatamente 3.
- **Estoque auditável**: todo movimento fica num livro-razão (`stock_movements`), e o estoque atual é sempre a soma dos deltas.
- **Webhook validado e deduplicado**: assinatura conferida, pagamento reconsultado no provedor (o corpo nunca é confiado) e cada evento processado uma única vez.
- **Máquina de estados do pedido** com transições explícitas, e uma **área administrativa** (login por cookie `httpOnly`, CSRF por header, upload direto ao S3).

**Stack:** Node 22 e TypeScript estrito · Express 5, Zod 4, `pg` com SQL puro (sem ORM), Pino · PostgreSQL 16 com migrações `.sql` e runner próprio · SDK oficial do Mercado Pago · S3 (MinIO localmente) · React 19, Vite, React Router 7, TanStack Query 5, Zustand 5, React Hook Form · Jest e Vitest · Docker Compose e GitHub Actions. API, web e o pacote de schemas compartilhados vivem num monorepo de npm workspaces.

**Deploy:** em breve (T23).

**Mercado Pago real:** o código usa o SDK oficial e é testado com um gateway simulado. O teste ponta a ponta com o Mercado Pago de verdade é a tarefa T22 e **ainda não foi feito** (ver [Modo Mercado Pago](#modo-mercado-pago-planejado-ainda-não-verificado)).

## Prints

### Loja

![Catálogo da Bancada: grade assimétrica de produtos com preço em fonte monoespaçada e botão de adicionar ao carrinho](docs/screenshots/01-catalogo.jpg)

_Catálogo: produtos sem imagem mostram o ícone da categoria, e produtos com estoque baixo ganham um selo._

![Carrinho com a lista de itens, controle de quantidade limitado ao estoque e o total](docs/screenshots/02-carrinho.jpg)

_Carrinho persistente (sobrevive ao F5); a quantidade nunca passa do estoque._

![Formulário de checkout com nome, e-mail e o botão que mostra o valor a pagar](docs/screenshots/03-checkout.jpg)

_Checkout: o botão diz quanto será cobrado, e um duplo clique gera um pedido só._

![Página do pedido com o selo Pago, as etapas concluídas, os itens e o total](docs/screenshots/04-pedido-pago.jpg)

_Acompanhamento do pedido, que consulta a API a cada 3 s enquanto está pendente e vira "Pago" sozinho._

### Administração

![Tela de login do admin com os campos de e-mail e senha](docs/screenshots/05-admin-login.jpg)

_Login do admin (sessão em cookie `httpOnly`)._

![Lista de produtos do admin com imagem, preço, estoque e situação](docs/screenshots/06-admin-produtos.jpg)

_Lista de produtos, com busca por nome e filtro de situação._

![Edição de produto com o painel de estoque: ajuste com sinal e histórico de movimentações](docs/screenshots/07-admin-estoque.jpg)

_Painel de estoque: ajuste com sinal e o histórico (o livro-razão) das últimas movimentações._

![Lista de pedidos do admin com cliente, itens, total e um pedido com o selo Pago](docs/screenshots/08-admin-pedidos.jpg)

_Pedidos, com filtro por situação. Um pedido pago não tem ação; o botão "Cancelar pedido" só aparece quando o servidor diz que o pedido é cancelável (PENDING há mais de 30 minutos)._

## Como funciona

### Pagamento: do pedido ao webhook

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant W as Web
    participant A as API
    participant D as PostgreSQL
    participant M as Mercado Pago

    C->>W: Pagar
    W->>A: POST /orders com Idempotency-Key
    A->>D: BEGIN e trava os produtos (ORDER BY id FOR UPDATE)
    A->>D: reconsulta a chave, valida o estoque e soma o total com o preço do banco
    A->>D: grava pedido, itens e movimentos de estoque, depois COMMIT
    Note over A,M: o checkout acontece FORA da transação
    A->>M: cria a Preference (external_reference = id do pedido, expira em 30 min)
    M-->>A: checkoutUrl
    A->>D: salva checkout_id e checkout_url
    A-->>W: 201 com o pedido e a checkoutUrl
    W->>M: redireciona o cliente para pagar
    Note over A,M: se a Preference falhar, a API responde 502 e o pedido continua salvo. O retry com a mesma chave conclui o checkout sem duplicar.

    C->>M: paga
    M->>A: POST /webhooks/mercadopago
    A->>A: valida a assinatura (401 se inválida)
    A->>M: busca o pagamento. O corpo do webhook nunca é confiado.
    A->>D: BEGIN e trava o pedido (FOR UPDATE)
    A->>D: INSERT em payment_events ON CONFLICT DO NOTHING (deduplica)
    A->>D: aplica a máquina de estados e grava o outcome, depois COMMIT
    A-->>M: 200
    loop a cada 3 s enquanto o pedido está PENDING
        W->>A: GET /orders/:id
        A-->>W: status atual
    end
    W-->>C: mostra Pago
```

A mesma `Idempotency-Key` com o mesmo corpo devolve o mesmo pedido (200), sem reservar estoque de novo. Com outro corpo, `409 IDEMPOTENCY_KEY_REUSED`. O `outcome` gravado em cada evento é um de `applied`, `no_change`, `invalid_transition`, `amount_mismatch`, `duplicate`, `order_not_found` ou `payment_not_found`.

### Estoque: um livro-razão

```mermaid
flowchart TD
    N["Cadastro do produto (admin)"] -->|"initial"| L
    P["Pedido criado"] -->|"order, delta negativo"| L
    W["Webhook cancelled"] -->|"order_cancelled, delta positivo"| L
    X["Admin cancela pedido PENDING com mais de 30 min"] -->|"order_cancelled, delta positivo"| L
    J["Admin ajusta o estoque"] -->|"restock ou adjustment, delta com sinal"| L
    R["Webhook refunded ou charged_back"] -.->|"não devolve estoque (D13)"| Z["nenhum movimento"]

    L["applyStockMovement: UPDATE products SET stock = stock + delta e INSERT em stock_movements, na mesma transação"]
    L --> S[("products.stock, com constraint stock >= 0")]
    L --> K[("stock_movements, com stock_after")]
    S -.- I["Invariante: stock = soma dos deltas dos movimentos do produto"]
    K -.- I
```

Toda mudança de estoque passa por `applyStockMovement`; ninguém faz `UPDATE` direto em `products.stock`. O ajuste do admin usa o mesmo `SELECT ... FOR UPDATE` do fluxo de pedido, então ajustes e vendas simultâneos não se atropelam. Hoje não há expiração automática: um pedido abandonado segura o estoque até o admin cancelá-lo (ver [Próximos passos](#próximos-passos)).

### Máquina de estados do pedido

```mermaid
stateDiagram-v2
    [*] --> PENDING: pedido criado com o estoque reservado
    PENDING --> PAID: pagamento approved com valor igual ao total
    PENDING --> CANCELLED: cancelled no Mercado Pago ou cancelamento manual do admin
    PAID --> REFUNDED: refunded ou charged_back
    CANCELLED --> [*]
    REFUNDED --> [*]

    note right of CANCELLED
        devolve o estoque (order_cancelled)
    end note
    note right of REFUNDED
        estorno é devolução de dinheiro e não de mercadoria, então NÃO devolve estoque (D13)
    end note
```

Só existem três transições: `PENDING → PAID`, `PENDING → CANCELLED` e `PAID → REFUNDED`. Qualquer outra é registrada como `invalid_transition` e não muda nada. Pagamento com valor diferente do total do pedido não é aceito (`amount_mismatch`). `pending`, `in_process`, `authorized` e `rejected` não mudam o pedido (cartão recusado permite nova tentativa no mesmo checkout).

## Decisões de projeto

As decisões completas (D1 a D33) estão na seção 13 do [ARCHITECTURE.md](ARCHITECTURE.md), que é a fonte da verdade do projeto. As principais:

| Decisão                                                                                                                   | Por quê                                                                                                                                      | Onde                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| SQL puro com `pg`, sem ORM                                                                                                | O diferencial é mostrar transação, `FOR UPDATE` e constraints de forma explícita.                                                            | [D1](ARCHITECTURE.md)                          |
| Dinheiro em centavos (`INTEGER`)                                                                                          | Evita erro de ponto flutuante. Só vira reais ao montar a Preference e ao exibir.                                                             | [D2](ARCHITECTURE.md)                          |
| Preço sempre vem do banco                                                                                                 | O preço enviado pelo cliente é ignorado: o total é calculado no servidor.                                                                    | Fluxo 8.1                                      |
| Idempotência com `Idempotency-Key` + `request_hash`                                                                       | O hash (sha256 do cliente e dos itens normalizados) distingue replay legítimo (200) de reuso indevido da chave (409).                        | Fluxo 8.1                                      |
| Reconsulta da chave depois dos locks                                                                                      | Sem isso, uma requisição repetida simultânea veria o estoque já reservado pela primeira e responderia `OUT_OF_STOCK` em vez de replay.       | [D18](ARCHITECTURE.md)                         |
| Locks de produto em `ORDER BY id`                                                                                         | Ordem única de aquisição evita deadlock entre pedidos que compartilham produtos. As devoluções de estoque seguem a mesma ordem.              | [D18](ARCHITECTURE.md)                         |
| Checkout (Preference) fora da transação                                                                                   | Não se segura lock de banco durante uma chamada de rede. Se o provedor falhar, o pedido fica salvo e o retry com a mesma chave conclui.      | Fluxo 8.1                                      |
| Estoque reservado na criação do pedido                                                                                    | Evita pagar por algo que esgotou.                                                                                                            | [D5](ARCHITECTURE.md)                          |
| Estoque como livro-razão (`stock_movements`)                                                                              | Toda mudança é auditável e o estoque pode ser conferido pela soma dos movimentos.                                                            | [D11](ARCHITECTURE.md)                         |
| Webhook reconsulta o pagamento no provedor                                                                                | O corpo da notificação pode ser forjado ou estar desatualizado.                                                                              | [D4](ARCHITECTURE.md)                          |
| Lock do pedido antes de inserir o `payment_event`                                                                         | Na ordem inversa o `INSERT` segura `FOR KEY SHARE` no pedido (FK) e duas notificações simultâneas entram em deadlock. Há teste de regressão. | [D20](ARCHITECTURE.md)                         |
| Deduplicação por `UNIQUE (provider, payment_id, status)`                                                                  | Cada combinação é processada uma única vez, então replays são inofensivos e a assinatura dispensa janela de tempo.                           | Seção 6 e fluxo 8.2                            |
| Estorno não devolve estoque                                                                                               | É devolução de dinheiro, não de mercadoria. Se o item voltar, o admin ajusta com `restock` e uma observação.                                 | [D13](ARCHITECTURE.md)                         |
| Preference expira em `created_at` + 30 min; admin cancela pedido abandonado                                               | A expiração coincide com a janela do cancelamento manual, então um pedido nunca pode ser pago depois de cancelável.                          | [D14](ARCHITECTURE.md), [D19](ARCHITECTURE.md) |
| Gateway de pagamento atrás de interface, com implementação fake                                                           | Roda e testa sem credenciais.                                                                                                                | [D3](ARCHITECTURE.md)                          |
| Sessão do admin em JWT num cookie `httpOnly`                                                                              | O JavaScript da página não consegue ler o token (proteção contra XSS).                                                                       | [D9](ARCHITECTURE.md)                          |
| CSRF por header: `X-Requested-With: bancada-web` + `Content-Type: application/json` em toda mutação de `/auth` e `/admin` | Site de terceiros não manda header customizado sem preflight de CORS, e o CORS só libera a origem do web.                                    | [D15](ARCHITECTURE.md)                         |
| Upload de imagem por presigned POST direto ao S3                                                                          | A API não trafega arquivos e o limite de tamanho (2 MB) e o tipo declarado são impostos pela política assinada, ou seja, pelo próprio S3.    | [D10](ARCHITECTURE.md), [D23](ARCHITECTURE.md) |
| Produtos nunca são apagados, só desativados                                                                               | Preserva o histórico dos pedidos (`order_items` aponta para eles).                                                                           | [D12](ARCHITECTURE.md)                         |
| Schemas Zod num pacote compartilhado (`packages/contracts`)                                                               | Uma definição só para a validação da API e para os formulários do web.                                                                       | [D7](ARCHITECTURE.md)                          |
| Seed nunca sobrescreve produtos existentes                                                                                | Rodar de novo (ou reiniciar o container) não desfaz edições feitas pelo admin.                                                               | [D17](ARCHITECTURE.md)                         |
| Checkout do web com chave estável, guardada também em `sessionStorage`                                                    | Recarregar a página reusa a chave e o servidor devolve o mesmo pedido; a chave expira em 25 minutos, abaixo da janela de 30.                 | [D28](ARCHITECTURE.md)                         |
| Status do pedido no web vem sempre da API                                                                                 | Os parâmetros que o Mercado Pago anexa ao retorno da compra são ignorados.                                                                   | [D29](ARCHITECTURE.md)                         |
| Imagens do MinIO via fork `pgsty/minio`                                                                                   | As imagens oficiais saíram do Docker Hub e do Quay; o código só fala S3, então trocar o provedor local só muda o compose.                    | [D24](ARCHITECTURE.md)                         |
| `docker compose up --build` provado por um workflow de CI                                                                 | O ambiente do autor não tem Docker; o workflow sobe a stack inteira e confere com `curl`.                                                    | [D33](ARCHITECTURE.md)                         |

## Como rodar

### Tudo com Docker

Precisa só de Docker com o Compose. Na raiz do repositório:

```bash
docker compose up --build
```

| Serviço               | Endereço                                                    |
| --------------------- | ----------------------------------------------------------- |
| Loja e admin (web)    | http://localhost:8080                                       |
| API                   | http://localhost:3333 (por exemplo, `GET /health`)          |
| Console do MinIO (S3) | http://localhost:9001 (usuário e senha padrão `minioadmin`) |
| PostgreSQL            | `localhost:5432` (usuário, senha e banco `bancada`)         |

Na subida a API roda as migrações e o seed (6 produtos; o seed nunca sobrescreve produtos que já existem). Depois [crie o admin](#criar-o-admin) para entrar em `/admin/login`.

> **O compose é só para desenvolvimento e demonstração (D33).** Senhas e `JWT_SECRET` são valores de dev, o banco e o MinIO ficam expostos nas portas locais e o pagamento é **simulado** (`PAYMENT_PROVIDER=fake`). Não é uma configuração de produção.

Para subir só o banco e o MinIO (com a API e o web rodando fora do Docker, como abaixo):

```bash
docker compose up -d db minio minio-init
```

`docker compose down` para parar; `docker compose down -v` também apaga os dados (banco e imagens).

### Desenvolvimento local

Requisitos: Node 22 (há um `.nvmrc`), PostgreSQL 16 e um S3 compatível (MinIO). O jeito mais simples de ter os dois é o comando `docker compose up -d db minio minio-init` acima.

```bash
npm install

# configuração (veja "Variáveis de ambiente" abaixo)
cp apps/api/.env.example apps/api/.env      # troque JWT_SECRET por um valor de pelo menos 32 caracteres
cp apps/web/.env.example apps/web/.env

# o pacote de schemas precisa estar compilado antes de a API e o web rodarem
npm run build -w @bancada/contracts

npm run migrate -w @bancada/api             # cria o schema
npm run seed -w @bancada/api                # 6 produtos de exemplo (idempotente)

npm run dev -w @bancada/api                 # API em http://localhost:3333
npm run dev -w @bancada/web                 # loja e admin em http://localhost:5173
```

A API não migra sozinha no `dev`: rode `migrate` depois de um banco novo. Na imagem Docker a migração acontece no start.

### Criar o admin

Não existe cadastro de admin pela tela nem rota pública: o único caminho é o script (senha com no mínimo 10 caracteres).

```bash
# desenvolvimento local
npm run admin:create -w apps/api -- --email voce@exemplo.com --password '<senha>' --name 'Seu Nome'

# Docker
docker compose exec api node dist/scripts/create-admin.js --email voce@exemplo.com --password '<senha>' --name 'Seu Nome'
```

> A senha passada em `--password` fica no histórico do shell (D21). Ler a senha de uma variável de ambiente é um dos [próximos passos](#próximos-passos).

O `apps/api/.env.example` traz `ADMIN_DEV_EMAIL` e `ADMIN_DEV_PASSWORD`: é uma credencial de **teste, só para uso local** (D30). Nenhum código lê essas variáveis; elas apenas documentam qual admin foi criado no banco de desenvolvimento do autor.

### Variáveis de ambiente

Modelos: [`apps/api/.env.example`](apps/api/.env.example) e [`apps/web/.env.example`](apps/web/.env.example). A API valida tudo ao subir (Zod) e falha cedo, listando as variáveis inválidas. As principais:

| Variável                                                                                                                    | Para quê                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (obrigatória)                                                                                                | Conexão com o PostgreSQL.                                                                                                                                                           |
| `TEST_DATABASE_URL`                                                                                                         | Banco dos testes da API (padrão `postgres://bancada:bancada@localhost:5432/bancada_test`).                                                                                          |
| `PORT`                                                                                                                      | Porta da API (padrão 3333).                                                                                                                                                         |
| `WEB_URL`, `API_PUBLIC_URL`                                                                                                 | Origem do web (CORS com cookie e links de retorno do pagamento) e URL pública da API (`notification_url` do webhook). Padrões `http://localhost:5173` e `:3333`.                    |
| `JWT_SECRET` (obrigatória)                                                                                                  | Assina o JWT do admin; mínimo de 32 caracteres.                                                                                                                                     |
| `COOKIE_SAMESITE`                                                                                                           | `lax` (padrão) ou `none`. O ideal é web e API no mesmo site, para manter `lax`.                                                                                                     |
| `PAYMENT_PROVIDER`                                                                                                          | `fake` (padrão) ou `mercadopago`.                                                                                                                                                   |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`                                                                                      | Obrigatórias com `mercadopago`.                                                                                                                                                     |
| `ALLOW_FAKE_PAYMENTS`                                                                                                       | Libera `PAYMENT_PROVIDER=fake` com `NODE_ENV=production` (por padrão a API recusa subir assim).                                                                                     |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`, `S3_FORCE_PATH_STYLE` | Armazenamento das imagens. Fora de produção têm o padrão do MinIO local; em produção todas (menos `S3_ENDPOINT`, vazio na AWS) são obrigatórias.                                    |
| `S3_PUBLIC_ENDPOINT`                                                                                                        | Opcional: endpoint do S3 como o **navegador** o enxerga, usado só no `uploadUrl` do presigned POST (no Docker a API usa `http://minio:9000` e o navegador `http://localhost:9000`). |
| `BCRYPT_COST`, `TRUST_PROXY`                                                                                                | Custo do bcrypt (padrão 12) e confiança em proxy para o IP do rate limit do login (padrão `false`; atrás de ALB ou App Runner use `1`).                                             |
| `LOG_LEVEL`                                                                                                                 | Nível do Pino (padrão `info`).                                                                                                                                                      |
| `SEED_ON_START`                                                                                                             | Só na imagem Docker: `true` roda o seed antes de subir a API (o compose liga).                                                                                                      |
| `VITE_API_URL` (web)                                                                                                        | URL da API que o navegador usa. No build de produção é obrigatória e **vira parte do bundle**: outra URL exige refazer a imagem.                                                    |

## Modos de pagamento

O gateway fica atrás de uma interface (`PaymentGateway`), e a variável `PAYMENT_PROVIDER` escolhe a implementação.

### Modo fake (padrão)

`PAYMENT_PROVIDER=fake` não precisa de credenciais. É o modo dos testes, do Docker Compose e do desenvolvimento.

- O checkout leva para uma página simulada da própria loja, `/checkout-simulado/:id`, com uma faixa "MODO SIMULADO: nenhum dinheiro real é cobrado" e quatro botões: **Aprovar pagamento**, **Recusar pagamento**, **Cancelar pedido** e **Pagar valor diferente** (paga `total - R$ 10,00`, ou `total + R$ 1,00` se o total for menor que R$ 10, para exercitar o `amount_mismatch`).
- Os botões chamam `POST /dev/payments/simulate`, que passa pelo **mesmo** tratamento de notificação do webhook real (mesma máquina de estados, mesma deduplicação, mesmos movimentos de estoque). Também dá para chamar à mão:

  ```bash
  curl -X POST http://localhost:3333/dev/payments/simulate \
    -H 'Content-Type: application/json' \
    -d '{"orderId":"<id do pedido>","status":"approved"}'
  ```

  `status` aceita `approved`, `pending`, `in_process`, `authorized`, `rejected`, `cancelled`, `refunded`, `charged_back` e `in_mediation`; `amountCents` e `paymentId` são opcionais.

- Os pagamentos simulados ficam em memória: reiniciar a API os esquece (os pedidos continuam no banco).
- Essa rota **só existe com o gateway fake**; com `mercadopago` ela dá 404.
- **Produção recusa o fake**: com `NODE_ENV=production` e `PAYMENT_PROVIDER=fake` a API não sobe, a menos que `ALLOW_FAKE_PAYMENTS=true` (então apenas avisa em log).

### Modo Mercado Pago (planejado, ainda não verificado)

> **Aviso:** o código do gateway do Mercado Pago (Preference, consulta do pagamento e validação da assinatura do webhook com o SDK oficial) existe e é coberto por testes com o SDK simulado, mas o **teste ponta a ponta com o Mercado Pago de verdade é a tarefa T22 e ainda não foi feito**. O que segue são instruções do que se pretende fazer, não um resultado verificado. Os nomes de menus do painel do Mercado Pago podem diferir.

Use **somente credenciais de teste**, nunca as de produção, e não versione nenhum valor real.

1. No painel de desenvolvedores do Mercado Pago, crie uma aplicação do Checkout Pro e pegue o **Access Token de teste**. Para pagar, use as contas e os cartões de teste da própria documentação do Mercado Pago.
2. Exponha a API local com um túnel HTTPS, por exemplo `ngrok http 3333`. A API só envia `notification_url` (e `auto_return`) ao Mercado Pago quando as URLs são HTTPS.
3. Configure a API (`apps/api/.env`):

   ```bash
   PAYMENT_PROVIDER=mercadopago
   MP_ACCESS_TOKEN=<access token de TESTE>
   MP_WEBHOOK_SECRET=<assinatura secreta do webhook, do painel>
   API_PUBLIC_URL=https://<seu-túnel>.ngrok-free.app
   WEB_URL=http://localhost:5173
   ```

4. No painel, cadastre a URL do webhook como `<API_PUBLIC_URL>/webhooks/mercadopago`, assine o evento de **pagamentos** e copie o segredo de assinatura para `MP_WEBHOOK_SECRET`. Sem esse segredo a rota do webhook nem é registrada.
5. Faça uma compra: o checkout cria a Preference (`external_reference` = id do pedido, itens em reais, expira em 30 minutos, `back_urls` para `WEB_URL/pedido/:id`), o cliente paga no Mercado Pago e o webhook atualiza o pedido. A página do pedido ignora os parâmetros que o Mercado Pago anexa ao retorno e mostra só o status que vem da API.

O webhook valida a assinatura (`401 INVALID_SIGNATURE` se falhar), **busca o pagamento no provedor** em vez de confiar no corpo e responde `200` para notificações que não são de pagamento. Um erro de provedor vira `5xx`, para o Mercado Pago reenviar.

## Endpoints da API

Envelope: sucesso `{ "data": ... }`; erro `{ "error": { "code", "message", "details?" } }`, com um `code` de uma lista fechada (`ErrorCode`, em `packages/contracts`). As mutações (`POST`, `PATCH`, `PUT`, `DELETE`) de `/auth/*` e `/admin/*` exigem os headers `X-Requested-With: bancada-web` e `Content-Type: application/json` (senão `403 CSRF_REJECTED`, D15). Dinheiro trafega sempre em centavos.

| Método  | Rota                           | Auth                   | Descrição                                                                                                                                                                                                          |
| ------- | ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`   | `/health`                      | pública                | `200`; `500` se o banco estiver fora.                                                                                                                                                                              |
| `GET`   | `/products`                    | pública                | Produtos ativos, com `imageUrl`.                                                                                                                                                                                   |
| `GET`   | `/products/:id`                | pública                | `200`, ou `404` (inclusive produto inativo ou id que não é UUID).                                                                                                                                                  |
| `POST`  | `/orders`                      | pública                | Cria o pedido. Exige o header `Idempotency-Key`. `201` criado, `200` replay, `400`, `409 OUT_OF_STOCK`, `409 IDEMPOTENCY_KEY_REUSED`, `422 PRODUCT_UNAVAILABLE`, `502 CHECKOUT_UNAVAILABLE`.                       |
| `GET`   | `/orders/:id`                  | pública                | Acompanhamento. Resposta pública: sem nome nem e-mail do cliente; `checkoutUrl` só enquanto `PENDING`.                                                                                                             |
| `POST`  | `/webhooks/mercadopago`        | assinatura do provedor | Notificação de pagamento (só existe com `PAYMENT_PROVIDER=mercadopago`). `200`, `401 INVALID_SIGNATURE`; um erro `5xx` faz o Mercado Pago reenviar.                                                                |
| `POST`  | `/dev/payments/simulate`       | nenhuma                | Simula um pagamento. Só existe com `PAYMENT_PROVIDER=fake`.                                                                                                                                                        |
| `POST`  | `/auth/login`                  | pública                | `{ email, password }`. Grava o cookie `bancada_admin` (`httpOnly`) e devolve o admin. `401 INVALID_CREDENTIALS` (mesma resposta para e-mail inexistente e senha errada), `429 RATE_LIMITED` (5 por minuto por IP). |
| `POST`  | `/auth/logout`                 | pública                | Limpa o cookie.                                                                                                                                                                                                    |
| `GET`   | `/auth/me`                     | admin                  | Admin logado, ou `401`.                                                                                                                                                                                            |
| `GET`   | `/admin/products`              | admin                  | Todos os produtos, inclusive inativos. Filtros `?q=` (nome) e `?active=`.                                                                                                                                          |
| `GET`   | `/admin/products/:id`          | admin                  | Detalhe e as últimas 20 movimentações de estoque.                                                                                                                                                                  |
| `POST`  | `/admin/products`              | admin                  | Cria o produto (`name`, `description`, `category`, `priceCents`, `initialStock`, `imageKey?`). `201`, `409 SLUG_TAKEN`. Corpo estrito: campo desconhecido dá `400`.                                                |
| `PATCH` | `/admin/products/:id`          | admin                  | Edita dados, preço, `active` e imagem (`imageKey`: ausente mantém, `null` remove, texto troca). Não altera estoque nem slug.                                                                                       |
| `POST`  | `/admin/products/:id/stock`    | admin                  | Ajuste de estoque: `{ delta (inteiro diferente de 0), reason: 'restock' \| 'adjustment', note? }`. `409 INVALID_STOCK_ADJUSTMENT` se ficaria negativo.                                                             |
| `POST`  | `/admin/uploads/product-image` | admin                  | `{ contentType }` (`image/jpeg`, `image/png` ou `image/webp`) devolve `{ uploadUrl, fields, key }` para o presigned POST. `400 INVALID_FILE_TYPE`.                                                                 |
| `GET`   | `/admin/orders`                | admin                  | Pedidos paginados (`?status=&page=`, 20 por página, mais recentes primeiro). É o único lugar com dados do cliente, e traz `cancellable` calculado no servidor.                                                     |
| `POST`  | `/admin/orders/:id/cancel`     | admin                  | Cancela um pedido `PENDING` criado há mais de 30 minutos e devolve o estoque. `404`, `409 ORDER_NOT_CANCELLABLE`.                                                                                                  |

As rotas de `/admin` exigem o cookie do admin (`401 UNAUTHORIZED` sem ele).

## Testes e CI

```bash
npm test                      # contracts (Jest), API (Jest) e web (Vitest)
npm test -w @bancada/api      # só a API
npm run lint                  # ESLint na raiz
npm run format:check          # Prettier
npm run typecheck             # compila o contracts e roda o tsc de todos os workspaces
npm run build                 # build de tudo
```

**API.** Os testes rodam contra um PostgreSQL **real**, sem mock de banco, no banco de `TEST_DATABASE_URL` (padrão `postgres://bancada:bancada@localhost:5432/bancada_test`). O `globalSetup` cria o banco se não existir, recria o schema e roda as migrações; cada teste faz `TRUNCATE` e semeia de novo. Ele recusa qualquer banco cujo nome não termine em `_test`, para nunca apagar dados reais. Os testes de integração do S3 usam o MinIO real: sem ele **pulam com um aviso**, e com `REQUIRE_MINIO=true` **falham** (o CI define essa variável):

```bash
docker compose up -d db minio minio-init
REQUIRE_MINIO=true npm test
```

O que eles cobrem (entre outras coisas): total com o preço do banco, replay e concorrência da mesma `Idempotency-Key` (um só pedido), 6 pedidos simultâneos para 3 unidades (exatamente 3 dão certo), falha do gateway seguida de retry sem duplicar, webhook (aprovado, recusado e depois aprovado, cancelado com devolução, estorno sem devolução, duplicado, valor adulterado, transição inválida, assinatura válida e inválida, e uma regressão de deadlock com notificações simultâneas), login com a mesma resposta para e-mail inexistente e senha errada, rate limit do login, CSRF, ajustes do admin concorrentes com pedidos (estoque final igual à soma dos movimentos), cancelamento manual e o upload.

**Web.** Vitest com Testing Library: formulários, carrinho, checkout, página do pedido com polling, `RequireAdmin`, upload e telas do admin. Não há teste de ponta a ponta em navegador nem teste automático de contraste.

**CI (GitHub Actions).**

- `CI` (`.github/workflows/ci.yml`): a cada push na `main` e em pull request, com um PostgreSQL como _service_: `npm ci`, build do contracts, lint, `format:check`, typecheck, sobe o MinIO pelo `docker-compose.yml` (o que também prova o `minio` e o `minio-init`), `npm test` com `REQUIRE_MINIO=true` e build.
- `Docker` (`.github/workflows/docker.yml`, D33): sobe a stack inteira com `docker compose up --build` e confere com `curl` a API e o seed (inclusive que um preço editado sobrevive ao restart), a loja (fallback de SPA, cache e gzip), o admin (criar admin pelo script, login, cookie `httpOnly` e CORS) e o upload de imagem direto ao MinIO. Roda no push na `main`, em pull requests que mexem em `apps/api`, `apps/web`, `packages` ou na infra de Docker, e sob demanda (aba Actions, "Run workflow").

## Próximos passos

Limitações conhecidas de hoje e o que viria depois.

**Pedidos e pagamento**

- **Expiração automática de pedidos por job.** Hoje um pedido abandonado segue `PENDING` e **segura o estoque** até o admin cancelá-lo (só é possível depois de 30 minutos). A Preference do Mercado Pago já expira sozinha em 30 minutos. Um job que cancele os pedidos vencidos devolveria o estoque sem intervenção (D14, D28g).
- **Cobrança em dobro.** Um segundo pagamento aprovado (com outro `payment_id`) num pedido já pago vira `no_change` com um alerta em log; não há estorno automático (D20d).
- **Teste com o Mercado Pago real** (T22) e **deploy** (T23) ainda não foram feitos.

**Estoque e admin**

- **Idempotência no ajuste de estoque do admin.** O endpoint não tem chave de idempotência: numa falha de rede, repetir às cegas poderia ajustar duas vezes. A tela manda conferir o histórico antes de repetir (D32a).
- **Autoria só no estoque.** Só o estoque tem livro-razão; edições de preço e de `active` não registram quem as fez (D22g).
- **Janela de 30 minutos.** `created_at` vem do relógio do banco e o "agora" do Node; uma diferença de segundos entre eles desloca a janela do cancelamento (D22e).

**Imagens**

- **Limpeza de imagens órfãs no S3.** Trocar ou remover a imagem de um produto, ou enviar uma imagem e não salvar, deixa o arquivo antigo no bucket (D16, D31d).
- **Tamanho mínimo de upload.** A política do presigned POST aceita de 0 a 2 MB: o servidor aceita um arquivo de 0 byte (o web já o recusa) e não valida o conteúdo real, só o tipo declarado e o tamanho (D23b).
- **Existência do objeto.** Ao salvar o produto a API não confere se o objeto de fato está no bucket (D23g).
- **Credenciais fixas do S3** são obrigatórias em produção, o que impede usar uma IAM role (D23f).

**Autenticação e infraestrutura**

- **Revogação de JWT no logout.** O JWT é _stateless_: o logout limpa o cookie, mas um token copiado vale até expirar (8 h) (D21d).
- **`TRUST_PROXY=1` atrás de ALB ou App Runner.** O padrão é `false`; sem configurar, todos os clientes compartilham o IP do proxy no rate limit do login (D21c).
- **Senha do `admin:create` por variável de ambiente.** `--password` na linha de comando fica no histórico do shell (D21e).
- **CSP do nginx.** A Content-Security-Policy da imagem do web está em modo `Report-Only` e sem endpoint de relatório; promovê-la a `Content-Security-Policy` (enforce) fica para depois (D33f).
- **CORS sem `maxAge`.** O `X-Requested-With` em toda requisição força um preflight a cada chamada; avaliar `maxAge` na API (D26f).

**Antes de tornar o repositório público**

- **Fontes da Fontshare.** Clash Grotesk e General Sans estão versionadas em `apps/web/src/assets/fonts` (self-host). A licença (FFL) permite uso no próprio site, mas **proíbe redistribuir os arquivos**, e um repositório público os distribui. Antes disso, tirar os `.woff2` do repositório (e do histórico) e baixá-los no build, ou trocar por fontes com licença livre (D27f, `apps/web/src/assets/fonts/README.md`).
- **Credencial de dev no `.env.example`.** O `apps/api/.env.example` guarda a senha do admin de desenvolvimento (`ADMIN_DEV_PASSWORD`); num repositório público, trocar por um valor fictício (D30g).

## Estrutura do monorepo

```text
bancada/
├── apps/
│   ├── api/                  Express + TypeScript + PostgreSQL
│   │   ├── src/config/       variáveis de ambiente validadas com Zod
│   │   ├── src/db/           pool, runner de migrações, migrações .sql e seed
│   │   ├── src/modules/      products, orders, payments, stock, auth, admin e storage
│   │   ├── src/shared/       erros, helpers HTTP, slug e proteção CSRF
│   │   ├── src/scripts/      create-admin
│   │   ├── test/             testes (Jest + Supertest, contra o Postgres real)
│   │   ├── Dockerfile e docker-entrypoint.sh
│   │   └── .env.example
│   └── web/                  React + Vite (loja e admin)
│       ├── src/features/     catalog, cart, checkout, orders e admin
│       ├── src/components/   layout, botões, imagem do produto, diálogo de confirmação
│       ├── Dockerfile e nginx.conf
│       └── .env.example
├── packages/
│   └── contracts/            schemas Zod e tipos compartilhados entre API e web
├── docs/screenshots/         imagens deste README
├── docker-compose.yml        db, minio, minio-init, api e web
├── .github/workflows/        ci.yml e docker.yml
└── ARCHITECTURE.md, ROADMAP.md, CLAUDE.md
```

A API e o web importam o `contracts`; o `contracts` não importa nada dos apps, e a API e o web nunca importam um do outro. O [ARCHITECTURE.md](ARCHITECTURE.md) é a fonte da verdade (fluxos, modelo de dados, decisões) e o [ROADMAP.md](ROADMAP.md) registra o andamento das tarefas.

## Licença e fontes

Este repositório ainda não define uma licença.

- **Clash Grotesk** e **General Sans** (Fontshare / Indian Type Foundry) estão sob a ITF Free Font License (FFL): uso permitido no próprio site, redistribuição dos arquivos proibida. Os `.woff2` oficiais estão em `apps/web/src/assets/fonts`, junto da licença (`LICENSE-Fontshare-FFL.txt`). Veja o aviso em [Próximos passos](#próximos-passos) antes de tornar o repositório público.
- **JetBrains Mono** vem do pacote `@fontsource-variable/jetbrains-mono` (SIL Open Font License 1.1).
