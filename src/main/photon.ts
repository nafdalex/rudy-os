/**
 * PhotonChannel — receive and send iMessage through a Photon (Spectrum) project.
 *
 * The inbound half is an OUTWARD gRPC stream (`app.messages`), not a server: the
 * process dials Photon and holds the connection open. That is the whole reason
 * this channel costs so little — no bound port, no public tunnel, no inbound
 * firewall hole, and nothing to re-paste when the app restarts (contrast the
 * Slack/webhook servers, which need tunnelmole and mint a fresh ephemeral URL on
 * every start).
 *
 * SECURITY — iMessage has no request signature to verify. Slack authenticates
 * every delivery with an HMAC; here the ONLY thing standing between a stranger's
 * text and an agent with filesystem access is the SENDER ALLOWLIST. So:
 *   - a message from a handle that is not on the list is dropped SILENTLY. It is
 *     never acked, never reacted to, never written to the ledger — any reply at
 *     all would confirm to a stranger that the line is live and automated,
 *   - the project secret is read through a THUNK at use time (never captured at
 *     construction), mirroring `SlackReplyServerOptions.getBotToken`, so rotating
 *     it in Settings takes effect without a restart and no copy is retained here,
 *   - delivery is AT-LEAST-ONCE, so every inbound is de-duplicated by message id
 *     before it can reach the trigger gate. Without that a redelivered directive
 *     runs twice.
 *
 * Runs in the Electron main process. Deliberately free of any `electron` import
 * so it can be unit-/smoke-tested as a plain Node module — same posture as
 * `slack.ts` and `webhook.ts`.
 */

// NOTE: `spectrum-ts` (and its @spectrum-ts/* deps) are ESM-only. The Electron
// main process is bundled as CommonJS and `externalizeDepsPlugin()` turns a
// static import of a dependency into `require('spectrum-ts')`, which throws
// ERR_REQUIRE_ESM at load. It is imported dynamically inside `start()` instead —
// Rollup preserves dynamic import() in CJS output, which can load ESM. Do not
// hoist this to a top-level import. (Same treatment as `tunnelmole` in
// webhook.ts / slack.ts.)

/* ────────────────────────── structural SDK surface ────────────────────────
 * Spectrum's public types are deeply generic (the platform definition threads
 * through Space/Message/instance). We need four fields and three calls, so the
 * boundary is pinned with the narrow structural types below and the dynamic
 * import is cast to them ONCE, at the seam. That keeps this module compiling
 * against the shape we actually rely on instead of inferring a large generic
 * graph, and makes a breaking SDK change surface here rather than as a cascade
 * of inference errors across the file. The shapes mirror @spectrum-ts/core:
 * `Message { id, content, sender?, space, direction }`,
 * `Reaction { type: 'reaction', emoji, target: Message }`. */

/** A resolved conversation. `id` is the stable handle we persist on a card. */
export interface PhotonSpace {
  readonly id: string;
  send(content: unknown): Promise<{ readonly id: string } | undefined>;
  responding<T>(fn: () => T | Promise<T>): Promise<T>;
}

export interface PhotonMessageContent {
  type: string;
  text?: string;
  emoji?: string;
  target?: { readonly id: string };
}

/** One inbound message as the SDK hands it to us. */
export interface PhotonMessage {
  readonly id: string;
  content: PhotonMessageContent;
  sender?: { readonly id: string };
  space: PhotonSpace;
  direction: 'inbound' | 'outbound';
  react(emoji: string): Promise<unknown>;
}

interface SpectrumApp {
  readonly messages: AsyncIterable<[PhotonSpace, PhotonMessage]>;
  stop(): Promise<void>;
}

/* ─────────────────────────────── public types ────────────────────────────── */

/** A verified, allowlisted inbound text plus the coordinates to reply to it. */
export interface PhotonInbound {
  text: string;
  spaceId: string;
  messageId: string;
  /** The sender's handle, for the trigger-history `peer` column. */
  from: string;
}

