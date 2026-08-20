// SEA 打包脚本：
//   1. esbuild 把 CLI（含 Ink TUI）打成单个 CJS 文件（SEA 要求 CommonJS main）
//   2. 两个插件消掉依赖里的 top-level await（CJS 不允许）：
//      - yoga-layout：替换为同步 instantiateWasm 钩子版入口（base64 从胶水文件提取）
//      - ink reconciler：去掉 DEV=true 分支里对可选包 react-devtools-core 的动态导入
//   3. 后续由 node --experimental-sea-config + postject 注入各平台 node 二进制（见 CI）
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const yogaDir = resolve(root, "node_modules/yoga-layout/dist");

// 从 Emscripten 胶水里抠出内嵌的 base64 wasm
const glue = await readFile(resolve(yogaDir, "binaries/yoga-wasm-base64-esm.js"), "utf8");
const match = /data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)/.exec(glue);
if (!match) throw new Error("yoga 胶水里找不到内嵌 base64 wasm（上游升级了打包方式？）");
const wasmBase64 = match[1];

// 同步版 yoga 入口：Emscripten 工厂把传入对象当作 Module 本体（h = loadYoga），
// 同步 instantiateWasm 钩子让 ready 在工厂返回前就完成，从而避免 top-level await。
const yogaSyncShim = `
import loadYogaImpl from "../binaries/yoga-wasm-base64-esm.js";
import wrapAssembly from "./wrapAssembly.js";
import YGEnums from "./generated/YGEnums.js";
const WASM_BASE64 = ${JSON.stringify(wasmBase64)};
const mod = {
  instantiateWasm(imports, receiveInstance) {
    const bytes = Buffer.from(WASM_BASE64, "base64");
    const compiled = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(compiled, imports);
    receiveInstance(instance, compiled);
    return instance.exports;
  },
};
loadYogaImpl(mod);
const Yoga = wrapAssembly(mod);
export default Yoga;
export * from "./generated/YGEnums.js";
`;

const yogaPlugin = {
  name: "yoga-sync",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^yoga-layout$/ }, () => ({
      path: resolve(yogaDir, "src/index.js"),
      namespace: "yoga-sync",
    }));
    pluginBuild.onLoad({ filter: /.*/, namespace: "yoga-sync" }, () => ({
      contents: yogaSyncShim,
      resolveDir: resolve(yogaDir, "src"),
      loader: "js",
    }));
  },
};

const inkDevtoolsPlugin = {
  name: "ink-devtools-drop",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /ink[\\/]build[\\/]reconciler\.js$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      // DEV=true 专属分支，运行时永不执行；去掉以满足 CJS 的无 top-level await 限制
      const patched = source.replace(/await import\(['"]\.\/devtools\.js['"]\);/u, ";");
      if (patched === source) throw new Error("ink reconciler 里没找到 devtools 动态导入（上游升级了？）");
      return { contents: patched, loader: "js" };
    });
  },
};

await build({
  entryPoints: [resolve(root, "src/sea-entry.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  outfile: resolve(root, "dist-sea/sea-entry.cjs"),
  // ink 的 devtools 分支依赖可选包 react-devtools-core；仅 DEV=true 时执行，
  // 标记 external，运行时不会触发。
  external: ["react-devtools-core"],
  plugins: [yogaPlugin, inkDevtoolsPlugin],
});

console.log("SEA bundle written to dist-sea/sea-entry.cjs");
