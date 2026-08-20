// Node SEA（单文件可执行）专用入口：标记后异步加载 CLI，避免 cli.ts 的
// 直跑判断在打包成单文件后误触发或因 __filename 缺失而崩溃。
(globalThis as { ATD_SEA?: boolean }).ATD_SEA = true;

void import("./cli.js").then(({ main }) => main()).then((code) => {
  process.exitCode = code;
}, (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
