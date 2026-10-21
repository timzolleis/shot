import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['packages/*/test/**/*.test.ts', 'plugins/*/test/**/*.test.ts'], testTimeout: 60_000 },
})
