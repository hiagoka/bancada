/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  watchman: false,
  // Todos os testes compartilham um único banco: um arquivo por vez.
  maxWorkers: 1,
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: {
    '^@bancada/contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
