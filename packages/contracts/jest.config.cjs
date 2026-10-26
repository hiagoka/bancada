/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  watchman: false,
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};
