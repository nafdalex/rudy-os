# Rudy OS — Spec

A desktop control room for the Claude Code agents you already run in terminals. Each agent is a Sims-style avatar in a shared 2D workspace; you can watch them work, send them commands, and configure their goals/skills/MCP from one place.

---

## 1. Product shape

### What it is
- **Electron desktop app**, macOS-first.
- Renders a single 2D canvas ("the floor") populated by **avatars**, one per registered Claude Code session.
- Each avatar represents a real `claude` process running in a tmux pane somewhere on the machine.
- Avatars **walk around**, visit stations (file shelf, web portal, terminal station, etc.) based on what tool the underlying agent is using.
- A side panel shows the raw terminal stream for whichever avatar is selected. A command bar lets you type into that agent.

### What it explicitly is NOT (for MVP)
- Not a replacement for the `claude` CLI. The CLI is the runtime; this app is a viewer/controller.
- Not an agent-to-agent message bus. Avatars don't hand things off to each other yet. (Deferred to v2.)
- Not a remote dashboard. Local sessions only. No web access, no auth.
- Not a code editor. We show terminal output, not source files.

---

## 2. Architecture: the two data planes

This is the load-bearing design decision. Everything else follows from it.

```
┌───────────────────────────────────────────────────────────────┐
│                     Electron Renderer                          │
│   ┌──────────────────┐    ┌──────────────────────────────┐    │
│   │ Avatar Canvas    │    │ Terminal View + Command Bar  │    │
│   │ (Pixi.js)        │    │ (xterm.js, read-only-ish)   │    │
│   └─────────▲────────┘    └────────────▲─────────────────┘    │
│             │                          │                       │
│             │ avatar state             │ pty bytes             │
└─────────────┼──────────────────────────┼───────────────────────┘
              │                          │
       ┌──────┴──────────┐        ┌──────┴─────────────┐
       │  Event Plane    │        │  Terminal Plane    │
       │  (hooks → IPC)  │        │  (tmux pipe-pane)  │
       └──────▲──────────┘        └──────▲─────────────┘
              │                          │
              │ JSON events              │ raw bytes
       ┌──────┴──────────────────────────┴─────────────┐
       │           Claude Code processes               │
       │  (running in tmux panes the user already has) │
       └───────────────────────────────────────────────┘
```

### Terminal Plane (raw pty)
- Powered by **tmux**. Each registered agent = one tmux `{session}:{window}.{pane}` triple.
- **Read** terminal output: `tmux pipe-pane -O -t <pane> 'cat >> /tmp/cth/<id>.log'` (or stream via an open file watcher).
- **Send input**: `tmux send-keys -t <pane> "..." Enter`.
- The xterm.js view in the app tails the log; user typing in the command bar becomes `send-keys`.

### Event Plane (structured agent state)
- Powered by **Claude Code hooks**, configured in each agent's `settings.json` (or via env var override).
- Hooks the app installs:
  - `UserPromptSubmit` → avatar "wakes up"
  - `PreToolUse` → avatar starts walking to the station matching the tool
  - `PostToolUse` → avatar walks back carrying an artifact
  - `Notification` → avatar waves; toast in the UI
  - `Stop` → avatar idle at desk; badge if there's unread output
  - `SubagentStop` → spawns/despawns child avatar (v2)
- Each hook runs a tiny shim: `cth-hook` (a Node CLI we ship). It reads the hook's JSON from stdin, tags it with the session id, and POSTs to a Unix domain socket at `~/.cth/events.sock` that the Electron main process owns.

**Why both planes?** Hooks alone don't give you the raw stream the user expects to see. The tmux pipe alone doesn't tell you which tool is running without fragile output parsing. Together: the canvas is event-driven; the terminal view is byte-for-byte authentic.

---

## 3. Registering an agent

How an avatar comes to exist.

### Option A — User adds existing pane (MVP path)
1. User runs `claude` somewhere in tmux as usual.
2. In the app: **"Add agent"** button → app calls `tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_current_command} #{pane_current_path}'`.
3. App shows candidate panes (filtered to those running `claude` or `node`).
4. User picks one, names it, picks a sprite/color.
5. App:
   - Writes a per-project hook config to `<cwd>/.claude/settings.local.json` merging in the `cth-hook` shims.
   - Starts `pipe-pane` on the tmux pane.
   - Reads existing scrollback with `tmux capture-pane -p -S -1000`.
   - Avatar appears on the floor.

### Option B — Spawn from app (later)
- "New agent" button → app spawns a new tmux pane and starts `claude` in it with the right hooks pre-wired.
- Simpler UX, but requires us to own session lifecycle. Defer.

### What if the user closes the tmux pane?
- pipe-pane file goes silent; periodic `tmux list-panes` probe detects the pane is gone; avatar enters a "ghost" state for 30s, then is archived.

---

## 4. The Sims metaphor — mapping events to behavior

