#!/usr/bin/env node
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if ((process.env.ATD_ENGINE ?? "node").toLowerCase() === "python") {
  const python = process.env.ATD_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const child = spawn(python, ["-m", "atd.cli", ...args], { stdio: "inherit", env: process.env });
  child.on("error", (error) => { console.error(`无法启动 Python 回退：${error.message}`); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} else {
  const { main } = await import("../dist-node/cli.js");
  process.exitCode = await main(args);
}
