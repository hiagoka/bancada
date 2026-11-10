#!/bin/sh
# Ponto de entrada da imagem da API (ARCHITECTURE.md, seção 10: "no start roda as migrações").
# 1) migra (idempotente; falhou, o container não sobe); 2) semeia só se SEED_ON_START=true (o seed
# nunca sobrescreve produtos existentes, D17); 3) troca este shell pelo servidor (node vira o PID 1
# e recebe o SIGTERM do `docker stop`).
set -e

node dist/db/migrate.cli.js

if [ "$SEED_ON_START" = "true" ]; then
  node dist/db/seed.cli.js
fi

exec node dist/server.js