### The floor
- One large 2D scene. Background is a stylized "workshop" with **stations**:
  - **Desk** (per avatar) — home base, idle position
  - **File shelf** — for Read/Write/Edit
  - **Terminal station** — for Bash
  - **Web portal** — for WebFetch/WebSearch
  - **MCP corner** — for any `mcp__*` tool (sub-stations per server)
  - **Task board** — for TodoWrite
  - **Mailbox** — for Notification (visible when something needs the user)

### Avatar state machine
```
idle ──UserPromptSubmit──▶ alert
alert ──PreToolUse──▶ thinking(→station) ──arrival──▶ working(station)
working ──PostToolUse──▶ thinking(→desk) ──arrival──▶ idle (or next tool)
thinking ──PreToolUse──▶ thinking(→new station)   (loop)
working ──Stop──▶ success ──250ms──▶ idle
any ──Notification──▶ blocked (waving at mailbox)
any ──tmux pane gone──▶ ghost ──30s──▶ archived
```

`thinking` is the **in-motion + reasoning** state. The avatar walks (physical animation) while the badge reads "thinking" (cognitive state). One state, two readings.

### Movement
- Pixi.js scene; avatars are sprite-based, 32×32 or 64×64.
- Pathing: simple A* on a coarse grid, or just lerp to target — overkill for MVP, plain lerp is fine.
- Multiple agents in the same project share a "room" (visual zone). Different cwds → different rooms with named doors.

### What the user sees at a glance
- Avatar at the file shelf reaching up → "agent is reading or writing a file"
- Avatar at the terminal station with motion lines → "agent is running a bash command"
- Avatar standing at mailbox waving → "agent is blocked, wants your input"
- Avatar sitting at desk → "done, awaiting next prompt"

This is the demo. If this is fun to watch, the product works.

---

## 5. Configuration per agent

Each avatar has a **config drawer** (right-click → Configure):

- **Name & sprite** (cosmetic, persisted in app DB)
- **Working directory** (read-only; derived from tmux pane)
- **Skills enabled** — toggles that edit the project's `.claude/settings.json` `enabledMcpjsonServers` / skill allowlist
- **MCP servers** — list of MCP servers attached for this session; toggle on/off
- **Hooks** — show which hooks the app has installed; option to add custom ones
- **Goal / system prompt prefix** — see §6
- **Model** — Opus / Sonnet / Haiku selector that writes to the project's settings
- **Permission mode** — default / acceptEdits / bypassPermissions / plan

All of this is *just a GUI over `settings.json`*. The app is not inventing config; it's editing the files Claude Code already reads.

---

## 6. The "/goal" question

You mentioned `/goal` — there's no built-in slash command by that name in Claude Code as of early 2026. Three possibilities:

1. **You meant a custom slash command** (user-defined skill in `~/.claude/skills/goal/`). If so: the app should let you pick which skills are exposed per agent and surface them as quick-action buttons next to the avatar.
2. **You meant a persistent goal/objective**, like a long-running directive an agent should pursue across prompts. This isn't a CC feature but is easy to implement here: the app maintains a "goal" string per avatar and prepends it to each user prompt before `send-keys`, or installs it as a `UserPromptSubmit` hook that injects context.
3. **You saw it somewhere recent.** If so, point me at it and we'll wire to the real thing.

