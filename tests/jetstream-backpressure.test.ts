import { describe, expect, it } from 'vitest';
import { __testJetstreamQueue } from '../src/ingestion/jetstream.js';

describe('jetstream backpressure queue', () => {
  it('rejects new work when pending queue is saturated', async () => {
    __testJetstreamQueue.reset();

    const activeAcquires = await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );
    expect(activeAcquires.every(Boolean)).toBe(true);

    const pendingAcquires = Array.from({ length: __testJetstreamQueue.maxPendingEvents }, () =>
      __testJetstreamQueue.acquireSlot()
    );

    expect(__testJetstreamQueue.getState()).toEqual({
      active: __testJetstreamQueue.maxConcurrentEvents,
      queued: __testJetstreamQueue.maxPendingEvents,
    });

    const overflowAcquire = await __testJetstreamQueue.acquireSlot();
    expect(overflowAcquire).toBe(false);

    __testJetstreamQueue.releaseSlot();
    await expect(pendingAcquires[0]).resolves.toBe(true);

    __testJetstreamQueue.drainQueuedSlots(false);
    for (const acquire of pendingAcquires.slice(1)) {
      await expect(acquire).resolves.toBe(false);
    }

    __testJetstreamQueue.reset();
  });

  it('drains queued acquires as false during reconnect/close cleanup', async () => {
    __testJetstreamQueue.reset();

    await Promise.all(
      Array.from({ length: __testJetstreamQueue.maxConcurrentEvents }, () =>
        __testJetstreamQueue.acquireSlot()
      )
    );

    const queuedA = __testJetstreamQueue.acquireSlot();
    const queuedB = __testJetstreamQueue.acquireSlot();

    expect(__testJetstreamQueue.getState().queued).toBe(2);

    __testJetstreamQueue.drainQueuedSlots(false);
    await expect(queuedA).resolves.toBe(false);
    await expect(queuedB).resolves.toBe(false);
    expect(__testJetstreamQueue.getState().queued).toBe(0);

    __testJetstreamQueue.reset();
  });
});
