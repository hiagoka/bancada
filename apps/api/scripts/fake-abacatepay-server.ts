// Servidor HTTP FALSO da AbacatePay, executável à mão. SÓ PARA DESENVOLVIMENTO: não entra no build
// de produção (o tsconfig.build só compila src/) nem na imagem Docker (só dist/ é copiado).
//
//   npm run dev:fake-abacatepay -w @bancada/api
//
// Escuta em 127.0.0.1:4010 (ABACATEPAY_FAKE_PORT troca a porta) e imita a API da AbacatePay para
// testar o pagamento por Pix no navegador SEM chave real. Rode a API apontando para ele:
//
//   PAYMENT_PROVIDER=abacatepay \
//   ABACATEPAY_API_URL=http://127.0.0.1:4010/v2 \
//   ABACATEPAY_API_KEY=abc_dev_local \
//   ABACATEPAY_WEBHOOK_SECRET=<32+ caracteres de teste, o MESMO valor aqui> \
//   npm run dev -w @bancada/api
//
// Para "pagar" um pedido (o QR Code deste servidor NÃO é escaneável, é um PNG de desenvolvimento):
//
//   curl -X POST http://127.0.0.1:4010/__pay/<id da cobrança, pix_char_...>
//
// O id aparece no log da API ("Cobrança criada no provedor") e em orders.checkout_id. O servidor
// marca a cobrança como PAID e ENTREGA o webhook transparent.completed na API
// (ABACATEPAY_FAKE_WEBHOOK_URL, padrão http://127.0.0.1:3333/webhooks/abacatepay) com
// X-Webhook-Secret (ABACATEPAY_WEBHOOK_SECRET do ambiente) e X-Webhook-Signature (HMAC-SHA256 do
// corpo cru, com o mesmo módulo de assinatura da API). A página do pedido vira "Pago" sozinha.
import { DEFAULT_FAKE_WEBHOOK_URL, startFakeAbacatePay } from './fake-abacatepay.js';

const port = Number(process.env.ABACATEPAY_FAKE_PORT ?? 4010);
const webhookUrl = process.env.ABACATEPAY_FAKE_WEBHOOK_URL ?? DEFAULT_FAKE_WEBHOOK_URL;
const webhookSecret = process.env.ABACATEPAY_WEBHOOK_SECRET || undefined;

const server = await startFakeAbacatePay({
  port,
  host: '127.0.0.1',
  webhookUrl,
  webhookSecret,
  strict: true,
});

const out = (line: string): void => void process.stdout.write(`${line}\n`);
out('AbacatePay FALSA (desenvolvimento) no ar');
out(`  API:      ${server.url}   (ABACATEPAY_API_URL)`);
out(`  Pagar:    POST ${server.origin}/__pay/<id da cobrança>`);
out(`  Webhook:  ${webhookUrl}`);
if (!webhookSecret) {
  out('  ATENÇÃO:  ABACATEPAY_WEBHOOK_SECRET não está definido: o /__pay vai responder 500.');
}

function shutdown(): void {
  void server.close().then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
