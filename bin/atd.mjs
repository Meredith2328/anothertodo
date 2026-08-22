#!/usr/bin/env node
const { main } = await import("../dist-node/cli.js");
process.exitCode = await main(process.argv.slice(2));
