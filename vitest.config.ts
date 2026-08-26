import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'test/unit/**/*.test.ts',
      'test/integration/**/*.test.ts',
      'test/golden/**/*.test.ts',
      'test/cli/**/*.test.ts',
      'test/helpers/**/*.test.ts',
    ],
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 15_000,
  },
});
