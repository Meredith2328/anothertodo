import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: false,
    // CLI end-to-end 测试需要 spawn 子进程，CI 上偶发超过默认 5000ms；
    // 文件锁竞争测试在高并发 runner 上偶发 flaky，重试一次兜底。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 1,
  },
});
