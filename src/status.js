// Health checks for every Sentire Cloud service. Public URLs only: no keys, no secrets.
export async function probe(service, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(service.url.replace(/\/$/, "") + (service.health || "/"), {
      method: "GET",
      redirect: "manual",
      signal: ctrl.signal,
      headers: { "User-Agent": "SentireCloudStatus/1" },
    });
    // 2xx and 3xx (a login redirect) both mean the service answers
    const up = res.status < 400 || res.status === 401 || res.status === 403;
    const ms = Date.now() - started;
    return { id: service.id, up, slow: up && ms > 5000, status: res.status, ms };
  } catch (e) {
    return { id: service.id, up: false, status: 0, ms: Date.now() - started, error: e.name === "AbortError" ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAll(config, opts) {
  const all = [...config.products, ...config.platform];
  const results = await Promise.all(all.map((s) => probe(s, opts)));
  const byId = Object.fromEntries(results.map((r) => [r.id, r]));
  const decorate = (list) => list.map((s) => ({ ...s, ...byId[s.id] }));
  return {
    checkedAt: new Date().toISOString(),
    products: decorate(config.products),
    platform: decorate(config.platform),
    allUp: results.every((r) => r.up),
  };
}
