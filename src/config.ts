export interface Config {
  email: string;
  apiKey: string;
  baseUrl: string;
  readOnly: boolean;
  timeoutMs: number;
}

const DEFAULT_BASE_URL = "https://api.vyfakturuj.cz/2.0/";

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Reads configuration from the environment. Credentials are validated lazily
 * (on the first API call) so that the server still starts and can report a
 * helpful message instead of dying during the MCP handshake.
 */
export function loadConfig(): Config {
  const timeout = Number.parseInt(process.env.VYFAKTURUJ_TIMEOUT_MS ?? "", 10);

  return {
    email: process.env.VYFAKTURUJ_EMAIL?.trim() ?? "",
    apiKey: process.env.VYFAKTURUJ_API_KEY?.trim() ?? "",
    baseUrl: process.env.VYFAKTURUJ_BASE_URL?.trim() || DEFAULT_BASE_URL,
    readOnly: isTruthy(process.env.VYFAKTURUJ_READ_ONLY),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
  };
}
