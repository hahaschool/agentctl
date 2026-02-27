import type { AgentEvent } from '@agentctl/shared';

type TimestampedEvent = {
  event: AgentEvent;
  receivedAt: number;
};

type Subscriber = (event: AgentEvent) => void;

const DEFAULT_MAX_SIZE = 1000;

export class OutputBuffer {
  private readonly buffer: TimestampedEvent[];
  private readonly maxSize: number;
  private readonly subscribers: Set<Subscriber> = new Set();
  private writeIndex = 0;
  private count = 0;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.buffer = new Array<TimestampedEvent>(maxSize);
  }

  push(event: AgentEvent): void {
    const entry: TimestampedEvent = {
      event,
      receivedAt: Date.now(),
    };

    this.buffer[this.writeIndex] = entry;
    this.writeIndex = (this.writeIndex + 1) % this.maxSize;

    if (this.count < this.maxSize) {
      this.count++;
    }

    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  getRecent(n: number): AgentEvent[] {
    const take = Math.min(n, this.count);

    if (take === 0) {
      return [];
    }

    const result: AgentEvent[] = [];

    // Read the most recent `take` entries from the ring buffer.
    // writeIndex points to the next slot to be written, so the most
    // recent entry is at writeIndex - 1 (wrapping around).
    let readIndex = (this.writeIndex - take + this.maxSize) % this.maxSize;

    for (let i = 0; i < take; i++) {
      result.push(this.buffer[readIndex].event);
      readIndex = (readIndex + 1) % this.maxSize;
    }

    return result;
  }

  subscribe(callback: Subscriber): void {
    this.subscribers.add(callback);
  }

  unsubscribe(callback: Subscriber): void {
    this.subscribers.delete(callback);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.writeIndex = 0;
    this.count = 0;
  }
}
