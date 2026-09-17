// Builds the wallpaper stylesheet from the neutral tints and the user's
// style options. Extracted from the engine so the controller stays small
// and the visual rules can be unit-tested.
//
// Architecture: the wallpaper paints ONCE as a base coat on <html> (the
// canvas background — it never unmounts, so no view transition can flash
// it away). The host resolves every full-bleed surface color through CSS
// variables (react-native-unistyles CSSVars mode), so the surface0 /
// surface-sidebar / surface-workspace variables are redirected to
// transparent while the wallpaper is active: every screen — present and
// future — shows the base coat without any per-element discovery. Glass
// refinement (backdrop-filter + translucent tints) is layered on specific
// surfaces by runtime marking; it now samples the base coat directly.

import {
  ACCENT_HEXES,
  blurTiers,
  CARD_TINTS,
  hexToRgb,
  rgbaString,
  scaledAlpha,
  WALLPAPER_TINTS,
  type Rgb,
  type WallpaperStyleOptions,
} from "./palettes";
import { BLUR_RANGE, SCRIM_RANGE } from "../../shared/wallpaper";

// Attribute and custom-property names shared with the runtime controller.
export const STYLE_ID = "paseo-advance-wallpaper-style";
export const ROOT_ATTRIBUTE = "data-paseo-advance-wallpaper";
export const CLEANUP_PROPERTY = "__paseoAdvanceCleanup";
export const IMAGE_PROPERTY = "--paseo-advance-wallpaper-image";
export const WORKSPACE_SIDEBAR_ATTRIBUTE = "data-paseo-advance-workspace-sidebar";
export const RIGHT_SIDEBAR_ATTRIBUTE = "data-paseo-advance-right-sidebar";
export const WORKSPACE_TABS_ATTRIBUTE = "data-paseo-advance-workspace-tabs";
export const SETTINGS_SIDEBAR_ATTRIBUTE = "data-paseo-advance-settings-sidebar";
/** Set by the engine on root-level opaque literal-paint covers (layers that
 * paint a solid theme color directly, outside the CSS-variable system). */
export const OPAQUE_COVER_ATTRIBUTE = "data-paseo-advance-opaque-cover";
/** Set by the engine on host settings cards found by their visual fingerprint. */
export const SETTINGS_CARD_ATTRIBUTE = "data-paseo-advance-settings-card";
/** testID our settings sections put on every host SettingsCard. */
export const SETTINGS_CARD_TEST_ID = "advance-settings-card";

const LIGHT_BACKGROUND: Rgb = WALLPAPER_TINTS.lightBackground;
const DARK_BACKGROUND: Rgb = WALLPAPER_TINTS.darkBackground;
const LIGHT_RING: Rgb = WALLPAPER_TINTS.lightRing;
const DARK_RING: Rgb = WALLPAPER_TINTS.darkRing;

function accentRgb(options: WallpaperStyleOptions, mode: "light" | "dark"): Rgb {
  return hexToRgb(ACCENT_HEXES[options.accent][mode]);
}

/** Backdrop-filter pair, or an empty string when blur is disabled. */
function glass(blurPx: number, saturate: number): string {
  if (blurPx <= 0) return "";
  return [
    `    -webkit-backdrop-filter: blur(${blurPx}px) saturate(${saturate});`,
    `    backdrop-filter: blur(${blurPx}px) saturate(${saturate});`,
  ].join("\n");
}

/** Class-scoped shell transparency. Only class tokens that survive the
 * engine's unistyles-rule scan are passed in; anything else is dropped so a
 * corrupt discovery cannot inject arbitrary selectors. */
function shellTransparency(shellClasses: readonly string[]): string {
  const selectors = shellClasses.filter((token) => /^[a-z0-9_-]+$/u.test(token));
  if (selectors.length === 0) {
    return "/* No shell classes discovered yet; shells keep their theme paint. */";
  }
  const selectorList = selectors.map((token) => `.${token}`).join(",\n  ");
  return [
    `html[${ROOT_ATTRIBUTE}] ${selectorList} {`,
    "  background-color: transparent !important;",
    "}",
  ].join("\n");
}

