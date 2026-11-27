import test from 'node:test';
import assert from 'node:assert/strict';
import { SurfaceTileWorkerPool } from '../src/rendering/geodesic/surface-worker-pool.ts';

class FakeWorker {
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: any[] = [];
  terminated = false;
  postMessage(message: any) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  ready() { this.onmessage?.({ data: { type: 'ready' } }); }
}

test('surface worker pool replaces a crashed ready worker and continues processing', async () => {
  const workers: FakeWorker[] = [];
  const pool = new SurfaceTileWorkerPool({ workerFactory: () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  } });
  const first = workers[0];
  first.ready();
  const failed = pool.requestMesh({ id: { key: 'crash-tile' } } as any, 8, 100, 1);
  assert.equal(first.messages.length, 1);
  first.onerror?.({ message: 'simulated worker crash', preventDefault() {} });
  await assert.rejects(failed, /Surface worker runtime failure/);
  assert.equal(first.terminated, true);
  assert.equal(workers.length, 2);
  assert.equal(pool.workerRestarts, 1);
  const replacement = workers[1];
  replacement.ready();
  const next = pool.requestMesh({ id: { key: 'healthy-tile' } } as any, 8, 100, 1);
  assert.equal(replacement.messages.length, 1);
  replacement.onmessage?.({ data: { id: replacement.messages[0].id, mesh: { id: 'generated-mesh' } } });
  assert.deepEqual(await next, { id: 'generated-mesh' });
  pool.dispose();
  assert.equal(replacement.terminated, true);
});

test('disposing the surface worker pool rejects pending subscribers and terminates workers', async () => {
  const workers: FakeWorker[] = [];
  const pool = new SurfaceTileWorkerPool({ workerFactory: () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  } });
  workers[0].ready();
  const pending = pool.requestMesh({ id: { key: 'dispose-tile' } } as any, 8, 100, 1);
  pool.dispose();
  await assert.rejects(pending, (error: any) => error?.name === 'AbortError');
  assert.equal(workers[0].terminated, true);
  assert.equal(pool.pendingCount, 0);
});
