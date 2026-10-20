import type {
  AuditEvent,
  AuditPage,
  AuditQuery,
  AuditRecord,
  AuditSearch,
  AuditSink,
} from '../modules/audit/audit-event.js';

/** Same contract as MongoAuditStore, kept in memory for fast tests. */
export class InMemoryAuditStore implements AuditSink, AuditQuery {
  readonly events: AuditRecord[] = [];
  private sequence = 0;

  write(events: readonly AuditEvent[]): Promise<void> {
    for (const event of events) {
      this.sequence += 1;
      this.events.push({ ...event, id: this.sequence.toString(16).padStart(24, '0') });
    }
    return Promise.resolve();
  }

  search(query: AuditSearch): Promise<AuditPage> {
    const matching = this.events
      .filter(
        (event) =>
          (query.action === undefined || event.event.action === query.action) &&
          (query.outcome === undefined || event.event.outcome === query.outcome) &&
          (query.userId === undefined ||
            event.user?.id === query.userId ||
            event.user?.target?.id === query.userId) &&
          (query.from === undefined || event['@timestamp'] >= query.from) &&
          (query.to === undefined || event['@timestamp'] < query.to) &&
          (query.cursor === undefined || event.id < query.cursor),
      )
      .sort((a, b) => b.id.localeCompare(a.id));
    const items = matching.slice(0, query.limit);
    const last = items.at(-1);
    return Promise.resolve({
      items,
      nextCursor: matching.length > query.limit && last ? last.id : null,
    });
  }

  actions(): string[] {
    return this.events.map((event) => event.event.action);
  }
}
