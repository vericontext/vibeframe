/**
 * A fake provider network for tests.
 *
 * Module-level mocks (`vi.mock("@vibeframe/ai-providers")`) skip the code
 * that actually breaks when providers change: request shapes, response
 * parsing, polling, downloads, and the file writes after them. This harness
 * replaces only `fetch`, so real provider classes, executors, and the build
 * pipeline run end to end against scripted provider responses.
 *
 * Every request is recorded. A request no route matches throws, so a test
 * can never reach a real provider by accident.
 *
 * Exported as `@vibeframe/ai-providers/testing` so provider contract tests
 * and the CLI's build tests share one harness. It has no test-runner
 * dependency: `install()` swaps `globalThis.fetch` and `uninstall()` puts
 * it back.
 */

export interface RecordedRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  /** Parsed JSON body, raw string body, or undefined. */
  body: unknown;
}

export type FakeResponder = (req: RecordedRequest) => Response | Promise<Response>;

interface Route {
  method: string;
  host: string;
  path: RegExp;
  respond: FakeResponder;
}

/** 1x1 transparent PNG. */
export const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
/** Bytes that stand in for MP3 / MP4 payloads; nothing in the asset stage decodes them. */
export const FAKE_MP3 = Buffer.from("ID3fake-mp3-audio");
export const FAKE_MP4 = Buffer.from("\0\0\0 ftypisomfake-mp4-video");

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function bytesResponse(bytes: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } });
}

function headersOf(init: RequestInit | undefined, input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  new Headers(source as HeadersInit | undefined).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function bodyOf(init: RequestInit | undefined, input: unknown): Promise<unknown> {
  let raw: unknown = init?.body;
  if (raw === undefined && input instanceof Request) raw = await input.clone().text();
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (raw instanceof URLSearchParams) return Object.fromEntries(raw);
  return raw;
}

export class FakeProviderNetwork {
  readonly requests: RecordedRequest[] = [];
  private routes: Route[] = [];

  /** Register a route; later registrations win, so tests can override defaults. */
  on(method: string, host: string, path: RegExp, respond: FakeResponder): this {
    this.routes.unshift({ method: method.toUpperCase(), host, path, respond });
    return this;
  }

  /** Requests sent to one host, in order. */
  to(host: string): RecordedRequest[] {
    return this.requests.filter((r) => r.host === host);
  }

  private realFetch?: typeof fetch;

  /** Replace the global `fetch` until `uninstall()`. */
  install(): void {
    this.realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const req: RecordedRequest = {
        method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
        url: url.toString(),
        host: url.host,
        path: url.pathname,
        headers: headersOf(init, input),
        body: await bodyOf(init, input),
      };
      this.requests.push(req);
      const route = this.routes.find(
        (r) => r.method === req.method && r.host === req.host && r.path.test(req.path)
      );
      if (!route) {
        throw new Error(`FakeProviderNetwork: unexpected ${req.method} ${req.url}`);
      }
      return route.respond(req);
    }) as typeof fetch;
  }

  uninstall(): void {
    if (this.realFetch) globalThis.fetch = this.realFetch;
    this.realFetch = undefined;
  }
}
