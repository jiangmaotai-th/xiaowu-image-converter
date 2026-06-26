export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;

  async function next(): Promise<void> {
    const index = cursor;
    cursor += 1;
    if (index >= items.length) return;

    await worker(items[index]);
    await next();
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
}
