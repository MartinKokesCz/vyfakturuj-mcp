import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface OpenApiSpec {
  info?: { title?: string; version?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, JsonSchema> };
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: unknown;
  responses?: unknown;
}

export type JsonSchema = Record<string, unknown>;

const SPEC_PATH = fileURLToPath(new URL("../openapi/vyfakturuj.json", import.meta.url));

let cached: OpenApiSpec | undefined;

/** The bundled OpenAPI document; refresh it with `npm run update-spec`. */
export function getSpec(): OpenApiSpec {
  if (!cached) {
    cached = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiSpec;
  }
  return cached;
}

export function schemaNames(): string[] {
  return Object.keys(getSpec().components?.schemas ?? {}).sort();
}

/**
 * Returns a component schema together with every other component it references,
 * so the caller sees a self-contained description without resolving $refs itself.
 */
export function describeSchema(name: string): {
  schema: JsonSchema;
  referenced: Record<string, JsonSchema>;
} {
  const schemas = getSpec().components?.schemas ?? {};
  const schema = schemas[name];
  if (!schema) {
    throw new Error(`Neznámé schéma "${name}". Dostupná: ${schemaNames().join(", ")}`);
  }

  const referenced: Record<string, JsonSchema> = {};
  const queue: unknown[] = [schema];
  while (queue.length > 0) {
    for (const ref of collectRefs(queue.pop())) {
      if (ref === name || referenced[ref]) continue;
      const target = schemas[ref];
      if (!target) continue;
      referenced[ref] = target;
      queue.push(target);
    }
  }

  return { schema, referenced };
}

function collectRefs(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
    return found;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "$ref" && typeof value === "string") {
        const name = value.split("/").pop();
        if (name) found.add(name);
        continue;
      }
      collectRefs(value, found);
    }
  }
  return found;
}

/** Compact "field: type — description" listing used in tool descriptions and docs. */
export function fieldSummary(name: string, limit = 200): string[] {
  const schema = getSpec().components?.schemas?.[name];
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((schema?.required as string[] | undefined) ?? []);

  return Object.entries(properties)
    .slice(0, limit)
    .map(([field, definition]) => {
      const type = (definition.type as string) ?? (definition.$ref ? "object" : "any");
      const description = String(definition.description ?? "").replace(/\s+/g, " ").trim();
      return `${field}${required.has(field) ? "*" : ""}: ${type}${description ? ` — ${description}` : ""}`;
    });
}
