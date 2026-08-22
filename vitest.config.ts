import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: false,
    // 界面语言锁成中文：不少断言比对的是中文分组名和日期列，而 detectLang()
    // 会读 LANG / LC_ALL。macOS runner 是 en_US.UTF-8，Windows runner 没有 LANG，
    // Ubuntu 是 C.UTF-8——不锁死就会「换台机器跑就红」。
    // 想验英文，用 tests/i18n.test.ts 里的 setLang("en")，那是显式切换。
    env: { ATD_LANG: "zh_CN.UTF-8" },
    // CLI end-to-end 测试需要 spawn 子进程，CI 上偶发超过默认 5000ms；
    // 文件锁竞争测试在高并发 runner 上偶发 flaky，重试一次兜底。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 1,
  },
});
