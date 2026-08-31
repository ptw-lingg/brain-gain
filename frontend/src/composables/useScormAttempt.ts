// The app half of the SCORM bridge: launches/resumes the attempt, validates every message from the
// content origin, buffers cmi writes, and flushes them to the server with retries. The flush rules
// are the durability contract of the whole feature:
//   - the dirty buffer is NEVER cleared before a 2xx (a failed POST puts the batch back),
//   - "Finish and sign" stays disabled while anything is unflushed, so a learner can never sign a
//     completion whose evidence is not on the server,
//   - a dying tab flushes via fetch keepalive (sendBeacon cannot carry the Bearer header).
//
// Trust boundary: inbound messages pass SIX checks in order — exact origin, exact source window,
// schema+caps, per-launch nonce, attemptId, monotonic seq — then the window listener is dropped in
// favour of a MessagePort (unreachable from any other frame). Outbound messages always name the
// exact targetOrigin; '*' appears nowhere.

import { computed, onBeforeUnmount, ref, toRaw, type Ref } from 'vue';
import { commitScorm, commitScormKeepalive, launchScorm } from '@/api/scorm';
import { isScormInbound, SCORM_BRIDGE_V, type ScormInbound, type ScormOutbound } from '@/scorm/protocol';
import { CmiBuffer } from '@/scorm/cmiBuffer';
import type { ScormLaunch } from '@/types';

const DEBOUNCE_MS = 2000;
const MAX_DIRTY_MS = 10_000;
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const RATE = { perSec: 50, burst: 100 };

export type ScormPhase = 'idle' | 'launching' | 'running' | 'done' | 'error';
export type ScormFatal = 'expired' | 'origin-mismatch' | 'persist-failed' | 'launch-failed';

export interface UseScormAttempt {
  phase: Ref<ScormPhase>;
  ticket: Ref<ScormLaunch | null>;
  fatal: Ref<ScormFatal | null>;
  dirtyCount: Ref<number>;
  lastSavedAt: Ref<Date | null>;
  saveFailed: Ref<boolean>;
  /** The course's verdict as confirmed by the SERVER's commit responses. */
  completion: Ref<string>;
  success: Ref<string>;
  terminated: Ref<boolean>;
  startedAt: Ref<Date | null>;
  /** Completion-worthy under the package's rule → the Finish button may appear (server re-checks). */
  completionReady: Ref<boolean>;
  canFinish: Ref<boolean>;
  launch: (opts?: { restart?: boolean }) => Promise<void>;
  attachFrame: (el: HTMLIFrameElement) => void;
  /** Flush whatever is pending and tear the bridge down (before the signature dialog opens). */
  closeForSigning: () => Promise<void>;
  teardown: () => void;
}

