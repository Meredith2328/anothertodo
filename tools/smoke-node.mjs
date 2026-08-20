import { execa } from "execa";

const result = await execa(process.execPath, ["dist-node/cli.js", "--help"], { reject: false });
if (result.exitCode !== 0 || !result.stdout.includes("Usage: atd")) {
  console.error(result.stdout);
  console.error(result.stderr);
  process.exit(result.exitCode || 1);
}
console.log("Node CLI smoke passed: --help");
const wrapper = await execa(process.execPath, ["bin/atd.mjs", "--help"], { reject: false });
if (wrapper.exitCode !== 0 || !wrapper.stdout.includes("Usage: atd")) {
  console.error(wrapper.stdout);
  console.error(wrapper.stderr);
  process.exit(wrapper.exitCode || 1);
}
console.log("Default atd wrapper smoke passed: --help");
