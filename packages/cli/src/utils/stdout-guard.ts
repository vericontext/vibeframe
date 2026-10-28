/**
 * @module utils/stdout-guard
 *
 * Keep everything but the command's product off stdout: third-party chatter
 * while a library call runs ({@link withStdoutOnStderr}), and every human
 * line for the whole process in `--json`/`--quiet` mode ({@link reserveStdout}).
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

type StdoutWrite = typeof process.stdout.write;

const writeToStderr = ((
  chunk: string | Uint8Array,
  encoding?: BufferEncoding | ((err?: Error | null) => void),
  callback?: (err?: Error | null) => void
): boolean =>
  typeof encoding === "function"
    ? process.stderr.write(chunk, encoding)
    : process.stderr.write(chunk, encoding, callback)) as StdoutWrite;

/**
 * Run `fn` with every stdout write rerouted to stderr, restoring the original
 * writer afterwards even if `fn` throws.
 */
export async function withStdoutOnStderr<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = writeToStderr;

  try {
    return await fn();
  } finally {
    process.stdout.write = original;
  }
}

/** The real stdout writer while {@link reserveStdout} is in effect. */
let reservedWrite: StdoutWrite | null = null;

/**
 * Reserve stdout for the command's one machine-readable product (the
 * `--json` envelope, the `--quiet` value) for the rest of the process.
 *
 * Every other stdout write - a banner, a summary table, a prompt, library
 * chatter - is rerouted to stderr, so it stays visible on a terminal but can
 * never land in front of the JSON an agent parses. The product itself goes
 * out through {@link writeStdout}.
 *
 * Without this, every command had to remember to gate each `console.log` on
 * JSON mode, and the ones that forgot (`remix highlights`, `detect scenes`,
 * `media info`, ...) printed human text where the envelope belonged.
 */
export function reserveStdout(): void {
  if (reservedWrite) return;
  reservedWrite = process.stdout.write.bind(process.stdout) as StdoutWrite;
  process.stdout.write = writeToStderr;
}

/** Undo {@link reserveStdout}. Tests only; the CLI holds it until exit. */
export function releaseStdout(): void {
  if (!reservedWrite) return;
  process.stdout.write = reservedWrite;
  reservedWrite = null;
}

/**
 * Print the command's product on stdout as one line, past any
 * {@link reserveStdout} reservation. Without a reservation it is plain
 * `console.log`, so in-process tests that spy on `console.log` still see it.
 */
export function writeStdout(text: string): void {
  if (reservedWrite) {
    reservedWrite(`${text}\n`);
  } else {
    console.log(text);
  }
}
