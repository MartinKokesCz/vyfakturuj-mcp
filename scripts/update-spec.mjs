#!/usr/bin/env node
// Refreshes the bundled OpenAPI document from the live Vyfakturuj.cz docs.
// Usage: npm run update-spec
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SPEC_URL = "https://api.vyfakturuj.cz/webroot/openapi/vyfakturuj.json";
const TARGET = fileURLToPath(new URL("../openapi/vyfakturuj.json", import.meta.url));

const response = await fetch(SPEC_URL, { headers: { Accept: "application/json" } });
if (!response.ok) {
  console.error(`Stažení specifikace selhalo: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const spec = await response.json();
const paths = Object.keys(spec.paths ?? {}).length;
const schemas = Object.keys(spec.components?.schemas ?? {}).length;

writeFileSync(TARGET, `${JSON.stringify(spec, null, 2)}\n`);
console.log(
  `Uloženo ${TARGET}\nAPI ${spec.info?.title ?? "?"} v${spec.info?.version ?? "?"} — ${paths} cest, ${schemas} schémat.`,
);
