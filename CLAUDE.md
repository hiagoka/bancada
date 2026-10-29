# Bancada

Leia `ARCHITECTURE.md` (fonte da verdade) antes de qualquer tarefa. O andamento fica em `ROADMAP.md`.

- Trabalhe só na tarefa atribuída.
- Se a tarefa contradisser o `ARCHITECTURE.md`, pare e pergunte; não improvise.
- Mudança de arquitetura só registrando uma nova decisão (seção 13).

## Regras inegociáveis

- Preço sempre vem do banco; o preço enviado pelo cliente é ignorado.
- Dinheiro sempre em centavos (INTEGER).
- SQL sempre parametrizado, sem ORM.
- Webhook nunca confia no corpo: reconsulta o provedor de pagamento.
- Toda mudança de estoque passa por `applyStockMovement`; ninguém faz UPDATE direto em `products.stock`.
- Resposta pública de pedido nunca contém dados do cliente (`publicOrderSchema`).
- Mutações em `/auth/*` e `/admin/*` exigem `X-Requested-With: bancada-web` (CSRF, D15).
- Sem `any` (TypeScript strict).
- Sem segredos commitados (.env, credenciais); logs com Pino, nunca `console.log`.
- Pronto = typecheck, lint e testes verdes.

## Commits

- Faça o máximo de commits pequenos e coesos possível: um por passo lógico (migração, repositório, rota, testes, componente, documentação), nunca um commit único gigante por tarefa.
- Cada commit deve deixar o projeto compilando e com os testes verdes.
- Conventional Commits em pt-BR, sem `Co-Authored-By`.
- Branch por tarefa (`feat/tNN-...`), com merge fast-forward na `main`.
