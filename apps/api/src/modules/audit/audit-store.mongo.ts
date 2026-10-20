import { type Collection, type Db, type Filter, ObjectId } from 'mongodb';
import type {
  AuditEvent,
  AuditPage,
  AuditQuery,
  AuditRecord,
  AuditSearch,
  AuditSink,
} from './audit-event.js';

const COLLECTION = 'audit_events';
const DAY_SECONDS = 86_400;

/** MongoDB audit trail: append-only batches, ECS documents, TTL-based retention (ADR 0003). */
export class MongoAuditStore implements AuditSink, AuditQuery {
  private constructor(private readonly collection: Collection<AuditEvent>) {}

  static async create(db: Db, retentionDays: number): Promise<MongoAuditStore> {
    const collection = db.collection<AuditEvent>(COLLECTION);
    await collection.createIndexes([
      { key: { 'user.id': 1, _id: -1 }, name: 'by_user' },
      { key: { 'user.target.id': 1, _id: -1 }, name: 'by_target_user' },
      { key: { 'event.action': 1, _id: -1 }, name: 'by_action' },
      {
        key: { '@timestamp': 1 },
        name: 'retention',
        expireAfterSeconds: retentionDays * DAY_SECONDS,
      },
    ]);
    return new MongoAuditStore(collection);
  }

  async write(events: readonly AuditEvent[]): Promise<void> {
    // insertMany adds _id to the documents it receives: give it copies.
    await this.collection.insertMany(
      events.map((event) => ({ ...event })),
      { ordered: false },
    );
  }

  async search(query: AuditSearch): Promise<AuditPage> {
    // Every value comes from a validated string or Date: no operator can be injected (threat T2).
    const filter: Filter<AuditEvent> = {};
    if (query.action) filter['event.action'] = query.action;
    if (query.outcome) filter['event.outcome'] = query.outcome;
    if (query.userId)
      filter.$or = [{ 'user.id': query.userId }, { 'user.target.id': query.userId }];
    if (query.from ?? query.to) {
      filter['@timestamp'] = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lt: query.to } : {}),
      };
    }
    if (query.cursor) filter._id = { $lt: new ObjectId(query.cursor) };

    const documents = await this.collection
      .find(filter)
      .sort({ _id: -1 })
      .limit(query.limit + 1)
      .toArray();

    const items: AuditRecord[] = documents.slice(0, query.limit).map(({ _id, ...event }) => ({
      ...event,
      id: _id.toHexString(),
    }));
    const last = items.at(-1);
    return { items, nextCursor: documents.length > query.limit && last ? last.id : null };
  }
}
