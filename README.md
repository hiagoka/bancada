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

![Catálogo da Bancada: grade assimétrica de produtos com preço em fonte monoespaçada e selos de estoque baixo](docs/screenshots/01-catalogo.jpg)

_Catálogo, com selo de estoque baixo e produtos sem imagem mostrando o ícone da categoria._

![Carrinho com a lista de itens, controle de quantidade limitado ao estoque e o total](docs/screenshots/02-carrinho.jpg)

_Carrinho persistente (sobrevive ao F5); a quantidade nunca passa do estoque._

![Formulário de checkout com nome, e-mail e o botão que mostra o valor a pagar](docs/screenshots/03-checkout.jpg)

_Checkout: o botão diz quanto será cobrado, e um duplo clique gera um pedido só._

![Página do pedido com o selo Pago, as etapas concluídas, os itens e o total](docs/screenshots/04-pedido-pago.jpg)

_Acompanhamento do pedido, que consulta a API a cada 3 s enquanto está pendente e vira "Pago" sozinho._

### Administração

![Tela de login do admin com os campos de e-mail e senha](docs/screenshots/05-admin-login.jpg)

_Login do admin (cookie `httpOnly`; e-mail inexistente e senha errada dão a mesma mensagem)._

![Lista de produtos do admin com imagem, preço, estoque e situação](docs/screenshots/06-admin-produtos.jpg)

_Lista de produtos, com busca por nome e filtro de situação._

![Edição de produto com o painel de estoque: ajuste com sinal e histórico de movimentações](docs/screenshots/07-admin-estoque.jpg)

_Painel de estoque: ajuste com sinal e o histórico (o livro-razão) das últimas movimentações._

![Lista de pedidos do admin com cliente, itens, total, situação e o botão Cancelar pedido](docs/screenshots/08-admin-pedidos.jpg)

_Pedidos, com filtro por situação; o botão "Cancelar pedido" só aparece quando o servidor diz que é possível._

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
| Deduplicação por `UNIQUE (provider, payment_id, status)`                                                                  | Cada combinação é processada uma única vez, então replays são inofensivos e a assinatura dispensa janela de tempo.                           | [D6](ARCHITECTURE.md)                          |
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
