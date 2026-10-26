// Copia os .sql para dist com Node (fs.cpSync): o projeto precisa rodar no Windows,
// então nada de cp/rsync/comandos Unix no build.
import { cpSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
cpSync(resolve(root, 'src/db/migrations'), resolve(root, 'dist/db/migrations'), {
  recursive: true,
});
