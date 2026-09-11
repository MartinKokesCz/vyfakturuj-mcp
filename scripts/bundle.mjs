#!/usr/bin/env node
// Builds a double-clickable Claude Desktop bundle (.mcpb).
//
//   npm run bundle   ->   build/vyfakturuj.mcpb
//
// The server is bundled into a single ESM file with esbuild, so the .mcpb
// carries no node_modules and stays small.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const stage = `${root}build/bundle`;
const output = `${root}build/vyfakturuj.mcpb`;

const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
const manifest = JSON.parse(readFileSync(`${root}manifest.json`, "utf8"));

if (pkg.version !== manifest.version) {
  console.error(
    `Verze se neshodují: package.json ${pkg.version} vs manifest.json ${manifest.version}.`,
  );
  process.exit(1);
}

const entryPoint = manifest.server.entry_point;

rmSync(`${root}build`, { recursive: true, force: true });
mkdirSync(`${stage}/openapi`, { recursive: true });

run("npx", [
  "esbuild",
  `${root}src/index.ts`,
  "--bundle",
  "--platform=node",
  "--target=node18",
  "--format=esm",
  "--minify",
  `--outfile=${stage}/${entryPoint}`,
]);

copyFileSync(`${root}openapi/vyfakturuj.json`, `${stage}/openapi/vyfakturuj.json`);
copyFileSync(`${root}manifest.json`, `${stage}/manifest.json`);
copyFileSync(`${root}README.md`, `${stage}/README.md`);

// Marks the bundled output as ESM for Node versions without module autodetection.
writeFileSync(
  `${stage}/package.json`,
  `${JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", private: true }, null, 2)}\n`,
);

run("npx", ["mcpb", "validate", `${stage}/manifest.json`]);
run("npx", ["mcpb", "pack", stage, output]);

console.log(`\nHotovo: ${output}\nDvojklik na soubor nainstaluje rozšíření do Claude Desktop.`);

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
