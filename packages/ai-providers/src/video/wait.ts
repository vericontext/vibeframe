import { TERMINAL_STATUSES, type VideoGenerator, type VideoJob, type VideoJobState } from "./contract.js";
import { ProviderError } from "../shared/errors.js";

export interface WaitForVideoOptions {
  /** Give up after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** Delay between polls. Default 5 s. */
  intervalMs?: number;
  /** Called after every poll. */
  onProgress?: (state: VideoJobState) => void;
  /** Stop waiting (the job keeps running at the provider). */
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

/**
 * Poll a job until it reaches a terminal state. A read that fails with a
 * retryable error (rate limit, 5xx, network) is retried on the next poll;
 * anything else is thrown. Running out of time throws `timeout`, and the
 * job may still finish at the provider, so callers keep the handle.
 */
export async function waitForVideoJob(
  generator: VideoGenerator,
  job: VideoJob,
  options: WaitForVideoOptions = {}
): Promise<VideoJobState> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const intervalMs = options.intervalMs ?? 5000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    options.signal?.throwIfAborted();
    try {
      const state = await generator.getVideoJob(job);
      options.onProgress?.(state);
      if (TERMINAL_STATUSES.has(state.status)) return state;
    } catch (error) {
      if (!(error instanceof ProviderError && error.retryable)) throw error;
    }
    if (Date.now() + intervalMs > deadline) {
      throw new ProviderError({
        kind: "timeout",
        provider: job.provider,
        message: `${job.provider} job ${job.id} did not finish within ${Math.round(timeoutMs / 1000)} s. It may still complete; check it later with its job ID.`,
      });
    }
    await sleep(intervalMs, options.signal);
  }
}