export function useScormAttempt(trainingId: string, getDurationMinutes?: () => number): UseScormAttempt {
  const phase = ref<ScormPhase>('idle');
  const ticket = ref<ScormLaunch | null>(null);
  const fatal = ref<ScormFatal | null>(null);
  const dirtyCount = ref(0);
  const lastSavedAt = ref<Date | null>(null);
  const saveFailed = ref(false);
  const completion = ref('unknown');
  const success = ref('unknown');
  const terminated = ref(false);
  const startedAt = ref<Date | null>(null);

  const buffer = new CmiBuffer();
  let frameEl: HTMLIFrameElement | null = null;
  let port: MessagePort | null = null;
  let outSeq = 0;
  let lastInSeq = 0;
  let handshakeDone = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let hardDeadline: ReturnType<typeof setTimeout> | null = null;
  let flushing = Promise.resolve();
  let tokens = RATE.burst;
  let tokensAt = Date.now();

  // The 'time' rule is judged server-side from server-clocked activity; the client only ESTIMATES
  // (local elapsed vs the training duration) to decide when to show the button — a premature click
  // just gets a 409 and a hint. Ticker cleared in teardown().
  const timeRuleEstimateMet = ref(false);
  const elapsedMinutes = (): number =>
    startedAt.value ? (Date.now() - startedAt.value.getTime()) / 60000 : 0;
  const timeTicker = setInterval(() => {
    timeRuleEstimateMet.value = elapsedMinutes() >= Math.max(1, getDurationMinutes?.() ?? 10);
  }, 15_000);

  const completionReady = computed(() => {
    const rule = ticket.value?.completionRule ?? 'status';
    if (rule === 'exit') return terminated.value;
    if (rule === 'time') return timeRuleEstimateMet.value;
    return success.value === 'passed' || success.value === 'failed' || completion.value === 'completed';
  });

  const canFinish = computed(
    () => phase.value !== 'error' && completionReady.value && dirtyCount.value === 0 && !saveFailed.value,
  );

  function envelope<T extends ScormOutbound['type']>(type: T, payload: Record<string, unknown>): ScormOutbound {
    outSeq += 1;
    return {
      bg: 'scorm',
      v: SCORM_BRIDGE_V,
      nonce: ticket.value!.nonce,
      attemptId: ticket.value!.attemptId,
      seq: outSeq,
      type,
      ...payload,
    } as ScormOutbound;
  }

  function toWrapper(msg: ScormOutbound): void {
    if (port) port.postMessage(msg);
    else if (frameEl?.contentWindow && ticket.value) {
      // Handshake phase only — always the exact origin, never '*'.
      frameEl.contentWindow.postMessage(msg, ticket.value.contentOrigin);
    }
  }

  function allowMessage(): boolean {
    const now = Date.now();
    tokens = Math.min(RATE.burst, tokens + ((now - tokensAt) / 1000) * RATE.perSec);
    tokensAt = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  }

  // ── flushing ──────────────────────────────────────────────────────────────────────────────────

  function scheduleFlush(): void {
    dirtyCount.value = buffer.dirtyCount;
    if (!debounceTimer) debounceTimer = setTimeout(() => void flush(), DEBOUNCE_MS);
    if (!hardDeadline) hardDeadline = setTimeout(() => void flush(), MAX_DIRTY_MS);
  }

  function clearTimers(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (hardDeadline) clearTimeout(hardDeadline);
    debounceTimer = null;
    hardDeadline = null;
  }

  /** Serialized flush with retries; ackSeq/terminate ride along for the commit/terminate cases. */
  function flush(opts: { ackSeq?: number; terminate?: boolean; exit?: string } = {}): Promise<void> {
    const run = flushing.then(async () => {
      clearTimers();
      if (!ticket.value) return;
      const values = buffer.take();
      if (!values && !opts.terminate) {
        if (opts.ackSeq !== undefined) toWrapper(envelope('ack', { forSeq: opts.ackSeq }));
        dirtyCount.value = buffer.dirtyCount;
        return;
      }
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await commitScorm(ticket.value.attemptId, {
            values: values ?? {},
            ...(opts.terminate ? { terminate: true, exit: opts.exit } : {}),
          });
          buffer.ack();
          saveFailed.value = false;
          lastSavedAt.value = new Date();
          completion.value = result.completion;
          success.value = result.success;
          terminated.value = result.terminated;
          if (opts.ackSeq !== undefined) toWrapper(envelope('ack', { forSeq: opts.ackSeq }));
          break;
        } catch {
          if (attempt >= RETRY_DELAYS_MS.length) {
            // The batch goes BACK into the buffer — nothing is dropped; the learner sees the amber
            // banner and Finish stays disabled until a later flush lands.
            buffer.nak();
            saveFailed.value = true;
            if (opts.ackSeq !== undefined) {
              toWrapper(envelope('nak', { forSeq: opts.ackSeq, reason: 'persist-failed' }));
            }
            break;
          }
          const jitter = Math.random() * 300;
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt] + jitter));
        }
      }
      dirtyCount.value = buffer.dirtyCount;
    });
    flushing = run.catch(() => undefined);
    return run;
  }

  // ── inbound ───────────────────────────────────────────────────────────────────────────────────

  function dispatch(msg: ScormInbound): void {
    switch (msg.type) {
      case 'initialize':
        startedAt.value = startedAt.value ?? new Date();
        break;
      case 'setValues':
        buffer.merge(msg.values);
        scheduleFlush();
        // Receipt is the ack for a set batch: the app buffer is now the reliable store.
        toWrapper(envelope('ack', { forSeq: msg.seq }));
        break;
      case 'commit':
        buffer.merge(msg.values);
        dirtyCount.value = buffer.dirtyCount;
        void flush({ ackSeq: msg.seq });
        break;
      case 'terminate':
        buffer.merge(msg.values);
        dirtyCount.value = buffer.dirtyCount;
        void flush({ ackSeq: msg.seq, terminate: true, exit: msg.exit });
        break;
      case 'resize':
        if (frameEl) {
          const clamped = Math.min(2000, Math.max(420, msg.height));
          frameEl.style.height = `${clamped}px`;
        }
        break;
      case 'diag':
        // eslint-disable-next-line no-console
        console.warn(`scorm[${msg.code}]: ${msg.message}`);
        break;
      case 'ready':
        break; // handled in the handshake path only
    }
  }

  function onPortMessage(e: MessageEvent): void {
    // A port cannot be spoofed by other frames, but the payload is still untrusted content output.
    if (!isScormInbound(e.data)) return;
    if (!ticket.value || e.data.nonce !== ticket.value.nonce) return;
    if (e.data.attemptId !== ticket.value.attemptId) return;
    if (e.data.seq <= lastInSeq) return; // replay/reorder drop
    lastInSeq = e.data.seq;
    if (!allowMessage()) return; // flood drop
    dispatch(e.data);
  }

  function onWindowMessage(e: MessageEvent): void {
    // Handshake only — six checks, in order, then the window listener retires.
    if (!ticket.value) return;
    if (e.origin !== ticket.value.contentOrigin) return; // 1. exact origin
    if (!frameEl || e.source !== frameEl.contentWindow) return; // 2. exact frame
    if (!isScormInbound(e.data)) return; // 3. schema + caps
    if (e.data.nonce !== ticket.value.nonce) return; // 4. per-launch secret
    if (e.data.attemptId !== ticket.value.attemptId) return; // 5. attempt binding
    if (e.data.type !== 'ready' || handshakeDone) return; // 6. exactly one 'ready'
    handshakeDone = true;
    lastInSeq = e.data.seq;

    const channel = new MessageChannel();
    channel.port1.onmessage = onPortMessage;
    // postMessage structured-clones its payload, but ticket.* are Vue reactive proxies (not
    // cloneable) — send PLAIN copies.
    const init = envelope('init', {
      cmi: { ...toRaw(ticket.value.cmi) },
      version: ticket.value.version,
      readOnly: [...ticket.value.readOnly],
    });
    frameEl.contentWindow!.postMessage(init, ticket.value.contentOrigin, [channel.port2]);
    port = channel.port1;
    window.removeEventListener('message', onWindowMessage); // window-level exposure ends here
    phase.value = 'running';
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────

  function onPagehide(): void {
    if (!ticket.value) return;
    const values = buffer.takeForPagehide();
    if (values) commitScormKeepalive(ticket.value.attemptId, { values });
    buffer.ack(); // the keepalive either lands or the learner resumes from the last acked state
  }
  function onVisibility(): void {
    if (document.visibilityState === 'hidden') void flush();
  }

  async function launch(opts: { restart?: boolean } = {}): Promise<void> {
    phase.value = 'launching';
    fatal.value = null;
    handshakeDone = false;
    lastInSeq = 0;
    port?.close();
    port = null;
    try {
      const t = await launchScorm(trainingId, opts.restart === true);
      // Pre-flight invariants — the one deployment mistake that would void the whole isolation
      // design (content on the app origin) REFUSES to run rather than degrade silently.
      const u = new URL(t.url);
      if (u.protocol !== 'https:') throw Object.assign(new Error('insecure'), { kind: 'origin-mismatch' });
      if (u.origin !== t.contentOrigin) throw Object.assign(new Error('origin'), { kind: 'origin-mismatch' });
      if (t.contentOrigin === window.location.origin) {
        throw Object.assign(new Error('same-origin'), { kind: 'origin-mismatch' });
      }
      if (!/^[A-Za-z0-9_-]{20,}$/.test(t.nonce)) throw Object.assign(new Error('nonce'), { kind: 'origin-mismatch' });
      if (Date.parse(t.expiresAt) <= Date.now()) throw Object.assign(new Error('expired'), { kind: 'expired' });
      ticket.value = t;
      completion.value = 'unknown';
      success.value = 'unknown';
      terminated.value = false;
      startedAt.value = new Date();
      window.addEventListener('message', onWindowMessage);
      window.addEventListener('pagehide', onPagehide);
      document.addEventListener('visibilitychange', onVisibility);
    } catch (err) {
      phase.value = 'error';
      fatal.value = ((err as { kind?: ScormFatal }).kind ?? 'launch-failed') as ScormFatal;
      ticket.value = null;
    }
  }

  function attachFrame(el: HTMLIFrameElement): void {
    frameEl = el;
  }

  function teardown(): void {
    clearTimers();
    clearInterval(timeTicker);
    window.removeEventListener('message', onWindowMessage);
    window.removeEventListener('pagehide', onPagehide);
    document.removeEventListener('visibilitychange', onVisibility);
    port?.close();
    port = null;
    if (frameEl) frameEl.src = 'about:blank';
    frameEl = null;
  }

  /** Flush everything, then remove the third-party content from the screen — the signature dialog
   *  must never share the viewport with untrusted content (clickjacking/overlay phishing). */
  async function closeForSigning(): Promise<void> {
    if (port && ticket.value) toWrapper(envelope('close', { reason: 'signed' }));
    await flush();
    teardown();
    phase.value = 'done';
  }

  onBeforeUnmount(() => {
    void flush();
    teardown();
  });

  return {
    phase,
    ticket,
    fatal,
    dirtyCount,
    lastSavedAt,
    saveFailed,
    completion,
    success,
    terminated,
    startedAt,
    completionReady,
    canFinish,
    launch,
    attachFrame,
    closeForSigning,
    teardown,
  };
}
