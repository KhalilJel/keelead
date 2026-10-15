import { fork } from 'node:child_process';
import path from 'node:path';

export class SearchError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

export function parseSearch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SearchError('INVALID_REQUEST', 400);
  const query = input.query;
  const count = input.count === undefined ? 10 : Number(input.count);
  if (typeof query !== 'string' || !query.trim() || query.length > 300 || /[\x00-\x1f]/.test(query)) throw new SearchError('INVALID_QUERY', 400);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new SearchError('INVALID_COUNT', 400);
  for (const field of ['location', 'industry']) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length > 150)) throw new SearchError('INVALID_FILTER', 400);
  }
  return { query: query.trim(), count, location: input.location, industry: input.industry };
}

/** All network work lives in a disposable process group, including any descendants. */
export function createSearchRunner({ workerPath = path.join(process.cwd(), 'runtime/search-worker.ts'), execArgv = ['--import', 'tsx'], budgetMs = 20_000, maxConcurrent = 2 } = {}) {
  let active = 0;
  const cache = new Map();
  return async function search(raw) {
    const input = parseSearch(raw);
    const key = JSON.stringify(input);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 600_000) return { ...hit.result, cached: true };
    if (active >= maxConcurrent) throw new SearchError('SEARCH_BUSY', 429);
    active++;
    return new Promise((resolve, reject) => {
      let child;
      let timer;
      let settled = false;
      let released = false;
      let result;
      let failure;
      const completed = new Map();
      const seen = new Set();
      const leads = [];
      const terminate = () => {
        if (!child?.pid) return;
        try {
          if (process.platform === 'win32') child.kill('SIGKILL');
          else process.kill(-child.pid, 'SIGKILL');
        } catch { child.kill('SIGKILL'); }
      };
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        active--;
        if (failure) reject(failure);
        else if (result) {
          if (!result.partial) {
            if (cache.size >= 100) cache.delete(cache.keys().next().value);
            cache.set(key, { at: Date.now(), result });
          }
          resolve(result);
        } else reject(new SearchError('WORKER_EXITED'));
      };
      const finish = (timedOut = false, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const complete = completed.size === 3 && [...completed.values()].every(value => value.healthy && !value.partial);
        // Empty + failed/missing source is an outage, never a fake successful empty search.
        if (error || (!leads.length && !complete)) failure = error ?? new SearchError(timedOut ? 'SEARCH_TIMEOUT' : 'SOURCES_UNAVAILABLE');
        else result = { leads: leads.slice(0, input.count), partial: !complete, completedSources: completed.size, cached: false };
        terminate();
      };
      try {
        child = fork(workerPath, [], { execArgv, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        child.once('error', () => { finish(false, new SearchError('WORKER_START_FAILED')); if (!child.pid) release(); });
        child.once('exit', release);
        child.on('message', message => {
          if (settled || !message || typeof message !== 'object') return;
          if (message.type === 'source' && ['duckduckgo', 'searxng', 'github-orgs'].includes(message.id) && !completed.has(message.id)) {
            completed.set(message.id, { healthy: message.healthy === true, partial: message.partial === true });
            for (const lead of (Array.isArray(message.leads) ? message.leads.slice(0, input.count) : [])) {
              if (!lead || typeof lead !== 'object' || typeof lead.source !== 'string') continue;
              const provenance = lead.metadata;
              if (!provenance || typeof provenance !== 'object') continue;
              const identity = lead.email || lead.website || provenance.github_url || provenance.abstractUrl || provenance.url;
              if (typeof identity !== 'string' || !identity.trim() || seen.has(identity.toLowerCase())) continue;
              seen.add(identity.toLowerCase());
              leads.push(lead);
            }
            if (leads.length >= input.count || completed.size === 3) finish();
          }
        });
        timer = setTimeout(() => finish(true), budgetMs);
        child.send({ ...input, budgetMs: Math.max(50, budgetMs - 200) });
      } catch {
        failure = new SearchError('WORKER_START_FAILED');
        if (child?.pid) { settled = true; terminate(); }
        else release();
      }
    });
  };
}

export const search = createSearchRunner();
