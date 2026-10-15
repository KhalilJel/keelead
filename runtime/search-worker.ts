import { AsyncLocalStorage } from 'node:async_hooks';
import duckduckgo from '../lib/sources/search/duckduckgo';
import searxng from '../lib/sources/search/searxng';
import github from '../lib/sources/developer/github-orgs';
import { makeBudgetedFetch } from './bounded-fetch.mjs';
import { searchRegistry } from './registry-source.mjs';

// Audited search implementations: no random/example-data fallback and no paid credentials.
// OSM public geocoding is intentionally not used by this generic API.
const sources = [duckduckgo, searxng, github];
const context = new AsyncLocalStorage<{ ok: number; failed: number; calls: number }>();
const nativeFetch = globalThis.fetch;
const deadline = new AbortController();

globalThis.fetch = makeBudgetedFetch(nativeFetch, deadline.signal, () => context.getStore()) as typeof fetch;

process.once('message', async (input: { query: string; count: number; location?: string; industry?: string; budgetMs: number }) => {
  const timer = setTimeout(() => deadline.abort(), input.budgetMs);
  const publicSearches = sources.map(source => context.run({ ok: 0, failed: 0, calls: 0 }, async () => {
    const stats = context.getStore()!;
    try {
      const leads = (await source.search(input.query, input)).slice(0, input.count);
      process.send?.({ type: 'source', id: source.id, healthy: leads.length > 0 || (stats.ok > 0 && stats.failed === 0), partial: stats.failed > 0, leads });
    } catch { process.send?.({ type: 'source', id: source.id, healthy: false, leads: [] }); }
  }));
  const registrySearch = context.run({ ok: 0, failed: 0, calls: 0 }, async () => {
    const stats = context.getStore()!;
    try {
      const result = await searchRegistry(input.query, input);
      process.send?.({ type: 'source', id: 'brreg', healthy: !result.applicable || stats.ok > 0,
        partial: stats.failed > 0, leads: result.leads });
    } catch { process.send?.({ type: 'source', id: 'brreg', healthy: false, leads: [] }); }
  });
  await Promise.all([...publicSearches, registrySearch]);
  clearTimeout(timer);
  deadline.abort();
  // Parent kills this process group after processing the last source message.
});
