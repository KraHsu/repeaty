import { defineConfig } from 'vitest/config'

// Explicit opt-in integration suite; ordinary browser-only unit tests do not require Rust.
export default defineConfig({
  test: {
    include: ['tests/workspace-native/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
})
