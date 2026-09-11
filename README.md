# advance-paseo

A Paseo plugin that bundles incremental enhancements for the Paseo app —
starting with arbitrary wallpapers and automatic provider-catalog refresh —
built as a feature-module system so new capabilities slot in without touching
existing ones.

成功安装并启用后，请在 Paseo 的 **Settings → Plugins → Advance Paseo** 中配置各功能。

## Features

### Wallpaper（任意壁纸）

Paints any image behind Paseo's chat and glass surfaces (desktop/web app;
mobile keeps native surfaces). Successor to
[paseo-miku-theme](https://github.com/ZhonghuaYi/paseo-miku-theme) — its Miku
Future palettes ship here as presets.

- **Import & manage**: pick images in the settings screen; they are downscaled
  to ≤2560 px and re-encoded as WebP in the app, then stored daemon-side under
  `~/.paseo/advance-paseo/wallpapers/`. Assign one image per light/dark slot.
- **Path reference**: alternatively point a slot at an image file on the
  daemon machine (read as-is, no copy).
- **Activation modes**:
  - *Plugin themes only* (default, reliable) — the wallpaper paints while one
    of this plugin's themes is selected (Advance Cream / Advance Indigo /
    Miku Future Light / Dark), detected through unique marker colors.
  - *Any theme* (heuristic) — paints over whatever theme is active, choosing
    the light/dark slot by the interface's detected luminance.
- Style options: visibility scrim, glass blur, message accent family.

> Mechanism note: Paseo's theme API is colors-only, so the wallpaper is a
> DOM-injection enhancement layered on top of the registered color themes
> (inherited from paseo-miku-theme). It degrades gracefully: if Paseo's
> internal DOM changes, the plugin falls back to the plain color themes. Do
> not run this together with `miku-future` — both inject glass styling.

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
    web.ts                  ← web-only DOM helpers (file picker, canvas)
    settings-screen.tsx     ← one section per feature
    wallpaper/              ← engine, css builder, palettes, detection, UI
    providers/              ← watcher status UI
  server/                   ← daemon-side code (full Node access)
    wallpaper-store.ts      ← image storage under ~/.paseo/advance-paseo/
    providers-watch.ts      ← fs.watch + hash-compare + refresh trigger
    paths.ts                ← shared path helpers
  shared/                   ← Zod contracts imported by both runtimes
    wallpaper.ts            ← settings schema + wallpaper RPCs
    providers.ts            ← settings schema + watcher RPCs
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
4. **UI rules** — React Native primitives only (`View`/`Text`/`Pressable`/
   `Image`/`TextInput`); colors from `theme.colors`; respect
   `layout.compact`. DOM access goes in `client/web.ts` (web-gated) or a
   guarded engine module; ambient DOM typings belong in `client/dom.d.ts`.
5. **Tests** — pure logic (schemas, CSS builders, classifiers) gets vitest
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
