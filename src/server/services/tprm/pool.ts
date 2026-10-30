// Runs fn over items with bounded concurrency, results in input order. With warmFirst the
// first item runs alone: parallel cold calls would each write the prompt cache, so one call
// writes it and the rest read it.
export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  { warmFirst = false }: { warmFirst?: boolean } = {},
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  if (warmFirst && items.length > 0) {
    results[0] = await fn(items[0], 0)
    next = 1
  }
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length - next) }, worker))
  return results
}
