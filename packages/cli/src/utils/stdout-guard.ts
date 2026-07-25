/**
 * @module utils/stdout-guard
 *
 * Keep third-party chatter off stdout while a library call runs.
 *
 * `@hyperframes/producer` already routes its own logger to stderr for this
 * exact reason - its docs say "producer runs inside CLI commands whose stdout
 * is a machine-readable contract". The render engine underneath it does not
 * honour that: `[BrowserManager]`, `[initSession:screenshot]`, and
 * `[HyperFrames]` lines land on stdout mid-render, which makes
 * `vibe render --json` and `vibe build --json` emit output that
 * `JSON.parse` rejects.
 *
 * Redirecting rather than silencing keeps the diagnostics: on a terminal
 * stderr is still displayed, so a human sees exactly what they saw before,
 * while an agent reading stdout gets only the JSON envelope.
 */

/**
 * Run `fn` with every stdout write rerouted to stderr, restoring the original
 * writer afterwards even if `fn` throws.
 */
export async function withStdoutOnStderr<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void
  ): boolean =>
    typeof encoding === "function"
      ? process.stderr.write(chunk, encoding)
      : process.stderr.write(chunk, encoding, callback)) as typeof process.stdout.write;

  try {
    return await fn();
  } finally {
    process.stdout.write = original;
  }
}
