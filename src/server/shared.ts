/**
 * One store per process for module hooks. The custom server and the Next.js bundle load
 * separate copies of these modules, so a plain module variable set in one copy is not seen
 * by the other. Keeping the hooks on globalThis lets both copies share them.
 */
const g = globalThis as unknown as { __sentireShared?: Record<string, unknown> };
export function shared<T>(key: string, init: () => T): T {
  g.__sentireShared ??= {};
  if (!(key in g.__sentireShared)) g.__sentireShared[key] = init();
  return g.__sentireShared[key] as T;
}
