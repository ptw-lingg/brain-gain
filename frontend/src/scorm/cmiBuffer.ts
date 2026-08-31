// The app-side dirty buffer between bridge messages and the commit API. Values arriving from the
// wrapper merge in (newest wins per key); a flush TAKES the current diff but the buffer only
// forgets it on explicit ack — a failed POST puts the batch back, so nothing is ever dropped
// before a 2xx. Pure and framework-free.

const PAGEHIDE_BUDGET_BYTES = 60_000; // fetch keepalive's 64 KB limit, with headroom

// The subset that must survive a dying tab when the full buffer won't fit: completion evidence
// outranks the resume bookmark.
const COMPLETION_KEYS = [
  'cmi.core.lesson_status',
  'cmi.completion_status',
  'cmi.success_status',
  'cmi.core.score.raw',
  'cmi.core.score.min',
  'cmi.core.score.max',
  'cmi.score.scaled',
  'cmi.score.raw',
  'cmi.core.lesson_location',
  'cmi.location',
  'cmi.core.session_time',
  'cmi.session_time',
  'cmi.core.exit',
  'cmi.exit',
];

export class CmiBuffer {
  private dirty = new Map<string, string>();
  private inFlight = new Map<string, string>();

  merge(values: Record<string, string>): void {
    for (const [k, v] of Object.entries(values)) this.dirty.set(k, v);
  }

  get dirtyCount(): number {
    return this.dirty.size + this.inFlight.size;
  }

  /** Take everything pending (incl. an un-acked previous batch) as one flushable diff. */
  take(): Record<string, string> | null {
    for (const [k, v] of this.dirty) this.inFlight.set(k, v);
    this.dirty.clear();
    if (this.inFlight.size === 0) return null;
    return Object.fromEntries(this.inFlight);
  }

  /** The POST succeeded — the taken batch is durable server-side. */
  ack(): void {
    this.inFlight.clear();
  }

  /** The POST failed — the batch stays pending and rides along with the next flush. */
  nak(): void {
    // Newer writes win over the failed batch's values.
    for (const [k, v] of this.dirty) this.inFlight.set(k, v);
    this.dirty = this.inFlight;
    this.inFlight = new Map();
  }

  /**
   * The pagehide payload: the full pending diff when it fits the keepalive budget, else the
   * completion-relevant subset (resume position is worth less than completion evidence).
   */
  takeForPagehide(): Record<string, string> | null {
    const all = this.take();
    if (!all) return null;
    const size = Object.entries(all).reduce((n, [k, v]) => n + k.length + v.length + 4, 0);
    if (size <= PAGEHIDE_BUDGET_BYTES) return all;
    const trimmed: Record<string, string> = {};
    for (const key of COMPLETION_KEYS) if (key in all) trimmed[key] = all[key];
    return trimmed;
  }
}
