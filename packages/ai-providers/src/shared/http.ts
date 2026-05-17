export class ProviderHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(label: string, status: number, body: string) {
    super(`${label} (${status}): ${body}`);
    this.name = "ProviderHttpError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson<T>(
  label: string,
  url: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new ProviderHttpError(label, response.status, await response.text());
  }
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
