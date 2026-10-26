// Prova que o pacote é importável pelo nome, como outro workspace faria
// (node_modules/@bancada/contracts -> exports -> dist). Exige o build antes.
import assert from 'node:assert/strict';
import { ErrorCode, publicOrderSchema } from '@bancada/contracts';

assert.ok(publicOrderSchema, 'publicOrderSchema deve ser exportado');
assert.ok(ErrorCode.options.includes('CSRF_REJECTED'), 'ErrorCode deve incluir CSRF_REJECTED');