/** An inbound tapback. `targetId` is the message the tapback was placed ON —
 *  the correlation key that maps it back to a pending approval prompt. */
export interface PhotonReaction {
  emoji: string;
  targetId: string;
  spaceId: string;
  from: string;
}

export interface PhotonChannelOptions {
  projectId: string;
  /** Read at use time so a rotated secret needs no restart; never retained. */
  getProjectSecret: () => string | undefined;
  /** Handles permitted to drive this office. EMPTY MEANS NOBODY, never "anyone" —
   *  a misconfiguration must fail closed. */
  allowlist: string[];
  onMessage: (m: PhotonInbound) => void | Promise<void>;
  onReaction: (r: PhotonReaction) => void | Promise<void>;
}

/** Every send resolves — it never rejects — mirroring `postSlackReply`, so a
 *  transport failure can never take down a poll tick or an approval path. */
export interface PhotonSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/* ──────────────────────────────── constants ──────────────────────────────── */

/** How many recently-seen message ids to remember for de-duplication. Bounded so
 *  a long-lived session cannot grow it without limit. Mirrors the SeenEvents cap
 *  in slack-trigger.cjs. */
const SEEN_MESSAGES_MAX = 500;

/** iMessage has no message-length API limit worth trusting and, more to the
 *  point, a wall of text is unreadable on a phone. Anything longer is cut at a
 *  line boundary and the remainder is offered as a file. */
const MAX_IMESSAGE_CHARS = 800;

/** Reconnect backoff bounds for a dropped stream. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

/* ─────────────────────────────── helpers ─────────────────────────────────── */

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Canonical form of an iMessage handle, so the allowlist matches what a human
 * would call "the same person".
 *
 * A handle arrives as a phone number or an email, and the phone form is not
 * stable: `+1 (555) 123-4567`, `+15551234567` and `5551234567` are all the same
 * line. Emails fold to lowercase; phone-ish values keep digits only, and a
 * leading US country code is dropped so a user who typed their number the way
 * they'd say it still matches what Apple sends.
 */
export function normalizeHandle(raw: string): string {
  const h = raw.trim().toLowerCase();
  if (h.includes('@')) return h;
  const digits = h.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits || h;
}

/** Is this sender permitted to drive the office? Empty list = nobody. */
export function isAllowed(sender: string | undefined, allowlist: string[]): boolean {
  if (!sender) return false;
  const want = normalizeHandle(sender);
  if (!want) return false;
  return allowlist.some((a) => normalizeHandle(a) === want);
}

/**
 * Fit a result into something readable on a phone.
 *
 * iMessage renders NO markup — `*bold*` and `:white_check_mark:` arrive as
 * literal characters — so agent output aimed at Slack has to be de-marked rather
 * than passed through. Long bodies are cut at a LINE boundary (never mid-word)
 * and the remainder is handed back so the caller can attach it as a file.
 */
