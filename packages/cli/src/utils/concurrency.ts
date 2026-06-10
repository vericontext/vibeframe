/**
 * @module utils/concurrency
 * @description Tiny dependency-free concurrency limiter.
 */

/**
 * Map `items` with at most `limit` concurrent invocations of `fn`. Results
 * preserve input order. The first rejection propagates after the workers
 * stop picking up new items (in-flight tasks still settle), matching how
 * the build dispatcher treated `Promise.all` failures.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError(`mapWithConcurrency limit must be a positive integer, got ${limit}`);
  }
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failure: { error: unknown } | null = null;

  async function worker(): Promise<void> {
    while (failure === null) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        failure = failure ?? { error };
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
