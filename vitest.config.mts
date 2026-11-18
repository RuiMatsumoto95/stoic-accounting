import { defineConfig } from 'vitest/config'

// 純粋関数のテスト用。React コンポーネントを試すときは jsdom と @vitejs/plugin-react を足す
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
})