**Spec'd behavior for now**: each avatar has a `goal` field (free text). On send, the app prefixes the user's command with `<goal>...</goal>` context (or injects via `UserPromptSubmit` hook — cleaner because it doesn't pollute the visible transcript). User toggles whether goal is active per-send.

Also surface, per avatar:
- **Skills picker** (anything in `~/.claude/skills/` or `<cwd>/.claude/skills/`)
- **Subagents picker** (anything in `~/.claude/agents/`)
- **MCP picker**

---

## 7. Sending commands from the app

Command bar at the bottom of the selected agent's panel. Three input modes:

- **Free prompt**: types into the pane via `tmux send-keys`, then `Enter`.
- **Slash command**: same path, but autocomplete from the agent's available skills.
- **Quick actions**: buttons for things like "/clear", "Stop", "Continue", "Run goal".

Edge cases:
- If the agent is mid-tool, app warns: "agent is busy — queue or interrupt?"
- Interrupt = `send-keys Escape` (Claude Code's cancel key).
- Queue = wait for `Stop` event, then send.

---

## 8. Tech stack & key dependencies

| Layer | Pick | Notes |
|---|---|---|
| Shell | Electron | Renderer + Node main |
| UI framework | React + TypeScript | |
| Avatar canvas | **Pixi.js** | Sprite scene, 60fps, easy lerp/tweening. Phaser is overkill. |
| Terminal view | **xterm.js** | Tails pipe-pane log; supports ANSI properly |
| Process control | shelling out to **tmux** | No node-pty needed since we attach |
| Event ingest | **Unix domain socket** at `~/.cth/events.sock` | Node `net.createServer`; hook shim is a tiny CLI that writes JSON+newline |
| Persistence | **SQLite** via better-sqlite3 | Agents, layouts, command history, goals |
| Sprites | Custom or itch.io asset pack | 8 directions × idle/walk/work animations |
| Packaging | electron-builder | `.dmg` for Mac, defer Linux/Windows |

External binaries the user must have: `tmux`. App detects on first run and refuses to start without it (with install instructions).

---

## 9. Data model (SQLite)

```sql
CREATE TABLE agents (
  id            TEXT PRIMARY KEY,        -- uuid
  name          TEXT NOT NULL,
  sprite        TEXT NOT NULL,           -- key into sprite pack
  color         TEXT NOT NULL,
  tmux_target   TEXT NOT NULL,           -- 'session:window.pane'
  cwd           TEXT NOT NULL,
  goal          TEXT,
  created_at    INTEGER NOT NULL,
  archived_at   INTEGER
);

CREATE TABLE events (
  id            INTEGER PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  hook          TEXT NOT NULL,           -- 'PreToolUse', etc
  tool          TEXT,                    -- 'Edit', 'Bash', etc
  payload_json  TEXT NOT NULL
);

CREATE TABLE commands (
  id            INTEGER PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  ts            INTEGER NOT NULL,
  text          TEXT NOT NULL,
  source        TEXT NOT NULL            -- 'user', 'quick_action'
);

CREATE TABLE layout (                    -- avatar positions/rooms
  agent_id      TEXT PRIMARY KEY,
  x             REAL NOT NULL,
  y             REAL NOT NULL,
  room          TEXT NOT NULL
);
```

---

## 10. Risks & open questions

### Risks
- **Hook spec drift.** Claude Code's hook JSON format may evolve. Mitigation: pin the hook shim to a version, surface schema errors in the UI, lazy-fallback to text parsing of tool calls if hooks break.
- **Writing to user's `settings.json`.** Touching their config is intrusive. Mitigation: only ever write to `settings.local.json` (gitignored), back up first, show a diff before applying, and an "uninstall hooks" button.
- **tmux not available / user uses iTerm/kitty/wezterm directly.** No tmux = no app. Mitigation v1: require tmux. v2: shim for iTerm via AppleScript; long-tail other terminals never.
- **The Sims metaphor lands as gimmicky.** Real risk. The mitigation is to make the metaphor *informational* — every animation should actually tell you something you didn't know. If walking-to-the-shelf doesn't convey "is reading a file" faster than a text label, we built a toy.

### Open questions (decide before/while building)
1. **Hook installation scope** — `~/.claude/settings.json` (global, all sessions get hooks) vs per-project `.claude/settings.local.json` (only registered projects). Recommend per-project to keep blast radius small.
2. **Sprites: build or buy?** Buy an asset pack for the prototype, replace later if the product sticks.
3. **What does "goal" actually mean for you?** Long-running directive (item #2 in §6) is my best guess — confirm before we build.
4. **Multi-machine?** If you have agents running on a remote box, do we need a remote daemon? Defer past MVP.
5. **iTerm support deadline.** When (if ever) does this become a blocker?

---

## 11. Milestones

### M0 — Skeleton (1–2 days)
- Electron + React + Pixi shell
- Renders one hardcoded avatar that walks between two fixed positions
- xterm.js wired to a static log file

### M1 — One real agent end-to-end (3–5 days)
- "Add agent" picks a tmux pane
- Installs hook shim into `.claude/settings.local.json`
- Hook events flow over UDS into the app
- Avatar state machine driven by real events
- Command bar sends keys to the pane
- Terminal view tails pipe-pane log
- **Success criterion**: you run `claude` in tmux, register it, ask it to edit a file, watch the avatar walk to the shelf, walk back, and finish at its desk.

### M2 — Multi-agent (3–5 days)
- N agents simultaneously, each in their own room (grouped by cwd)
- Per-agent config drawer (name, sprite, goal, model, permission mode)
- Quick actions, command queueing
- Goal injection via UserPromptSubmit hook
- Persistence: avatars and positions survive app restart

### M3 — Polish (1 week)
- Sprite pack with proper animations
- Sounds (optional, off by default)
- Notification toasts + dock badge
- Onboarding for first-time users (tmux check, hook install consent)
- DMG packaging, code signing

### Out of scope for v1
- Inter-agent handoffs ("agent A passes a file to agent B")
- Remote agents over SSH
- Web/mobile companion
- Non-tmux terminals
- Subagent visualization (parent spawns child avatars)

---

## 12. Decisions captured so far

- **Avatar metaphor**: active Sims-like (agents walk, visit stations).
- **Execution model**: attach to existing terminal sessions (tmux), do not spawn or own the `claude` process.
- **Tech stack**: Electron + React + Pixi.js + xterm.js + SQLite.
- **MVP scope**: N independent agents in a shared workspace; no inter-agent coordination.

## 13. Decisions still needed from you

1. **"/goal" — which of the three interpretations in §6?**
2. **Hooks scope: per-project (recommended) or global?**
3. **How important is iTerm direct support? (If not now, we require tmux.)**
4. **Sprite art: stand-in asset pack OK, or do you want custom?**
5. **Anything in §10 ("Risks & open questions") you'd answer differently?**