export function formatForIMessage(
  raw: string,
  maxChars = MAX_IMESSAGE_CHARS
): { text: string; overflow?: string } {
  const plain = raw
    .replace(/```[a-z]*\n?/gi, '')          // fenced-code delimiters
    .replace(/`([^`]+)`/g, '$1')             // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1')       // bold (md)
    .replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2') // bold (slack mrkdwn)
    .replace(/(^|\s)_([^_\n]+)_/g, '$1$2')   // italic
    .replace(/^#{1,6}\s+/gm, '')             // headings
    .replace(/:[a-z0-9_+-]+:/gi, '')         // emoji shortcodes
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (plain.length <= maxChars) return { text: plain };

  // Prefer the last line break inside the budget; fall back to a hard cut only
  // when a single line is itself longer than the budget.
  const window = plain.slice(0, maxChars);
  const cut = window.lastIndexOf('\n');
  const head = (cut > maxChars * 0.5 ? window.slice(0, cut) : window).trimEnd();
  const rest = plain.slice(head.length).trim();
  const more = Math.round(rest.length / 100) / 10;
  return { text: `${head}\n\n…(+${more}k more, attached)`, overflow: rest };
}

/** Bounded FIFO of ids we have already processed. */
class SeenMessages {
  private readonly order: string[] = [];
  private readonly set = new Set<string>();
  constructor(private readonly max = SEEN_MESSAGES_MAX) {}
  /** true when this id was already seen (and records it when it was not). */
  seen(id: string): boolean {
    if (this.set.has(id)) return true;
    this.set.add(id);
    this.order.push(id);
    if (this.order.length > this.max) {
      const dropped = this.order.shift();
      if (dropped !== undefined) this.set.delete(dropped);
    }
    return false;
  }
  get size(): number { return this.set.size; }
}

/* ──────────────────────────────── the channel ────────────────────────────── */

export class PhotonChannel {
  private app: SpectrumApp | null = null;
  private running = false;
  private consuming: Promise<void> | null = null;
  private readonly seen = new SeenMessages();
  /** Spaces we have heard from this session, so a reply can address them without
   *  a round trip. Keyed by space id. */
  private readonly spaces = new Map<string, PhotonSpace>();
  private reconnectDelay = RECONNECT_BASE_MS;

  constructor(private readonly opts: PhotonChannelOptions) {}

  /** Is the stream currently up? */
  isRunning(): boolean {
    return this.running && this.app != null;
  }

  /**
   * Connect and begin consuming. Resolves once the FIRST connection attempt has
   * settled, so the caller (and the Settings UI) learns about a bad credential
   * immediately instead of discovering it in a log later. After that the consume
   * loop owns reconnection and this returns.
   */
  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.running) return { ok: false, error: 'already running' };
    const secret = this.opts.getProjectSecret();
    if (!this.opts.projectId || !secret) {
      return { ok: false, error: 'missing Photon project id or secret' };
    }
    if (this.opts.allowlist.length === 0) {
      // Fail closed. An allowlist-less iMessage line is an open shell.
      return { ok: false, error: 'sender allowlist is empty; refusing to open an ungated line' };
    }
    try {
      const connected = await this.connect(secret);
      if (!connected.ok) return connected;
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
    this.running = true;
    this.consuming = this.consumeForever();
    return { ok: true };
  }

  /** One connection attempt. Split out so the reconnect loop can reuse it. */
  private async connect(secret: string): Promise<{ ok: boolean; error?: string }> {
    const { Spectrum } = (await import('spectrum-ts')) as unknown as {
      Spectrum: (o: Record<string, unknown>) => Promise<SpectrumApp>;
    };
    const { imessage } = (await import('spectrum-ts/providers/imessage')) as unknown as {
      imessage: { config: () => unknown };
    };
    this.app = await Spectrum({
      projectId: this.opts.projectId,
      projectSecret: secret,
      providers: [imessage.config()]
    });
    return { ok: true };
  }

  /** Stop consuming and drop the connection. Best-effort and safe to re-call. */
  async stop(): Promise<void> {
    this.running = false;
    const app = this.app;
    this.app = null;
    this.spaces.clear();
    if (app) {
      try { await app.stop(); } catch { /* already gone */ }
    }
    this.consuming = null;
  }

  /**
   * The consume loop. A dropped stream is EXPECTED (laptop sleeps, network
   * flaps), so it reconnects with exponential backoff rather than dying — a
   * channel that silently stops receiving texts is worse than one that is
   * visibly off. Dedup happens inside `handle`, which is what makes an
   * at-least-once redelivery after reconnect harmless.
   */
  private async consumeForever(): Promise<void> {
    while (this.running) {
      try {
        const app = this.app;
        if (!app) throw new Error('not connected');
        for await (const [space, message] of app.messages) {
          if (!this.running) break;
          this.spaces.set(space.id, space);
          try { await this.handle(message); }
          catch (e) { console.error('[photon] handler failed:', errMsg(e)); }
        }
        // A clean end of stream is still a disconnect; fall through to backoff.
      } catch (e) {
        if (!this.running) return;
        console.error('[photon] stream error:', errMsg(e));
      }
      if (!this.running) return;
      await new Promise((r) => setTimeout(r, this.reconnectDelay));
      if (!this.running) return;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      const secret = this.opts.getProjectSecret();
      if (!secret) { console.error('[photon] secret unavailable; stopping'); this.running = false; return; }
      try {
        await this.connect(secret);
        this.reconnectDelay = RECONNECT_BASE_MS; // recovered
        console.log('[photon] stream reconnected');
      } catch (e) {
        console.error('[photon] reconnect failed:', errMsg(e));
      }
    }
  }

  /** Route one inbound message. Everything here is gated on the allowlist. */
  private async handle(message: PhotonMessage): Promise<void> {
    if (message.direction !== 'inbound') return;   // our own sends echo back
    const sender = message.sender?.id;
    // SILENT drop — see the SECURITY note at the top of the file.
    if (!isAllowed(sender, this.opts.allowlist)) return;
    if (this.seen.seen(message.id)) return;        // at-least-once → dedupe

    const content = message.content;
    if (content.type === 'reaction') {
      const targetId = content.target?.id;
      if (!targetId || !content.emoji) return;
      await this.opts.onReaction({
        emoji: content.emoji,
        targetId,
        spaceId: message.space.id,
        from: sender ?? 'unknown'
      });
      return;
    }

    const text = (content.text ?? '').trim();
    if (!text) return;                              // attachment-only, nothing to route
    await this.opts.onMessage({
      text,
      spaceId: message.space.id,
      messageId: message.id,
      from: sender ?? 'unknown'
    });
  }

  /** Send text into a space. Never rejects. */
  async send(spaceId: string, text: string): Promise<PhotonSendResult> {
    const space = this.spaces.get(spaceId);
    if (!space) return { ok: false, error: `no live handle for space ${spaceId}` };
    try {
      const sent = await space.send(text);
      return { ok: true, messageId: sent?.id };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  /** Show a typing indicator for the duration of `fn`. Best-effort. */
  async responding<T>(spaceId: string, fn: () => T | Promise<T>): Promise<T> {
    const space = this.spaces.get(spaceId);
    if (!space) return fn();
    try { return await space.responding(fn); }
    catch { return fn(); }
  }

  /** Place a tapback on a message we have a live handle for. Never rejects. */
  async react(spaceId: string, messageId: string, emoji: string): Promise<PhotonSendResult> {
    const space = this.spaces.get(spaceId);
    if (!space) return { ok: false, error: `no live handle for space ${spaceId}` };
    try {
      // `space.getMessage` is the documented way to act on a message known only
      // by id (the inbound object itself is long gone by reply time).
      const withGet = space as PhotonSpace & { getMessage?: (id: string) => Promise<PhotonMessage | undefined> };
      const target = await withGet.getMessage?.(messageId);
      if (!target) return { ok: false, error: 'message not found' };
      await target.react(emoji);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMsg(e) };
    }
  }

  /** Space ids seen this session — used by the reply path to decide whether a
   *  target is still addressable after a restart. */
  knownSpaces(): string[] {
    return [...this.spaces.keys()];
  }
}

/* ─────────────────────── loopback reply endpoint ─────────────────────────── */

/**
 * PhotonReplyServer — a 127.0.0.1-only endpoint that lets a spawned agent post
 * into an iMessage thread WITHOUT ever holding the Photon project secret.
 *
 * The agent runs `resources/rudy-photon-reply.cjs`, which reads `{port, token}`
 * from a 0600 discovery file and POSTs here; this process does the actual send.
 * Same shape and same reasoning as `SlackReplyServer` in slack.ts — the agent
 * gets a capability (a per-session token that can only post), never a credential.
 *
 * NOT tunnel-forwarded and never bound off-loopback: unlike the webhook server
 * this has no business being reachable from anywhere but this machine.
 */
export interface PhotonReplyServerOptions {
  /** Secret the helper echoes in `x-md-reply-token`. Per-session, not persisted. */
  token: string;
  /** Performs the actual send. Injected so this class holds no credential. */
  send: (spaceId: string, text: string) => Promise<PhotonSendResult>;
  /** Told which task a direct reply covered, so the done-notifier stays quiet. */
  onReplied?: (taskId: string) => void;
}

/** Reject bodies larger than this before buffering. Mirrors slack.ts/webhook.ts. */
const REPLY_MAX_BODY_BYTES = 1024 * 1024;

export class PhotonReplyServer {
  private server: import('node:http').Server | null = null;

  constructor(private readonly opts: PhotonReplyServerOptions) {}

  async start(preferredPort = 0): Promise<{ ok: boolean; port?: number; error?: string }> {
    if (this.server) return { ok: false, error: 'already running' };
    const { createServer } = await import('node:http');
    return new Promise((resolve) => {
      const server = createServer((req, res) => { void this.handle(req, res); });
      const onError = (e: Error): void => {
        server.removeAllListeners('listening');
        this.server = null;
        resolve({ ok: false, error: e.message });
      };
      server.once('error', onError);
      server.once('listening', () => {
        server.removeListener('error', onError);
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : undefined;
        this.server = server;
        resolve(port ? { ok: true, port } : { ok: false, error: 'no port assigned' });
      });
      // '127.0.0.1' ONLY — nothing about this endpoint is safe to expose.
      server.listen(preferredPort, '127.0.0.1');
    });
  }

  stop(): void {
    try { this.server?.close(); } catch { /* already closing */ }
    this.server = null;
  }

  private async handle(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse
  ): Promise<void> {
    // Defence in depth: the bind already excludes non-loopback peers.
    if (!isLoopback(req.socket.remoteAddress ?? '')) { res.writeHead(403); res.end(); return; }
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== '/reply') {
      res.writeHead(404); res.end(); return;
    }
    if (!this.checkToken(req.headers['x-md-reply-token'])) { res.writeHead(401); res.end(); return; }

    let body = '';
    let aborted = false;
    for await (const chunk of req) {
      if (aborted) return;
      body += chunk;
      if (body.length > REPLY_MAX_BODY_BYTES) {
        aborted = true;
        res.writeHead(413); res.end();
        req.destroy();
        return;
      }
    }

    let parsed: { spaceId?: unknown; text?: unknown; taskId?: unknown };
    try { parsed = JSON.parse(body); }
    catch { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'bad json' })); return; }
    if (typeof parsed.spaceId !== 'string' || typeof parsed.text !== 'string'
      || !parsed.spaceId.trim() || !parsed.text.trim()) {
      res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'spaceId and text required' }));
      return;
    }

    const { text } = formatForIMessage(parsed.text);
    const r = await this.opts.send(parsed.spaceId, text);
    // Only a DELIVERED reply suppresses the summary — a failed one must still
    // leave the done-notifier free to try.
    if (r.ok && typeof parsed.taskId === 'string' && parsed.taskId) {
      try { this.opts.onReplied?.(parsed.taskId); } catch { /* never break the reply */ }
    }
    res.writeHead(r.ok ? 200 : 502, { 'content-type': 'application/json' });
    res.end(JSON.stringify(r));
  }

  private checkToken(provided: string | string[] | undefined): boolean {
    if (typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(this.opts.token);
    // Length must match before timingSafeEqual (it throws otherwise); this leaks
    // only the length, which is fixed and public anyway.
    if (a.length !== b.length) return false;
    return timingSafeEqualSync(a, b);
  }
}

/** Local copies so this module keeps its zero-electron, low-import posture.
 *  `integrationBroker.ts` already sets the precedent of copying `isLoopback`
 *  rather than exporting it from slack.ts. */
function isLoopback(addr: string): boolean {
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return a === '::1' || a === '127.0.0.1' || a.startsWith('127.');
}

function timingSafeEqualSync(a: Buffer, b: Buffer): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { timingSafeEqual } = require('node:crypto') as typeof import('node:crypto');
  return timingSafeEqual(a, b);
}
