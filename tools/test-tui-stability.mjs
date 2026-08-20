import { execa } from "execa";

const count = Number(process.argv[2] ?? 20);
if (!Number.isInteger(count) || count < 1) throw new Error("usage: node tools/test-tui-stability.mjs <positive count>");
for (let index = 1; index <= count; index += 1) {
  console.log(`\n[TUI stability ${index}/${count}]`);
  const result = await execa("npx", ["vitest", "run", "tests/tui.integration.test.tsx"], { stdio: "inherit", reject: false });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}
console.log(`\nTUI stability passed ${count}/${count}`);
