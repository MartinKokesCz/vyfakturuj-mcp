#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VyfakturujClient } from "./client.js";
import { loadConfig } from "./config.js";
import { getSpec } from "./spec.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (!config.email || !config.apiKey) {
    console.error(
      "[vyfakturuj-mcp] VYFAKTURUJ_EMAIL / VYFAKTURUJ_API_KEY nejsou nastavené — " +
        "nástroje se registrují, ale každé volání API skončí chybou.",
    );
  }

  const server = new McpServer(
    { name: "vyfakturuj", version: "0.1.0" },
    {
      instructions:
        "Přístup k fakturačnímu API Vyfakturuj.cz (v2): doklady, kontakty, šablony a nastavení účtu. " +
        "Před vytvořením či editací dokladu si vyžádej pole nástrojem describe_schema. " +
        "Odeslání e-mailu je ve výchozím stavu jen náhled (test=true) — skutečné odeslání vyžaduje test=false. " +
        "Mazací nástroje volej pouze na výslovný pokyn uživatele.",
    },
  );

  // Client construction is deferred so a missing API key surfaces as a tool error,
  // not as a failed MCP handshake.
  let client: VyfakturujClient | undefined;
  registerTools(server, {
    readOnly: config.readOnly,
    getClient: () => (client ??= new VyfakturujClient(config)),
  });

  // Fail fast on a corrupt bundled spec rather than on the first tool call.
  getSpec();

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error("[vyfakturuj-mcp] fatal:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
