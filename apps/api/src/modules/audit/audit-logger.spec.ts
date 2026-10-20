import { describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../../lib/clock.js';
import { InMemoryAuditStore } from '../../testing/in-memory-audit-store.js';
import type { AuditEvent, AuditSink } from './audit-event.js';
import { AuditAction } from './audit-event.js';
import { AuditLogger } from './audit-logger.js';

const clock = new FixedClock(Date.parse('2026-10-20T09:30:00Z'));

function failingSink(
  failures: number,
  store = new InMemoryAuditStore(),
): AuditSink & { calls: number } {
  const sink = {
    calls: 0,
    write: (events: readonly AuditEvent[]) => {
      sink.calls += 1;
      return sink.calls <= failures
        ? Promise.reject(new Error('MongoDB down'))
        : store.write(events);
    },
  };
  return sink;
}

describe('AuditLogger', () => {
  it('writes ECS events with a timestamp and categories', async () => {
    const store = new InMemoryAuditStore();
    const logger = new AuditLogger(store, clock);

    logger.record({
      action: AuditAction.Login,
      outcome: 'failure',
      reason: 'invalid_credentials',
      user: { email: 'amina@exemple.ma' },
      ip: '196.12.4.8',
      userAgent: 'Mozilla/5.0',
      requestId: 'req-1',
    });
    await logger.flush();

    expect(store.events[0]).toMatchObject({
      '@timestamp': new Date('2026-10-20T09:30:00Z'),
      event: {
        action: 'user.login',
        category: ['authentication'],
        outcome: 'failure',
        reason: 'invalid_credentials',
      },
      user: { email: 'amina@exemple.ma' },
      source: { ip: '196.12.4.8' },
      user_agent: { original: 'Mozilla/5.0' },
      trace: { id: 'req-1' },
    });
  });

  it('does not write anything until flushed, then writes in batches', async () => {
    const store = new InMemoryAuditStore();
    const write = vi.spyOn(store, 'write');
    const logger = new AuditLogger(store, clock, { maxBatchSize: 2 });

    logger.record({ action: AuditAction.Logout, outcome: 'success' });
    expect(write).not.toHaveBeenCalled();

    logger.record({ action: AuditAction.Logout, outcome: 'success' });
    logger.record({ action: AuditAction.Logout, outcome: 'success' });
    await logger.flush();

    expect(write.mock.calls.map(([events]) => events.length)).toEqual([2, 1]);
    expect(store.events).toHaveLength(3);
  });

  it('keeps events and retries when the sink fails', async () => {
    const store = new InMemoryAuditStore();
    const onError = vi.fn();
    const logger = new AuditLogger(failingSink(1, store), clock, { onError });

    logger.record({ action: AuditAction.Login, outcome: 'success' });
    await logger.flush();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 1);
    expect(logger.pending).toBe(1);

    await logger.flush();
    expect(store.events).toHaveLength(1);
    expect(logger.pending).toBe(0);
  });

  it('bounds memory during an outage by dropping the oldest events', async () => {
    const logger = new AuditLogger(failingSink(Number.POSITIVE_INFINITY), clock, {
      maxBufferSize: 3,
      maxBatchSize: 10,
    });

    for (let index = 0; index < 5; index += 1) {
      logger.record({
        action: AuditAction.Login,
        outcome: 'failure',
        labels: { n: String(index) },
      });
    }
    await logger.flush();

    expect(logger.pending).toBe(3);
    expect(logger.dropped).toBe(2);
  });

  it('flushes periodically and on stop', async () => {
    vi.useFakeTimers();
    const store = new InMemoryAuditStore();
    const logger = new AuditLogger(store, clock, { flushIntervalMs: 1_000 });
    logger.start();

    logger.record({ action: AuditAction.Login, outcome: 'success' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(store.events).toHaveLength(1);

    logger.record({ action: AuditAction.Logout, outcome: 'success' });
    await logger.stop();
    expect(store.events).toHaveLength(2);
    vi.useRealTimers();
  });

  it('shares a flush between concurrent callers', async () => {
    const store = new InMemoryAuditStore();
    const write = vi.spyOn(store, 'write');
    const logger = new AuditLogger(store, clock);
    logger.record({ action: AuditAction.Login, outcome: 'success' });

    await Promise.all([logger.flush(), logger.flush()]);

    expect(write).toHaveBeenCalledTimes(1);
  });
});
