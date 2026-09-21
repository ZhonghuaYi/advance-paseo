# advance-paseo

A Paseo plugin that bundles incremental enhancements for the Paseo app —
arbitrary wallpapers, automatic provider-catalog refresh, a Chinese /
English interface, and live chat overlays (a floating TODO card with the
current plan plus a tokens/sec meter) — built as a feature-module system so
new capabilities slot in without touching existing ones.

成功安装并启用后，请在 Paseo 的 **Settings → Plugins → Advance Paseo** 中配置各功能。

## Features

### Language / 语言

The plugin's settings screens render in English or 中文. The preference
(`Auto` / `English` / `中文`) lives at the top of the settings screen and swaps
every feature's text live; `Auto` detects the locale from the browser
(desktop/web) or the React Native host (mobile) and falls back to English.

### Wallpaper（任意壁纸）

Paints any image behind Paseo's chat and glass surfaces (desktop/web app;
mobile keeps native surfaces). Successor to
[paseo-miku-theme](https://github.com/ZhonghuaYi/paseo-miku-theme), shipping
its own neutral theme pair — *Advance Cream* (light) / *Advance Indigo*
(dark) — that stays balanced under arbitrary wallpapers.
Select either theme from Paseo's Settings → Appearance page; Paseo owns
persistence and fallback when a contributing host is unavailable.

- **Import & manage**: pick images in the settings screen; they are downscaled
  to ≤2560 px and re-encoded as WebP in the app, then stored daemon-side under
  `~/.paseo/advance-paseo/wallpapers/`. Assign one image per light/dark slot.
- **Path reference**: alternatively point a slot at an image file on the
  daemon machine (read as-is, no copy).
- **Painted surfaces**: the wallpaper paints once behind the whole app (a
  base coat on the html canvas) and shows on every screen — chat, workspace,
  settings (all pages), new-workspace, and future views — because the host's
  full-bleed surface colors are redirected to transparent at the CSS-variable
  level. Frosted-glass refinement (backdrop blur + translucent tints) is
  layered on the sidebars, tab strip, settings cards, message cards, code
  blocks, terminals, and diffs.
- **Activation modes**:
  - *System themes only* (default) — the wallpaper paints while a built-in
    Paseo theme is active and turns off when one of this plugin's own themes
    (Advance Cream / Advance Indigo) is selected.
  - *All themes* — paints over every theme.
  - Both resolve the light/dark slot from the host's active-theme class on
    `<html>` (deterministic; no color sampling).
- Style options: scrim strength (50–150%) and glass blur (0–40 px) adjusted
  with drag sliders that preview live and persist on release (the host UI kit
  ships no slider, so `client/ui/slider-row.tsx` builds one from React Native
  core primitives), each flanked by the original three-step presets as
  quick-pick chips, plus a message-accent family select. Values are clamped
  to the documented ranges in the settings schema; documents stored by the
  original three-step presets migrate automatically.

> Mechanism note: Paseo's theme API is colors-only and offers no background,
> CSS, or layer capability, so the wallpaper is a DOM-injection enhancement.
> It rides on the host's own CSS-variable theming (react-native-unistyles
> CSSVars mode): the wallpaper paints as the canvas background on `<html>`,
> and the `--colors-surface0/-sidebar/-workspace` variables are redirected to
> transparent while the wallpaper is active, so every screen shows it without
> per-element DOM discovery — nothing a view switch does can cover or flash
> it. If the host stops exposing those variables, the engine stays dormant
> and the plain color themes keep working. Elevated surfaces (menus,
> popovers, cards) keep their opaque theme colors for readability. Known
> trade-off: modal backdrops that dim via `surface0` stop dimming while the
> wallpaper is active.

### Providers auto-refresh（providers 自动刷新）

Paseo caches its provider catalog (models, modes) and only re-discovers it on
an explicit refresh — so changing models in Claude Code previously required a
manual refresh in Paseo's settings. This feature watches provider CLI config
files and triggers `paseo.providers.refresh()` whenever one actually changes.

- Defaults: `~/.claude/settings.json` and `~/.claude.json`; add/remove paths
  (e.g. `~/.codex/config.toml`) in the settings screen.
- Content is sha256-compared, so no-op rewrites never refresh; save bursts are
  collapsed by a configurable quiet period.
- A status card shows armed state, watched-file existence, and the last
  change/refresh/error, plus a manual "refresh now" action.

### Live chat overlays（聊天实时浮层）

Two floating overlays injected over each visible conversation (desktop/web;
mobile keeps native surfaces):

- **TODO card** — pinned to the chat viewport's top-right corner, showing the
  active agent's latest todo list (status dots: pending / in-progress /
  completed, with a done-count header and click-to-collapse). When the agent
  presented a plan, the card carries it as a **GOAL** section. Rows are capped
  by a settings-controlled limit with a `+N more` row.
- **Chat text shift** — while the card is visible, the chat column's content
  is padded right by a configurable amount (0–360 px, default 200), moving
  the centered message text left so it never renders under the card. The
  shift applies only to panes showing a card and disappears with it.
- **Tokens/sec meter** — a small frosted pill at the conversation's bottom
  right showing live output tokens/sec (12 s sliding window over
  `usage_updated` events), the turn's output count, and context-window
  pressure; the final reading freezes after each turn until the next begins.
