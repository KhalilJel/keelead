import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const ids = ['duckduckgo', 'searxng', 'github-orgs'];
const lead = i => ({ company: `Fixture ${i}`, firstName: '', lastName: '', source: 'Fixture', website: `https://fixture${i}.test`, metadata: { url: `https://fixture${i}.test` } });
process.once('message', input => {
  // Keep deliberately hanging fixtures alive after their one-shot IPC listener runs.
  setInterval(() => {}, 1000);
  if (input.query === 'crash') process.exit(1);
  if (input.query === 'hang' && process.platform !== 'win32' && process.env.FIXTURE_PIDFILE) {
    const descendant = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    writeFileSync(process.env.FIXTURE_PIDFILE, String(descendant.pid));
  }
  if (input.query === 'hang') return;
  if (input.query === 'partial') {
    process.send({ type: 'source', id: ids[0], healthy: true, leads: [lead(0)] });
    return;
  }
  for (let i = 0; i < ids.length; i++) process.send({ type: 'source', id: ids[i], healthy: input.query !== 'failed',
    leads: ['empty', 'failed'].includes(input.query) ? [] : [lead(i), lead(i)] });
});
