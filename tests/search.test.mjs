import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSearchRunner, parseSearch } from '../runtime/search-runner.mjs';
import { makeBudgetedFetch } from '../runtime/bounded-fetch.mjs';
import { searchRegistry } from '../runtime/registry-source.mjs';
const workerPath = fileURLToPath(new URL('./fixture-worker.mjs', import.meta.url));
const runner = options => createSearchRunner({ workerPath, execArgv: [], budgetMs: 1000, ...options });

test('request validation refuses malformed query/count/filter before spawning', () => {
  for (const input of [null, [], {}, { query: '\n' }, { query: 'ok', count: 0 }, { query: 'ok', count: 51 }, { query: 'ok', count: 1.5 }, { query: 'ok', location: {} }]) {
    assert.throws(() => parseSearch(input), error => error.status === 400);
  }
});
test('count, deduplication, complete results and bounded cache', async () => {
  const search = runner();
  const result = await search({ query: 'complete', count: 10 });
  assert.equal(result.leads.length, 4);
  assert.equal(result.partial, false);
  assert.equal((await search({ query: 'complete', count: 10 })).cached, true);
  const small = await search({ query: 'complete', count: 2 });
  assert.equal(small.leads.length, 2);
});
test('failed sources are not represented as a successful empty result', async () => {
  await assert.rejects(runner()({ query: 'failed' }), error => error.code === 'SOURCES_UNAVAILABLE');
  const empty = await runner()({ query: 'empty' });
  assert.deepEqual(empty.leads, []);
  assert.equal(empty.partial, false);
  await assert.rejects(runner()({ query: 'crash' }), error => error.code === 'WORKER_EXITED');
});
test('deadline returns real partial results and kills a hanging worker', async () => {
  const started = Date.now();
  const result = await runner({ budgetMs: 500 })({ query: 'partial', count: 5 });
  assert.equal(result.leads.length, 1);
  assert.equal(result.partial, true);
  assert.ok(Date.now() - started < 3000);
});
test('admission control rejects excess work and releases its slot after timeout', async () => {
  const search = runner({ budgetMs: 500, maxConcurrent: 1 });
  const hung = search({ query: 'hang' });
  await assert.rejects(search({ query: 'complete' }), error => error.status === 429);
  await assert.rejects(hung, error => error.code === 'SEARCH_TIMEOUT');
  assert.deepEqual((await search({ query: 'empty' })).leads, []);
});
test('deadline kills descendant processes, not just the request promise', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'keelead-'));
  const file = path.join(dir, 'pid');
  process.env.FIXTURE_PIDFILE = file;
  try {
    await assert.rejects(runner({ budgetMs: 1000 })({ query: 'hang' }));
    const pid = Number(await readFile(file, 'utf8'));
    // A killed descendant can briefly be a zombie until the OS reaps it; it must not be running.
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => 'gone');
    assert.ok(stat === 'gone' || stat.split(' ')[2] === 'Z', stat);
  } finally { delete process.env.FIXTURE_PIDFILE; await rm(dir, { recursive: true, force: true }); }
});
test('network failures and invalid schemas remain failures even if a provider swallows them', async () => {
  const stats = { ok: 0, failed: 0, calls: 0 };
  const signal = new AbortController().signal;
  const fetch = makeBudgetedFetch(async () => new Response('{"message":"not search data"}'), signal, () => stats);
  await assert.rejects(fetch('https://api.github.com/search/users'));
  assert.equal(stats.ok, 0);
  assert.equal(stats.failed, 1);
  const valid = makeBudgetedFetch(async () => new Response('{"items":[]}'), signal, () => stats);
  await valid('https://api.github.com/search/users');
  assert.equal(stats.ok, 1);
});
test('request deadline aborts underlying I/O and response byte/call budgets fail closed', async () => {
  const stats = { ok: 0, failed: 0, calls: 0 };
  let aborted = false;
  const fetch = makeBudgetedFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  }), new AbortController().signal, () => stats, { requestMs: 20 });
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(fetch('https://api.github.com/search/users')); } finally { clearTimeout(keepAlive); }
  assert.equal(aborted, true);
  const large = makeBudgetedFetch(async () => new Response('{"items":[]}'), new AbortController().signal, () => stats, { maxBytes: 2 });
  await assert.rejects(large('https://api.github.com/search/users'), /SOURCE_TOO_LARGE/);
  const capped = makeBudgetedFetch(async () => { throw new Error('must not run'); }, new AbortController().signal, () => stats, { maxCalls: 0 });
  await assert.rejects(capped('https://api.github.com/search/users'), /SOURCE_BUDGET/);
  await assert.rejects(capped('http://127.0.0.1/'));
});

test('registry discovery keeps observed AS/ASA records with provenance and rejects unsafe matches', async () => {
  const unit = { organisasjonsnummer: '123456789', navn: 'Fixture Webdesign AS', organisasjonsform: { kode: 'AS' }, forretningsadresse: { kommunenummer: '0301', poststed: 'OSLO' } };
  let requested;
  const fetcher = async url => {
    requested = url;
    return new Response(JSON.stringify({ _embedded: { enheter: [unit,
      { ...unit, konkurs: true }, { ...unit, underAvvikling: true },
      { ...unit, organisasjonsform: { kode: 'ENK' } },
      { ...unit, forretningsadresse: { kommunenummer: '3201' } }] } }));
  };
  const result = await searchRegistry('web design businesses in Oslo', { location: 'Oslo', count: 2 }, fetcher);
  assert.equal(requested.searchParams.get('navn'), 'webdesign');
  assert.equal(requested.searchParams.get('forretningsadresse.kommunenummer'), '0301');
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].metadata.organizationNumber, '123456789');
  assert.equal(result.leads[0].metadata.qualified, false);
  assert.equal(result.leads[0].email, undefined);
  assert.equal(result.leads[0].website, undefined);
  assert.deepEqual(await searchRegistry('webdesign', { location: 'London', count: 2 }, () => { throw Error('must not fetch'); }), { applicable: false, leads: [] });
});
