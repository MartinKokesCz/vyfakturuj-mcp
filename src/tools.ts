import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { QueryValue, VyfakturujClient } from "./client.js";
import { describeSchema, fieldSummary, getSpec, schemaNames } from "./spec.js";

export interface ToolContext {
  getClient(): VyfakturujClient;
  readOnly: boolean;
}

type Json = Record<string, unknown>;

const payload = z
  .record(z.string(), z.unknown())
  .describe(
    "Objekt s poli podle OpenAPI schématu. Seznam všech polí získáš nástrojem describe_schema.",
  );

/** Fields callers get wrong most often; the full list lives in describe_schema. */
const INVOICE_HINT = [
  "Klíčová pole: items* (pole položek: text*, unit_price*, quantity, unit, vat_rate),",
  "id_customer, customer_name, customer_IC, customer_DIC, customer_street, customer_city, customer_zip,",
  "type (1=faktura, 2=zálohová, 4=proforma), date_created, date_due, days_due, currency (ISO 4217),",
  "id_number_series, id_payment_method, VS, language (cs/sk/en), note_internal, text_before_items.",
  "Datumy ve tvaru YYYY-MM-DD. Úplný seznam 92 polí: describe_schema('InvoiceObject').",
].join(" ");

const CONTACT_HINT =
  "Klíčová pole: name, IC, DIC, firstname, lastname, street, city, zip, country_code, tel, mail_to, note. " +
  "Úplný seznam: describe_schema('ContactObject').";

const TEMPLATE_HINT =
  "Povinná pole: id_customer*, name*, type*, start_type*, end_type*, doc_items*. " +
  "Úplný seznam: describe_schema('TemplateObject').";

export function registerTools(server: McpServer, ctx: ToolContext): void {
  registerReadTools(server, ctx);
  if (!ctx.readOnly) {
    registerWriteTools(server, ctx);
  }
}

function registerReadTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "describe_schema",
    {
      title: "Popis schématu",
      description:
        "Vrátí úplné OpenAPI schéma objektu Vyfakturuj.cz (všechna pole, typy, povolené hodnoty) " +
        "včetně schémat, na která odkazuje. Zavolej před vytvořením nebo editací dokladu, kontaktu či šablony. " +
        `Dostupná schémata: ${schemaNames().join(", ")}.`,
      inputSchema: {
        name: z
          .string()
          .describe("Název schématu, např. InvoiceObject, ContactObject, TemplateObject."),
        fields_only: z
          .boolean()
          .optional()
          .describe("true = jen kompaktní seznam polí s popisem místo celého JSON schématu."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ name, fields_only }) =>
      run(() => {
        if (fields_only) {
          return { schema: name, fields: fieldSummary(name) };
        }
        const { schema, referenced } = describeSchema(name);
        return { schema: name, definition: schema, referenced };
      }),
  );

  server.registerTool(
    "api_info",
    {
      title: "Informace o API",
      description:
        "Vrátí verzi API, základní URL a přehled dostupných operací z přibalené OpenAPI specifikace.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      run(() => {
        const spec = getSpec();
        const operations: string[] = [];
        for (const [path, methods] of Object.entries(spec.paths ?? {})) {
          for (const [method, operation] of Object.entries(methods)) {
            if (!["get", "post", "put", "delete"].includes(method)) continue;
            operations.push(
              `${method.toUpperCase()} ${path.split("?")[0]} — ${operation.summary ?? operation.operationId ?? ""}`,
            );
          }
        }
        return {
          title: spec.info?.title,
          version: spec.info?.version,
          server: spec.servers?.[0]?.url,
          read_only_mode: ctx.readOnly,
          operations,
        };
      }),
  );

  server.registerTool(
    "list_invoices",
    {
      title: "Vyhledání faktur",
      description:
        "Vyhledá doklady (faktury, zálohové faktury, proformy…). Bez parametrů vrátí poslední doklady — " +
        "vždy omez počet přes rows_limit. Filtrování podle data přes date_created_from/date_created_to.",
      inputSchema: {
        q: z.string().optional().describe("Fulltextové hledání."),
        id_customer: z.number().int().optional().describe("ID kontaktu v adresáři."),
        id_tag: z.number().int().optional().describe("ID štítku."),
        id_number_series: z.number().int().optional().describe("ID číselné řady."),
        type: z
          .number()
          .int()
          .optional()
          .describe("Typ dokladu: 1=faktura, 2=zálohová faktura, 4=proforma (viz describe_schema)."),
        flags: z
          .number()
          .int()
          .optional()
          .describe("Bitové příznaky: 1=obsahuje DPH, 2=uhrazeno, 4=odesláno…"),
        number: z.string().optional().describe("Číslo dokumentu."),
        VS: z.string().optional().describe("Variabilní symbol."),
        currency: z.string().optional().describe("Měna (ISO 4217), např. CZK."),
        date_created_from: z.string().optional().describe("Datum vytvoření od (YYYY-MM-DD)."),
        date_created_to: z.string().optional().describe("Datum vytvoření do (YYYY-MM-DD)."),
        date_due: z.string().optional().describe("Datum splatnosti (YYYY-MM-DD)."),
        date_paid: z.string().optional().describe("Datum úhrady (YYYY-MM-DD)."),
        filter: z
          .string()
          .optional()
          .describe("BETA filtr {sloupec}~{operátor}~{hodnota}, více podmínek oddělených ';'."),
        sort: z.string().optional().describe("Řazení, např. '-date_created'."),
        rows_limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Počet záznamů (doporučeno ≤ 50)."),
        rows_offset: z.number().int().min(0).optional().describe("Offset pro stránkování."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      run(() =>
        ctx.getClient().request("GET", "invoice/", { query: args as Record<string, QueryValue> }),
      ),
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Detail faktury",
      description:
        "Vrátí jeden doklad včetně položek a URL na PDF / veřejnou stránku / online platbu.",
      inputSchema: { id: z.number().int().describe("ID dokladu.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => run(() => ctx.getClient().request("GET", `invoice/${id}/`)),
  );

  server.registerTool(
    "list_contacts",
    {
      title: "Vyhledání kontaktů",
      description: "Vyhledá kontakty v adresáři.",
      inputSchema: {
        q: z.string().optional().describe("Fulltextové hledání."),
        id: z.number().int().optional().describe("ID kontaktu."),
        IC: z.string().optional().describe("IČO."),
        DIC: z.string().optional().describe("DIČ."),
        name: z.string().optional().describe("Název v adresáři."),
        mail_to: z.string().optional().describe("E-mail kontaktu."),
        tel: z.string().optional().describe("Telefon."),
        sort: z.string().optional().describe("Řazení, např. 'name'."),
        rows_limit: z.number().int().min(1).max(500).optional().describe("Počet záznamů."),
        rows_offset: z.number().int().min(0).optional().describe("Offset pro stránkování."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) =>
      run(() =>
        ctx.getClient().request("GET", "contact/", { query: args as Record<string, QueryValue> }),
      ),
  );

  server.registerTool(
    "get_contact",
    {
      title: "Detail kontaktu",
      description: "Vrátí jeden kontakt z adresáře.",
      inputSchema: { id: z.number().int().describe("ID kontaktu.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => run(() => ctx.getClient().request("GET", `contact/${id}/`)),
  );

  server.registerTool(
    "get_template",
    {
      title: "Detail šablony / pravidelné faktury",
      description: "Vrátí šablonu nebo pravidelnou fakturu podle ID.",
      inputSchema: { id: z.number().int().describe("ID šablony.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => run(() => ctx.getClient().request("GET", `template/${id}/`)),
  );

  server.registerTool(
    "list_payment_methods",
    {
      title: "Platební metody",
      description: "Seznam platebních metod účtu (id_payment_method pro vystavení dokladu).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => run(() => ctx.getClient().request("GET", "settings/payment-method/")),
  );

  server.registerTool(
    "list_number_series",
    {
      title: "Číselné řady",
      description: "Seznam číselných řad účtu (id_number_series pro vystavení dokladu).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => run(() => ctx.getClient().request("GET", "settings/number-series/")),
  );

  server.registerTool(
    "list_tags",
    {
      title: "Štítky",
      description: "Seznam štítků účtu.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => run(() => ctx.getClient().request("GET", "settings/tags/")),
  );

  server.registerTool(
    "get_tag",
    {
      title: "Detail štítku",
      description: "Vrátí jeden štítek podle ID.",
      inputSchema: { id: z.number().int().describe("ID štítku.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) => run(() => ctx.getClient().request("GET", `settings/tag/${id}`)),
  );
}

function registerWriteTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "create_invoice",
    {
      title: "Vytvoření dokladu",
      description: `Vystaví nový doklad. ${INVOICE_HINT}`,
      inputSchema: { data: payload.describe(`Tělo dokladu (InvoiceObject). ${INVOICE_HINT}`) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ data }) => run(() => ctx.getClient().request("POST", "invoice/", { body: data })),
  );

  server.registerTool(
    "update_invoice",
    {
      title: "Editace dokladu",
      description: `Upraví existující doklad. Posílej jen měněná pole. ${INVOICE_HINT}`,
      inputSchema: {
        id: z.number().int().describe("ID dokladu."),
        data: payload.describe("Měněná pole dokladu (InvoiceObject)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, data }) =>
      run(() => ctx.getClient().request("PUT", `invoice/${id}/`, { body: data })),
  );

  server.registerTool(
    "delete_invoice",
    {
      title: "Smazání dokladu",
      description: "Nevratně smaže doklad. Používej jen na výslovný pokyn uživatele.",
      inputSchema: { id: z.number().int().describe("ID dokladu.") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => run(() => ctx.getClient().request("DELETE", `invoice/${id}/`)),
  );

  server.registerTool(
    "send_invoice_mail",
    {
      title: "Odeslání dokladu e-mailem",
      description:
        "Odešle doklad e-mailem. POZOR: pokud parametr test nezadáš, použije se test=true a e-mail se " +
        "NEODEŠLE — vrátí se jen náhled. Skutečné odeslání vyžaduje test=false.",
      inputSchema: {
        id: z.number().int().describe("ID dokladu."),
        subject: z
          .string()
          .optional()
          .describe("Předmět e-mailu; nezadáš-li ho, doplní se výchozí šablona účtu."),
        to: z.string().optional().describe("Adresáti oddělení čárkou. Prázdné = adresa z dokladu."),
        cc: z.string().optional().describe("Kopie."),
        bcc: z.string().optional().describe("Slepá kopie."),
        body: z.string().optional().describe("Text e-mailu."),
        type: z
          .number()
          .int()
          .optional()
          .describe("Typ e-mailu: 1=nový doklad, 2=upomínka, 3=doklad znovu."),
        pdfAttachment: z.boolean().optional().describe("Přiložit PDF dokladu."),
        test: z
          .boolean()
          .optional()
          .describe("true (výchozí) = jen náhled, neodešle se. false = e-mail se skutečně odešle."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, ...options }) =>
      run(() => {
        const body: Json = { ...options };
        if (body.test === undefined) body.test = true;
        if (body.subject === undefined) body.subject = "";
        return ctx.getClient().request("POST", `invoice/${id}/do/send-mail/`, { body });
      }),
  );

  server.registerTool(
    "mark_invoice_paid",
    {
      title: "Uhrazení dokladu",
      description: "Označí doklad jako uhrazený.",
      inputSchema: {
        id: z.number().int().describe("ID dokladu."),
        date: z.string().optional().describe("Datum úhrady (YYYY-MM-DD). Výchozí = dnes."),
        amount: z.number().optional().describe("Uhrazená částka. Výchozí = celková částka dokladu."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, date, amount }) =>
      run(() => {
        const body: Json = {};
        if (date !== undefined) body.date = date;
        if (amount !== undefined) body.amount = amount;
        return ctx.getClient().request("POST", `invoice/${id}/do/pay/`, { body });
      }),
  );

  server.registerTool(
    "create_contact",
    {
      title: "Vytvoření kontaktu",
      description: `Založí kontakt v adresáři. ${CONTACT_HINT}`,
      inputSchema: { data: payload.describe(`Tělo kontaktu (ContactObject). ${CONTACT_HINT}`) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ data }) => run(() => ctx.getClient().request("POST", "contact/", { body: data })),
  );

  server.registerTool(
    "update_contact",
    {
      title: "Editace kontaktu",
      description: `Upraví kontakt. Posílej jen měněná pole. ${CONTACT_HINT}`,
      inputSchema: {
        id: z.number().int().describe("ID kontaktu."),
        data: payload.describe("Měněná pole kontaktu (ContactObject)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, data }) =>
      run(() => ctx.getClient().request("PUT", `contact/${id}/`, { body: data })),
  );

  server.registerTool(
    "delete_contact",
    {
      title: "Smazání kontaktu",
      description: "Nevratně smaže kontakt z adresáře.",
      inputSchema: { id: z.number().int().describe("ID kontaktu.") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => run(() => ctx.getClient().request("DELETE", `contact/${id}/`)),
  );

  server.registerTool(
    "create_template",
    {
      title: "Vytvoření šablony / pravidelné faktury",
      description: `Založí šablonu nebo pravidelnou fakturu. ${TEMPLATE_HINT}`,
      inputSchema: { data: payload.describe(`Tělo šablony (TemplateObject). ${TEMPLATE_HINT}`) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ data }) => run(() => ctx.getClient().request("POST", "template/", { body: data })),
  );

  server.registerTool(
    "update_template",
    {
      title: "Editace šablony / pravidelné faktury",
      description: `Upraví šablonu. Posílej jen měněná pole. ${TEMPLATE_HINT}`,
      inputSchema: {
        id: z.number().int().describe("ID šablony."),
        data: payload.describe("Měněná pole šablony (TemplateObject)."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, data }) =>
      run(() => ctx.getClient().request("PUT", `template/${id}/`, { body: data })),
  );

  server.registerTool(
    "delete_template",
    {
      title: "Smazání šablony / pravidelné faktury",
      description: "Nevratně smaže šablonu nebo pravidelnou fakturu.",
      inputSchema: { id: z.number().int().describe("ID šablony.") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => run(() => ctx.getClient().request("DELETE", `template/${id}/`)),
  );

  server.registerTool(
    "create_tag",
    {
      title: "Vytvoření štítku",
      description: "Založí štítek. Pole: name*, color (hex bez #, např. 'ff0000').",
      inputSchema: {
        name: z.string().describe("Název štítku."),
        color: z.string().optional().describe("Barva štítku, např. 'ff0000'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, color }) =>
      run(() =>
        ctx
          .getClient()
          .request("POST", "settings/tag/", { body: color ? { name, color } : { name } }),
      ),
  );

  server.registerTool(
    "update_tag",
    {
      title: "Editace štítku",
      description: "Upraví název nebo barvu štítku.",
      inputSchema: {
        id: z.number().int().describe("ID štítku."),
        name: z.string().optional().describe("Nový název."),
        color: z.string().optional().describe("Nová barva, např. 'ff0000'."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, name, color }) =>
      run(() => {
        const body: Json = {};
        if (name !== undefined) body.name = name;
        if (color !== undefined) body.color = color;
        return ctx.getClient().request("PUT", `settings/tag/${id}`, { body });
      }),
  );

  server.registerTool(
    "delete_tag",
    {
      title: "Smazání štítku",
      description: "Nevratně smaže štítek.",
      inputSchema: { id: z.number().int().describe("ID štítku.") },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => run(() => ctx.getClient().request("DELETE", `settings/tag/${id}`)),
  );
}

/** Serialises a handler result as MCP text content, turning failures into tool errors. */
async function run(handler: () => unknown | Promise<unknown>) {
  try {
    const result = await handler();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result ?? null, null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
      ],
    };
  }
}
