import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function main() {
  const token = process.env.PARKSICAL_VEHICLE_ACCESS_TOKEN;
  const installationId = process.env.PARKSICAL_INSTALLATION_ID;
  if (!token || !installationId) throw new Error('Missing scenario credentials');
  const base = new URL(process.env.PARKSICAL_API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Invalid API base');
  const fixture = JSON.parse(await readFile(new URL('../fixtures/vehicle/offline-replay.json', import.meta.url), 'utf8'));
  const now = Date.now(), prefix = randomUUID();
  const caps = offset => Object.fromEntries(['gear','speed','steeringAngle','brake','safetyWarnings','carProfile','navigation'].map(name => [name, {
    status: name === 'steeringAngle' ? 'UNSUPPORTED' : 'SUPPORTED', checkedAt: new Date(now + offset).toISOString(),
  }]));
  async function post(path, key, body) {
    const response = await fetch(base.href.replace(/\/$/, '') + path, { method: 'POST', headers: {
      Authorization: 'Bearer ' + token, 'content-type': 'application/json', 'Idempotency-Key': key,
    }, body: JSON.stringify(body) });
    return { response, body: await response.json() };
  }
  const created = await post('/vehicle-sessions', prefix, { contractVersion:'1.0',appVersion:'synthetic-client-1',installationId,reportedSource:'SYNTHETIC',capabilities:caps(-1000) });
  if (created.response.status !== 201) throw new Error('Session rejected');
  const saved = new Map();
  for (const [index, step] of fixture.steps.entries()) {
    const body = step.replayOf ? saved.get(step.replayOf) : {
      contractVersion:'1.0', eventId:prefix + '_' + step.eventId, sequence:step.sequence,
      occurredAt:new Date(now + step.offsetMs).toISOString(), type:step.type,
      payload:step.type === 'SESSION_CLOSED' ? {reason:'USER_ENDED'} : caps(step.offsetMs),
    };
    if (!body) throw new Error('Missing replay');
    if (!step.replayOf) saved.set(step.eventId, body);
    const result = await post('/vehicle-sessions/' + created.body.id + '/events', body.eventId, body);
    if (result.response.status !== step.expectedStatus) throw new Error('Scenario mismatch');
    if (step.replayOf && result.response.headers.get('Idempotency-Replayed') !== 'true') throw new Error('Replay missing');
    console.log(JSON.stringify({step:index+1,status:result.response.status,replayed:result.response.headers.get('Idempotency-Replayed') === 'true'}));
  }
  console.log('PASS: SYNTHETIC metadata scenario; not an SDK validation.');
}
void main().catch(() => { console.error('Vehicle scenario failed; check credentials, API and fixture.'); process.exitCode=1; });
