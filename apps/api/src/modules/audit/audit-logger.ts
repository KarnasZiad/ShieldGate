import type { Clock } from '../../lib/clock.js';
import { type AuditEvent, type AuditInput, type AuditSink, toAuditEvent } from './audit-event.js';

export interface AuditLoggerOptions {
  flushIntervalMs?: number;
  maxBatchSize?: number;
  /** Upper bound of events kept in memory while the sink is unavailable. */
  maxBufferSize?: number;
  onError?: (error: unknown, buffered: number) => void;
}

/**
 * Non-blocking audit trail (threat D3): `record` only appends to a bounded buffer, flushed in
 * batches. A failing sink is retried on the next flush; when the buffer is full the oldest events
 * are dropped and counted, so an outage of MongoDB never blocks a login.
 */
export class AuditLogger {
  private buffer: AuditEvent[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> | null = null;
  private droppedCount = 0;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxBufferSize: number;
  private readonly onError: (error: unknown, buffered: number) => void;

  constructor(
    private readonly sink: AuditSink,
    private readonly clock: Clock,
    options: AuditLoggerOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 1_000;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.maxBufferSize = options.maxBufferSize ?? 10_000;
    this.onError = options.onError ?? (() => undefined);
  }

  get dropped(): number {
    return this.droppedCount;
  }

  get pending(): number {
    return this.buffer.length;
  }

  start(): void {
    this.timer ??= setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  record(input: AuditInput): void {
    this.buffer.push(toAuditEvent(input, new Date(this.clock.now())));
    this.trim();
    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /** Writes everything buffered. Concurrent calls share the same flush. */
  flush(): Promise<void> {
    this.flushing ??= this.drain().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, this.maxBatchSize);
      try {
        await this.sink.write(batch);
      } catch (error) {
        this.buffer.unshift(...batch);
        this.trim();
        this.onError(error, this.buffer.length);
        return;
      }
    }
  }

  private trim(): void {
    const excess = this.buffer.length - this.maxBufferSize;
    if (excess > 0) {
      this.buffer.splice(0, excess);
      this.droppedCount += excess;
    }
  }
}