- Each pane tracks its own agent: the active tab's test id
  (`workspace-tab-agent_<id>` with `aria-selected`) resolves the binding, a
  single-agent pane binds without the aria signal, and a pane keeps its last
  agent in focus mode. Data comes from a per-agent timeline subscription
  (latest `todo` item, latest plan tool call, usage events) plus one tail
  history fetch per binding; seq numbers keep stale history from overwriting
  live updates. Card colors follow the detected light/dark paint under each
  chat, including wallpaper-frosted shells.

## Install

Requires Paseo ≥ 0.8.0 with plugins enabled (`pluginsEnabled: true` in the
daemon's `config.json`).

```bash
cd advance-paseo
npm install
npm run typecheck && npm test
paseo plugin install "$(pwd)/advance-paseo"
```

After source edits:

```bash
paseo plugin reload advance-paseo
paseo plugin logs advance-paseo
```

## Project layout

```
advance-paseo/              ← the installable plugin directory
  paseo-plugin.json         ← manifest: id + Paseo version requirement
  index.client.tsx          ← client entry: aggregates feature contributions
  index.server.ts           ← daemon entry: aggregates feature contributions
  client/                   ← app-side code (React Native primitives only)
    dom.d.ts                ← minimal ambient DOM typings (typecheck only)
    web.ts                  ← web-only DOM helpers (file picker, canvas, locale)
    settings-screen.tsx     ← one section per feature
    ui/                     ← shared plugin-local widgets (slider row)
    i18n/                   ← dictionaries (en/zh), language store, language UI
    wallpaper/              ← engine, css builder, palettes, detection, UI
    live-chat/              ← floating TODO card + tokens/sec meter (model,
                              engine, settings UI)
    providers/              ← watcher status UI
  server/                   ← daemon-side code (full Node access)
    wallpaper-store.ts      ← image storage under ~/.paseo/advance-paseo/
    providers-watch.ts      ← fs.watch + hash-compare + refresh trigger
    paths.ts                ← shared path helpers
  shared/                   ← Zod contracts imported by both runtimes
    wallpaper.ts            ← settings schema + wallpaper RPCs
    providers.ts            ← settings schema + watcher RPCs
    live-chat.ts            ← settings schema (overlays are client-only)
```

## Adding a feature module

Every feature is self-contained and follows the same recipe. The plugin's
entries stay dumb aggregators.

1. **Contracts** — create `shared/<feature>.ts`:
   - a Zod settings schema wrapped in `defineSettings({ id: "advance-<feature>", scope: "host", version: 1, schema })`
     (register it in `index.server.ts` so it persists daemon-side),
   - `defineRpc` contracts for any daemon-side work. Names must match
     `/^[a-z][a-z0-9._-]*$/` (lowercase only; no camelCase segments).
2. **Server side** — implement handlers in `server/<feature>.ts`, export a
   `register<Feature>(server): () => void` that calls `server.handle(...)` and
   returns its cleanup, then wire it in `index.server.ts`.
   - Handlers receive `{ paseo }` (the SDK: workspaces, agents, providers,
     config). The server entry itself has no `paseo` — if a background worker
     needs one, have the client call an activation RPC whose handler captures
     the session (see `providers-watch.ts`).
3. **Client side** — create `client/<feature>/`:
   - `contribute.ts` exporting `contribute<Feature>(client): () => void`
     (called from `index.client.tsx`; return the cleanup),
   - a settings section component added to `client/settings-screen.tsx`.
4. **Text** — never hard-code UI strings: add keys to both dictionaries in
   `client/i18n/dictionaries.ts` (`en` is the source of truth; `zh` must match
   key-for-key — a unit test enforces this) and consume them through the
   `useText()` hook; `{placeholder}` templates fill via `format()`.
5. **UI rules** — React Native primitives only (`View`/`Text`/`Pressable`/
   `Image`/`TextInput`); colors from `theme.colors`; respect
   `layout.compact`. DOM access goes in `client/web.ts` (web-gated) or a
   guarded engine module; ambient DOM typings belong in `client/dom.d.ts`.
6. **Tests** — pure logic (schemas, CSS builders, classifiers) gets vitest
   coverage next to its module (`*.test.ts`).

Verify with `npm run typecheck && npm test`, then
`paseo plugin reload advance-paseo` and `paseo plugin logs advance-paseo`.

## Development workflow

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest run
paseo plugin reload advance-paseo   # after any source edit
paseo plugin ls                     # expect: running
paseo plugin logs advance-paseo     # stdout/stderr of the daemon subprocess
```

## Limitations & notes

- The wallpaper is a progressive-enhancement DOM hack inherited from
  paseo-miku-theme; a Paseo UI update can break surface discovery until
  selectors are adjusted (`client/wallpaper/engine.ts`,
  `client/wallpaper/wallpaper-css.ts`).
- Wallpaper images move over the plugin RPC as data URLs (≈1–2 MiB after
  client-side re-encoding). Path-referenced files are not re-encoded and are
  capped at 24 MiB.
- The provider watcher arms when a client connects (the activation RPC needs
  a handler session). If no app is connected, watching is dormant until the
  next client startup; the settings screen re-arms on every change.
