# vyfakturuj-mcp

MCP server pro fakturační API [Vyfakturuj.cz](https://www.vyfakturuj.cz) (v2). Umožňuje Claude Code
(a jakémukoli jinému MCP klientovi) vystavovat a hledat doklady, spravovat kontakty, šablony
pravidelných faktur a nastavení účtu.

Postavený na oficiálním TypeScript MCP SDK, komunikace přes stdio. Definice polí bere z přibalené
OpenAPI 3.1 specifikace (`openapi/vyfakturuj.json`), takže nástroj `describe_schema` vrací vždy
aktuální seznam polí bez ručního přepisování.

## Instalace

```bash
npm install
npm run build
```

## API klíč

V aplikaci Vyfakturuj.cz: **Nastavení → API**. Autentizace je HTTP Basic — uživatelské jméno je
e-mail, heslo je API klíč.

| Proměnná | Povinná | Význam |
| --- | --- | --- |
| `VYFAKTURUJ_EMAIL` | ano | E-mail účtu |
| `VYFAKTURUJ_API_KEY` | ano | API klíč |
| `VYFAKTURUJ_BASE_URL` | ne | Výchozí `https://api.vyfakturuj.cz/2.0/` |
| `VYFAKTURUJ_READ_ONLY` | ne | `1` = zaregistrují se jen čtecí nástroje (11 místo 25) |
| `VYFAKTURUJ_TIMEOUT_MS` | ne | Timeout požadavku, výchozí `30000` |

## Instalace do Claude Desktop (dvojklik)

```bash
npm install
npm run bundle       # vytvoří build/vyfakturuj.mcpb (~200 kB)
```

Pak dvojklik na `build/vyfakturuj.mcpb` — Claude Desktop otevře instalační dialog, kde vyplníš
e-mail a API klíč (klíč se uloží do systémové klíčenky, ne do konfiguračního souboru). Zaškrtávátko
**Jen pro čtení** omezí rozšíření na vyhledávání a čtení dokladů.

Rozšíření pak spravuješ v **Claude Desktop → Settings → Extensions** (vypnutí, změna klíče,
odinstalace). Balíček je jeden ESM soubor sestavený esbuildem, takže neobsahuje `node_modules`;
Claude Desktop ho spouští svým vestavěným Node.js.

## Zapojení do Claude Code

```bash
claude mcp add vyfakturuj \
  --env VYFAKTURUJ_EMAIL=ty@example.com \
  --env VYFAKTURUJ_API_KEY=tvuj-api-klic \
  -- node /Users/martin/web-projects/vyfakturuj-mcp/dist/index.js
```

Nebo ručně v `.mcp.json` / `~/.claude.json`:

```json
{
  "mcpServers": {
    "vyfakturuj": {
      "command": "node",
      "args": ["/Users/martin/web-projects/vyfakturuj-mcp/dist/index.js"],
      "env": {
        "VYFAKTURUJ_EMAIL": "ty@example.com",
        "VYFAKTURUJ_API_KEY": "tvuj-api-klic"
      }
    }
  }
}
```

Ověření: `claude mcp list`, v sezení pak `/mcp`.

## Nástroje

Čtecí:

| Nástroj | Popis |
| --- | --- |
| `describe_schema` | Úplné OpenAPI schéma objektu (`InvoiceObject`, `ContactObject`, `TemplateObject`, …); `fields_only: true` vrátí kompaktní seznam polí |
| `api_info` | Verze API, base URL, přehled operací |
| `list_invoices` | Vyhledávání dokladů (filtr podle data, zákazníka, typu, štítku, VS, fulltext) |
| `get_invoice` | Detail dokladu včetně položek a URL na PDF |
| `list_contacts`, `get_contact` | Adresář |
| `get_template` | Šablona / pravidelná faktura |
| `list_payment_methods`, `list_number_series`, `list_tags`, `get_tag` | Nastavení účtu |

Zapisovací (skryté při `VYFAKTURUJ_READ_ONLY=1`):

| Nástroj | Popis |
| --- | --- |
| `create_invoice`, `update_invoice`, `delete_invoice` | Doklady |
| `send_invoice_mail` | Odeslání dokladu e-mailem — **výchozí je `test=true`, tedy jen náhled**; skutečné odeslání vyžaduje `test=false` |
| `mark_invoice_paid` | Označení úhrady |
| `create_contact`, `update_contact`, `delete_contact` | Adresář |
| `create_template`, `update_template`, `delete_template` | Šablony a pravidelné faktury |
| `create_tag`, `update_tag`, `delete_tag` | Štítky |

Těla dokladů/kontaktů/šablon se posílají jako volný objekt `data` podle OpenAPI schématu — model si
nejdřív vyžádá pole přes `describe_schema` a pak pošle jen ta, která potřebuje. Díky tomu je seznam
nástrojů malý (~18 kB), ale dostupných je všech 92 polí faktury.

### Příklad těla dokladu

```json
{
  "id_customer": 12345,
  "type": 1,
  "date_created": "2026-09-10",
  "days_due": 14,
  "currency": "CZK",
  "items": [
    { "text": "Vývoj na zakázku", "quantity": 8, "unit": "h", "unit_price": 1200, "vat_rate": 21 }
  ]
}
```

## Aktualizace specifikace

```bash
npm run update-spec   # stáhne https://api.vyfakturuj.cz/webroot/openapi/vyfakturuj.json
npm run build
```

## Vývoj

```bash
npm run dev     # tsc --watch
npm start       # spustí server na stdio (pro ruční ladění)
npm run bundle  # sestaví .mcpb pro Claude Desktop
```

Verze v `package.json` a `manifest.json` musí sedět — `npm run bundle` to kontroluje a jinak skončí
chybou. Po změně verze zvyš obě.

Bezpečnostní poznámky: API klíč drž v proměnných prostředí, ne v repozitáři (`.env.example` je jen
vzor). Mazací nástroje jsou označené `destructiveHint`, takže se na ně Claude Code ptá; pro čistě
analytické použití zapni `VYFAKTURUJ_READ_ONLY=1`.
