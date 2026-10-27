import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Explicit opt-in integration suite; ordinary browser-only unit tests do not require Rust.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    include: ['tests/workspace-native/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
