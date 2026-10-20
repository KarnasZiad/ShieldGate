import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { AuditAction, toAuditEvent } from '../../src/modules/audit/audit-event.js';
import { MongoAuditStore } from '../../src/modules/audit/audit-store.mongo.js';

let client: MongoClient;
let db: Db;

beforeAll(async () => {
  client = new MongoClient(inject('mongoUrl'));
  await client.connect();
  db = client.db('shieldgate_audit_test');
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await db.dropDatabase();
});

describe('MongoAuditStore', () => {
  it('creates the query and retention indexes', async () => {
    await MongoAuditStore.create(db, 400);

    const indexes = await db.collection('audit_events').indexes();
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['by_user', 'by_target_user', 'by_action', 'retention']),
    );
    expect(indexes.find((index) => index.name === 'retention')?.expireAfterSeconds).toBe(
      400 * 86_400,
    );
  });

  it('writes batches and searches by user, action, outcome and time with a cursor', async () => {
    const store = await MongoAuditStore.create(db, 400);
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 20, 9, minute));
    await store.write([
      toAuditEvent({ action: AuditAction.Login, outcome: 'failure', user: { id: 'u-1' } }, at(0)),
      toAuditEvent({ action: AuditAction.Login, outcome: 'success', user: { id: 'u-1' } }, at(1)),
      toAuditEvent(
        {
          action: AuditAction.UserUpdated,
          outcome: 'success',
          user: { id: 'admin', target: { id: 'u-1' } },
        },
        at(2),
      ),
      toAuditEvent({ action: AuditAction.Login, outcome: 'success', user: { id: 'u-2' } }, at(3)),
    ]);

    const forUser = await store.search({ userId: 'u-1', limit: 10 });
    const failures = await store.search({ outcome: 'failure', limit: 10 });
    const window = await store.search({ from: at(1), to: at(3), limit: 10 });
    const firstPage = await store.search({ action: AuditAction.Login, limit: 2 });
    const secondPage = await store.search({
      action: AuditAction.Login,
      limit: 2,
      cursor: firstPage.nextCursor ?? '',
    });

    expect(forUser.items.map((item) => item.event.action)).toEqual([
      'user.updated',
      'user.login',
      'user.login',
    ]);
    expect(failures.items).toHaveLength(1);
    expect(window.items.map((item) => item['@timestamp'].toISOString())).toEqual([
      at(2).toISOString(),
      at(1).toISOString(),
    ]);
    expect(firstPage.items.map((item) => item.user?.id)).toEqual(['u-2', 'u-1']);
    expect(secondPage.items.map((item) => item.user?.id)).toEqual(['u-1']);
    expect(secondPage.nextCursor).toBeNull();
    expect(firstPage.items[0]?.id).toMatch(/^[0-9a-f]{24}$/);
  });
});
