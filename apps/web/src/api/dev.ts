import { simulatePaymentInputSchema, type SimulatePaymentInput } from '@bancada/contracts';
import { z } from 'zod';
import { request } from './http';

// O servidor pode ganhar outcomes novos: o web aceita qualquer texto e tem mensagem padrão.
const simulationResultSchema = z.object({ outcome: z.string() });
export type SimulationResult = z.infer<typeof simulationResultSchema>;

// POST /dev/payments/simulate: SÓ existe com PAYMENT_PROVIDER=fake (com um provedor real a rota não
// existe e a API responde 404). O corpo é validado com o mesmo schema da API antes de sair.
export async function simulatePayment(input: SimulatePaymentInput): Promise<SimulationResult> {
  const body = simulatePaymentInputSchema.parse(input);
  return request('/dev/payments/simulate', {
    method: 'POST',
    body: {
      orderId: body.orderId,
      status: body.status,
      ...(body.amountCents === undefined ? {} : { amountCents: body.amountCents }),
    },
    schema: simulationResultSchema,
  });
}
