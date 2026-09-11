import type { Config } from "./config.js";

export class VyfakturujError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "VyfakturujError";
  }
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
}

export class VyfakturujClient {
  private readonly authHeader: string;

  constructor(private readonly config: Config) {
    if (!config.email || !config.apiKey) {
      throw new VyfakturujError(
        "Chybí přihlašovací údaje. Nastav proměnné prostředí VYFAKTURUJ_EMAIL a VYFAKTURUJ_API_KEY " +
          "(API klíč najdeš ve Vyfakturuj.cz v Nastavení > API).",
      );
    }
    this.authHeader =
      "Basic " + Buffer.from(`${config.email}:${config.apiKey}`).toString("base64");
  }

  async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: RequestOptions = {},
  ): Promise<unknown> {
    const url = new URL(path.replace(/^\//, ""), this.config.baseUrl);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
      "User-Agent": "vyfakturuj-mcp",
    };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new VyfakturujError(`Požadavek ${method} ${url.pathname} selhal: ${reason}`);
    }

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      throw new VyfakturujError(
        `API vrátilo ${response.status} ${response.statusText} pro ${method} ${url.pathname}: ` +
          truncate(typeof payload === "string" ? payload : JSON.stringify(payload)),
        response.status,
        payload,
      );
    }

    return payload;
  }
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function truncate(value: string, limit = 1000): string {
  return value.length > limit ? `${value.slice(0, limit)}… (zkráceno)` : value;
}