export function buildWallpaperCss(
  options: WallpaperStyleOptions,
  shellClasses: readonly string[] = [],
): string {
  // Re-clamp defensively: options may flow in from unvalidated callers.
  const scrim = Math.min(SCRIM_RANGE.max, Math.max(SCRIM_RANGE.min, Math.round(options.scrim)));
  const blur = blurTiers(
    Math.min(BLUR_RANGE.max, Math.max(BLUR_RANGE.min, Math.round(options.blur))),
  );
  const sidebarGlass = glass(blur.sidebar, 1.18);
  const sheetGlass = glass(blur.sheet, 1.16);
  const tabsGlass = glass(blur.sheet, 1.14);
  const codeGlass = glass(blur.code, 1.12);

  const lightAccent = accentRgb(options, "light");
  const darkAccent = accentRgb(options, "dark");
  const cardTint = CARD_TINTS[options.accent];

  // The base coat carries the scrim that keeps text readable over arbitrary
  // images; the slider scales it exactly like the old chat surfaces did.
  const chatScrimLight = rgbaString(LIGHT_BACKGROUND, scaledAlpha(0.72, scrim));
  const chatScrimDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.74, scrim));
  const sidebarTintLight = rgbaString([255, 255, 255], scaledAlpha(0.28, scrim));
  const sidebarTintDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.3, scrim));
  const sidebarFillLight = rgbaString([255, 255, 255], scaledAlpha(0.24, scrim));
  const sidebarFillDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.28, scrim));
  const tabsTintLight = rgbaString([255, 255, 255], scaledAlpha(0.42, scrim));
  const tabsTintDark = rgbaString(WALLPAPER_TINTS.darkTabs, scaledAlpha(0.46, scrim));

  const imageLayer = (color: string) => `linear-gradient(${color}, ${color})`;
  const sidebarSelector = `[${WORKSPACE_SIDEBAR_ATTRIBUTE}],\n  [${RIGHT_SIDEBAR_ATTRIBUTE}],\n  [${SETTINGS_SIDEBAR_ATTRIBUTE}]`;

  return `
/* Base coat: the wallpaper and its scrim paint once on the canvas (<html>).
 * The canvas background can never unmount, so view switches — including
 * multi-commit route swaps and bootstrap splash frames — cannot flash it
 * away. */
html[${ROOT_ATTRIBUTE}="light"] {
  background-color: ${rgbaString(LIGHT_BACKGROUND, 1)};
  background-image:
    ${imageLayer(chatScrimLight)},
    var(${IMAGE_PROPERTY});
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

html[${ROOT_ATTRIBUTE}="dark"] {
  background-color: ${rgbaString(DARK_BACKGROUND, 1)};
  background-image:
    ${imageLayer(chatScrimDark)},
    var(${IMAGE_PROPERTY});
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
}

/* The static body anti-flash color must never cover the canvas. */
html[${ROOT_ATTRIBUTE}] body {
  background-color: transparent !important;
  background-image: none !important;
}

/* Blanket transparency, scoped narrowly.
 *
 * surface-sidebar / surface-workspace are only consumed by full-bleed
 * containers, so their variables redirect globally. surface0 is ALSO the
 * fill of popups (e.g. the host picker list) and small controls, so a
 * global redirect would make those unreadable — instead the engine scans
 * the host's unistyles stylesheet for the full-bleed SHELL class signature
 * (a layout property like flex:1 together with background
 * var(--colors-surface0)) and only those classes become transparent.
 * Elevated surfaces — cards, menus, popovers (surface1/surface2/popover,
 * and popup-shaped surface0) — keep their opaque theme colors. Root layers
 * that paint literal colors outside the variable system are cleared
 * individually below via OPAQUE_COVER_ATTRIBUTE. */
html[${ROOT_ATTRIBUTE}] {
  --colors-surface-sidebar: transparent !important;
  --colors-surface-workspace: transparent !important;
}

${shellTransparency(shellClasses)}

/* Root-level covers: full-viewport layers the host paints with literal
 * theme colors (outside the variables). The engine marks them at runtime;
 * without this they would sit over the canvas and hide the base coat. */
html[${ROOT_ATTRIBUTE}] [${OPAQUE_COVER_ATTRIBUTE}] {
  background-color: transparent !important;
  background-image: none !important;
}

@media (min-width: 721px) {
  /* Desktop chrome glass: the marked sidebars keep their identity with a
   * translucent tint and backdrop blur that now samples the base coat. */
  html[${ROOT_ATTRIBUTE}] ${sidebarSelector} {
${sidebarGlass}
    background-clip: padding-box !important;
    isolation: isolate;
  }

  html[${ROOT_ATTRIBUTE}="light"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="light"] [${RIGHT_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="light"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] {
    background-color: ${sidebarTintLight} !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 10px 32px rgba(58, 60, 66, 0.16);
  }

  html[${ROOT_ATTRIBUTE}="dark"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="dark"] [${RIGHT_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="dark"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] {
    background-color: ${sidebarTintDark} !important;
    box-shadow:
      inset 0 1px 0 ${rgbaString(DARK_RING, 0.11)},
      0 10px 32px rgba(0, 0, 0, 0.30);
  }

  html[${ROOT_ATTRIBUTE}="light"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}] > div,
  html[${ROOT_ATTRIBUTE}="light"] [${RIGHT_SIDEBAR_ATTRIBUTE}] > div,
  html[${ROOT_ATTRIBUTE}="light"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] > div {
    background-color: ${sidebarFillLight} !important;
  }

  html[${ROOT_ATTRIBUTE}="dark"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}] > div,
  html[${ROOT_ATTRIBUTE}="dark"] [${RIGHT_SIDEBAR_ATTRIBUTE}] > div,
  html[${ROOT_ATTRIBUTE}="dark"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] > div {
    background-color: ${sidebarFillDark} !important;
  }

  html[${ROOT_ATTRIBUTE}="light"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="light"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] {
    border-right: 1px solid ${rgbaString(LIGHT_RING, 0.28)} !important;
  }

  html[${ROOT_ATTRIBUTE}="dark"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="dark"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] {
    border-right: 1px solid ${rgbaString(DARK_RING, 0.22)} !important;
  }

  html[${ROOT_ATTRIBUTE}="light"] [${RIGHT_SIDEBAR_ATTRIBUTE}] {
    border-left: 1px solid ${rgbaString(LIGHT_RING, 0.28)} !important;
  }

  html[${ROOT_ATTRIBUTE}="dark"] [${RIGHT_SIDEBAR_ATTRIBUTE}] {
    border-left: 1px solid ${rgbaString(DARK_RING, 0.22)} !important;
  }

  /* The horizontal workspace tab bar gets a lighter sheet so the tab labels
   * remain crisp while the area still reads as part of the glass chrome. */
  html[${ROOT_ATTRIBUTE}] [${WORKSPACE_TABS_ATTRIBUTE}] {
${tabsGlass}
    background-clip: padding-box !important;
  }

  html[${ROOT_ATTRIBUTE}="light"] [${WORKSPACE_TABS_ATTRIBUTE}] {
    background-color: ${tabsTintLight} !important;
    border-bottom: 1px solid ${rgbaString(LIGHT_RING, 0.22)} !important;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
  }

  html[${ROOT_ATTRIBUTE}="dark"] [${WORKSPACE_TABS_ATTRIBUTE}] {
    background-color: ${tabsTintDark} !important;
    border-bottom: 1px solid ${rgbaString(DARK_RING, 0.18)} !important;
    box-shadow: inset 0 1px 0 ${rgbaString(DARK_RING, 0.09)};
  }

  /* Settings cards — our own (by testID) and host pages' (marked by the
   * engine from their card fingerprint) — carry the same sheet glass as the
   * composer and user messages. */
  html[${ROOT_ATTRIBUTE}] [data-testid="${SETTINGS_CARD_TEST_ID}"],
  html[${ROOT_ATTRIBUTE}] [${SETTINGS_CARD_ATTRIBUTE}] {
${sheetGlass}
    background-clip: padding-box !important;
    border-style: solid !important;
    border-width: 1px !important;
    border-radius: 12px !important;
  }

  html[${ROOT_ATTRIBUTE}="light"] [data-testid="${SETTINGS_CARD_TEST_ID}"],
  html[${ROOT_ATTRIBUTE}="light"] [${SETTINGS_CARD_ATTRIBUTE}] {
    background-color: rgba(255, 255, 255, 0.55) !important;
    border-color: ${rgbaString(LIGHT_RING, 0.28)} !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.72),
      0 10px 30px rgba(58, 60, 66, 0.14);
  }

  html[${ROOT_ATTRIBUTE}="dark"] [data-testid="${SETTINGS_CARD_TEST_ID}"],
  html[${ROOT_ATTRIBUTE}="dark"] [${SETTINGS_CARD_ATTRIBUTE}] {
    background-color: rgba(18, 20, 26, 0.58) !important;
    border-color: ${rgbaString(DARK_RING, 0.22)} !important;
    box-shadow:
      inset 0 1px 0 ${rgbaString(DARK_RING, 0.12)},
      0 10px 30px rgba(0, 0, 0, 0.22);
  }

  /* User-authored history and the real composer card use the same restrained
   * glass treatment. AI responses and the composer's outer layout stay
   * translucent to the base coat. The message border follows the user's
   * chosen accent family. */
  html[${ROOT_ATTRIBUTE}] [data-testid="user-message"] > :first-child > :first-child,
  html[${ROOT_ATTRIBUTE}] [data-testid="message-input-root"] > div:has(
      [data-composer-input],
      [data-testid="composer-readonly-content"]
    ) {
${sheetGlass}
    background-clip: padding-box !important;
    border-style: solid !important;
    border-width: 1px !important;
  }

  html[${ROOT_ATTRIBUTE}="light"]
    [data-testid="user-message"] > :first-child > :first-child {
    background-color: rgba(255, 255, 255, 0.52) !important;
    border-color: ${rgbaString(lightAccent, 0.86)} !important;
    border-width: 2px !important;
    border-radius: 14px !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.72),
      0 0 0 1px ${rgbaString(lightAccent, 0.18)},
      0 8px 28px rgba(58, 60, 66, 0.12);
  }

  html[${ROOT_ATTRIBUTE}="light"]
    [data-testid="message-input-root"] > div:has(
      [data-composer-input],
      [data-testid="composer-readonly-content"]
    ) {
    background-color: rgba(255, 255, 255, 0.58) !important;
    border-color: ${rgbaString(LIGHT_RING, 0.28)} !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.76),
      0 10px 30px rgba(58, 60, 66, 0.14);
  }

  html[${ROOT_ATTRIBUTE}="dark"]
    [data-testid="user-message"] > :first-child > :first-child {
    background-color: ${rgbaString(cardTint, 0.5)} !important;
    border-color: ${rgbaString(darkAccent, 0.94)} !important;
    border-width: 2px !important;
    border-radius: 14px !important;
    box-shadow:
      inset 0 1px 0 ${rgbaString(darkAccent, 0.22)},
      0 0 0 1px ${rgbaString(darkAccent, 0.2)},
      0 8px 28px rgba(0, 0, 0, 0.18);
  }

  html[${ROOT_ATTRIBUTE}="dark"]
    [data-testid="message-input-root"] > div:has(
      [data-composer-input],
      [data-testid="composer-readonly-content"]
    ) {
    background-color: rgba(18, 20, 26, 0.56) !important;
    border-color: ${rgbaString(DARK_RING, 0.22)} !important;
    box-shadow:
      inset 0 1px 0 ${rgbaString(DARK_RING, 0.12)},
      0 10px 30px rgba(0, 0, 0, 0.22);
  }

  /* Fenced Markdown blocks in the chat keep their syntax colors, but the
   * opaque surface becomes a translucent sheet over the base coat. */
  html[${ROOT_ATTRIBUTE}] [data-testid="assistant-message"]
    [data-paseo-markdown-tag="pre"],
  html[${ROOT_ATTRIBUTE}] [data-testid="assistant-message"] div[data-pmono] {
${codeGlass}
    background-clip: padding-box !important;
    border-style: solid !important;
    border-width: 1px !important;
    border-radius: 12px !important;
  }

  html[${ROOT_ATTRIBUTE}="light"] [data-testid="assistant-message"]
    [data-paseo-markdown-tag="pre"],
  html[${ROOT_ATTRIBUTE}="light"] [data-testid="assistant-message"] div[data-pmono] {
    background-color: rgba(255, 255, 255, 0.34) !important;
    border-color: ${rgbaString(LIGHT_RING, 0.3)} !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.62),
      0 8px 22px rgba(58, 60, 66, 0.10);
  }

  html[${ROOT_ATTRIBUTE}="dark"] [data-testid="assistant-message"]
    [data-paseo-markdown-tag="pre"],
  html[${ROOT_ATTRIBUTE}="dark"] [data-testid="assistant-message"] div[data-pmono] {
    background-color: rgba(14, 16, 22, 0.46) !important;
    border-color: ${rgbaString(DARK_RING, 0.26)} !important;
    box-shadow:
      inset 0 1px 0 ${rgbaString(DARK_RING, 0.1)},
      0 8px 22px rgba(0, 0, 0, 0.24);
  }

  /* CodeMirror paints its editor and gutter with literal colors outside the
   * theme variables; only those layers are cleared so the base coat shows
   * through the file editor. */
  html[${ROOT_ATTRIBUTE}] [data-testid="file-source-editor"] .cm-editor,
  html[${ROOT_ATTRIBUTE}] [data-testid="file-source-editor"] .cm-scroller,
  html[${ROOT_ATTRIBUTE}] [data-testid="file-source-editor"] .cm-content,
  html[${ROOT_ATTRIBUTE}] [data-testid="file-source-editor"] .cm-gutters {
    background-color: transparent !important;
  }

  /* Paseo's diff is painted into an opaque canvas. A low-opacity overlay is
   * the only way to carry the illustration through without fading code text. */
  html[${ROOT_ATTRIBUTE}] [data-testid="git-diff-canvas-root"] {
    isolation: isolate;
  }

  html[${ROOT_ATTRIBUTE}] [data-testid="git-diff-canvas-root"]::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 6;
    pointer-events: none;
    background-image: var(${IMAGE_PROPERTY});
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
  }

  html[${ROOT_ATTRIBUTE}="light"] [data-testid="git-diff-canvas-root"]::after {
    opacity: 0.10;
    mix-blend-mode: multiply;
  }

  html[${ROOT_ATTRIBUTE}="dark"] [data-testid="git-diff-canvas-root"]::after {
    opacity: 0.14;
    mix-blend-mode: screen;
  }

  /* xterm paints an opaque WebGL/canvas surface, so making its surrounding
   * div transparent cannot reveal a wallpaper. A restrained, non-interactive
   * image layer keeps terminal glyphs and ANSI colors fully opaque. */
  html[${ROOT_ATTRIBUTE}] [data-testid="terminal-surface"] {
    isolation: isolate;
  }

  html[${ROOT_ATTRIBUTE}] [data-testid="terminal-surface"]::after {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    background-image: var(${IMAGE_PROPERTY});
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
  }

  html[${ROOT_ATTRIBUTE}="light"] [data-testid="terminal-surface"]::after {
    opacity: 0.18;
    mix-blend-mode: multiply;
  }

  html[${ROOT_ATTRIBUTE}="dark"] [data-testid="terminal-surface"]::after {
    opacity: 0.20;
    mix-blend-mode: screen;
  }
}
`;
}
