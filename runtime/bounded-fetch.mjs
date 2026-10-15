const SEARX = new Set(['searx.be', 'search.sapti.me', 'searxng.site', 'search.bus-hit.me', 'searx.work', 'search.ononoki.org', 'searx.tuxcloud.net']);

/** Network/parse failures stay visible even when an upstream source swallows exceptions. */
export function makeBudgetedFetch(nativeFetch, signal, currentStats, { maxBytes = 1_048_576, requestMs = 6000, maxCalls = 12 } = {}) {
  return async (input, init) => {
    const stats = currentStats();
    if (!stats) throw new Error('FETCH_OUTSIDE_SOURCE');
    stats.calls++;
    try {
      if (stats.calls > maxCalls || signal.aborted) throw new Error('SOURCE_BUDGET');
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol !== 'https:' || !(SEARX.has(url.hostname) || ['api.github.com', 'api.duckduckgo.com'].includes(url.hostname))) throw new Error('UNREVIEWED_SOURCE');
      const signals = [signal, AbortSignal.timeout(requestMs)];
      const original = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (original) signals.push(original);
      const response = await nativeFetch(input, { ...init, redirect: 'error', signal: AbortSignal.any(signals) });
      if (!response.ok || !response.body) throw new Error('SOURCE_HTTP');
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        while (true) {
          const item = await reader.read();
          if (item.done) break;
          bytes += item.value.byteLength;
          if (bytes > maxBytes) throw new Error('SOURCE_TOO_LARGE');
          chunks.push(item.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const body = Buffer.concat(chunks);
      const value = JSON.parse(body.toString('utf8'));
      let valid = false;
      if (SEARX.has(url.hostname)) valid = Array.isArray(value?.results);
      else if (url.hostname === 'api.duckduckgo.com') valid = typeof value?.AbstractText === 'string' && Array.isArray(value?.RelatedTopics);
      else if (url.pathname === '/search/users') valid = Array.isArray(value?.items);
      else if (url.pathname.endsWith('/members')) valid = Array.isArray(value);
      else valid = typeof value?.login === 'string';
      if (!valid) throw new Error('SOURCE_FORMAT');
      stats.ok++;
      return new Response(body, { status: response.status, headers: { 'content-type': 'application/json' } });
    } catch (error) { stats.failed++; throw error; }
  };
}
