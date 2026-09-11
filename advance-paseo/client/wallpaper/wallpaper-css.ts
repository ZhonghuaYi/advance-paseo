// Builds the wallpaper enhancement stylesheet from the neutral tints and the
// user's style options. Extracted from the engine so the controller stays
// small and the visual rules can be unit-tested.

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
export const LAYER_ID = "paseo-advance-wallpaper";
export const STYLE_ID = "paseo-advance-wallpaper-style";
export const ROOT_ATTRIBUTE = "data-paseo-advance-wallpaper";
export const CLEANUP_PROPERTY = "__paseoAdvanceCleanup";
export const IMAGE_PROPERTY = "--paseo-advance-wallpaper-image";
export const CHAT_SURFACE_ATTRIBUTE = "data-paseo-advance-chat-surface";
export const CHAT_CLEAR_ATTRIBUTE = "data-paseo-advance-chat-clear";
export const WORKSPACE_SIDEBAR_ATTRIBUTE = "data-paseo-advance-workspace-sidebar";
export const RIGHT_SIDEBAR_ATTRIBUTE = "data-paseo-advance-right-sidebar";
export const WORKSPACE_TABS_ATTRIBUTE = "data-paseo-advance-workspace-tabs";
export const SETTINGS_SURFACE_ATTRIBUTE = "data-paseo-advance-settings-surface";
export const SETTINGS_SIDEBAR_ATTRIBUTE = "data-paseo-advance-settings-sidebar";
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

export function buildWallpaperCss(options: WallpaperStyleOptions): string {
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

  const chatScrimLight = rgbaString(LIGHT_BACKGROUND, scaledAlpha(0.72, scrim));
  const chatScrimDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.74, scrim));
  const sidebarTintLight = rgbaString([255, 255, 255], scaledAlpha(0.28, scrim));
  const sidebarTintDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.3, scrim));
  const sidebarVeilLight = rgbaString(LIGHT_BACKGROUND, scaledAlpha(0.42, scrim));
  const sidebarVeilDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.4, scrim));
  const sidebarFillLight = rgbaString([255, 255, 255], scaledAlpha(0.24, scrim));
  const sidebarFillDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.28, scrim));
  const tabsTintLight = rgbaString([255, 255, 255], scaledAlpha(0.42, scrim));
  const tabsTintDark = rgbaString(WALLPAPER_TINTS.darkTabs, scaledAlpha(0.46, scrim));
  const fileScrimLight = rgbaString(LIGHT_BACKGROUND, scaledAlpha(0.72, scrim));
  const fileScrimDark = rgbaString(DARK_BACKGROUND, scaledAlpha(0.74, scrim));

  const imageLayer = (color: string) => `linear-gradient(${color}, ${color})`;

  return `
/* This hidden node owns cleanup state; the selected content surfaces paint the image. */
#${LAYER_ID} {
  display: none !important;
}

/* The two identical color stops create one uniform scrim, not a directional mask. */
html[${ROOT_ATTRIBUTE}="light"] [${CHAT_SURFACE_ATTRIBUTE}] {
  background-image:
    ${imageLayer(chatScrimLight)},
    var(${IMAGE_PROPERTY}) !important;
  background-position: center right !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
}

html[${ROOT_ATTRIBUTE}="dark"] [${CHAT_SURFACE_ATTRIBUTE}] {
  background-image:
    ${imageLayer(chatScrimDark)},
    var(${IMAGE_PROPERTY}) !important;
  background-position: center right !important;
  background-repeat: no-repeat !important;
  background-size: cover !important;
}

@media (min-width: 721px) {
  /* The stream and composer are siblings. Clear only their ancestor paths so
   * their nearest shared container can paint one continuous illustration. */
  html[${ROOT_ATTRIBUTE}] [${CHAT_CLEAR_ATTRIBUTE}] {
    background-color: transparent !important;
    background-image: none !important;
  }

  /* Desktop chrome uses the same glass language as the chat. The left
   * workspace list, the right explorer dock, and the settings screen's own
   * sidebar are marked at runtime because their outer React Native Web
   * wrappers do not have stable class names. Each shell owns a faint copy of
   * the wallpaper. Paseo's native sidebar surface is opaque, so
   * backdrop-filter alone would otherwise have nothing textured to blur. */
  html[${ROOT_ATTRIBUTE}] [${WORKSPACE_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}] [${WORKSPACE_SIDEBAR_ATTRIBUTE}] > div,
  html[${ROOT_ATTRIBUTE}] [${RIGHT_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}] [${RIGHT_SIDEBAR_ATTRIBUTE}] > div,
  html[${ROOT_ATTRIBUTE}] [${SETTINGS_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}] [${SETTINGS_SIDEBAR_ATTRIBUTE}] > div {
${sidebarGlass}
    background-clip: padding-box !important;
    background-color: inherit !important;
    isolation: isolate;
  }

  html[${ROOT_ATTRIBUTE}="light"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="light"] [${RIGHT_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="light"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] {
    background-color: ${sidebarTintLight} !important;
    background-image:
      ${imageLayer(sidebarVeilLight)},
      var(${IMAGE_PROPERTY}) !important;
    background-position: right center !important;
    background-repeat: no-repeat !important;
    background-size: cover !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.78),
      0 10px 32px rgba(58, 60, 66, 0.16);
  }

  html[${ROOT_ATTRIBUTE}="dark"] [${WORKSPACE_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="dark"] [${RIGHT_SIDEBAR_ATTRIBUTE}],
  html[${ROOT_ATTRIBUTE}="dark"] [${SETTINGS_SIDEBAR_ATTRIBUTE}] {
    background-color: ${sidebarTintDark} !important;
    background-image:
      ${imageLayer(sidebarVeilDark)},
      var(${IMAGE_PROPERTY}) !important;
    background-position: right center !important;
    background-repeat: no-repeat !important;
    background-size: cover !important;
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

  /* The settings screen's detail pane is a base surface like the chat: the
   * wallpaper plus the chat-grade scrim, while the header row and content
   * wrappers between it and the plugin sections are cleared transparent by
   * the engine so one continuous image shows. Only decorated while one of
   * this plugin's settings screens is actually open. */
  html[${ROOT_ATTRIBUTE}="light"] [${SETTINGS_SURFACE_ATTRIBUTE}] {
    background-image:
      ${imageLayer(chatScrimLight)},
      var(${IMAGE_PROPERTY}) !important;
    background-position: center right !important;
    background-repeat: no-repeat !important;
    background-size: cover !important;
  }

  html[${ROOT_ATTRIBUTE}="dark"] [${SETTINGS_SURFACE_ATTRIBUTE}] {
    background-image:
      ${imageLayer(chatScrimDark)},
      var(${IMAGE_PROPERTY}) !important;
    background-position: center right !important;
    background-repeat: no-repeat !important;
    background-size: cover !important;
  }

  /* Settings cards carry the same sheet glass as the composer and user
   * messages so the settings experience matches the chat's frosted look. */
  html[${ROOT_ATTRIBUTE}] [data-testid="${SETTINGS_CARD_TEST_ID}"] {
${sheetGlass}
    background-clip: padding-box !important;
    border-style: solid !important;
    border-width: 1px !important;
    border-radius: 12px !important;
  }

  html[${ROOT_ATTRIBUTE}="light"] [data-testid="${SETTINGS_CARD_TEST_ID}"] {
    background-color: rgba(255, 255, 255, 0.55) !important;
    border-color: ${rgbaString(LIGHT_RING, 0.28)} !important;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.72),
      0 10px 30px rgba(58, 60, 66, 0.14);
  }

  html[${ROOT_ATTRIBUTE}="dark"] [data-testid="${SETTINGS_CARD_TEST_ID}"] {
    background-color: rgba(18, 20, 26, 0.58) !important;
    border-color: ${rgbaString(DARK_RING, 0.22)} !important;
    box-shadow:
      inset 0 1px 0 ${rgbaString(DARK_RING, 0.12)},
      0 10px 30px rgba(0, 0, 0, 0.22);
  }

  /* User-authored history and the real composer card use the same restrained
   * glass treatment. AI responses and the composer's outer layout stay clear.
   * The message border follows the user's chosen accent family. */
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
   * opaque surface becomes a translucent sheet over the continuous wallpaper.
   * The data-pmono fallback also covers older Paseo builds without the newer
   * markdown tag marker. */
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

  /* CodeMirror normally paints an opaque editor and gutter. Only those two
   * layers are cleared, leaving the rest of the file pane unchanged. A
   * selected Markdown preview paints on its file-pane root because Paseo's
   * preview renderer intentionally has no dedicated DOM identifier. */
  html[${ROOT_ATTRIBUTE}="light"] [data-testid="file-source-editor"],
  html[${ROOT_ATTRIBUTE}="light"]
    [data-testid="workspace-file-pane"]:has(
      [data-testid="file-mode-preview"][aria-selected="true"]
    ) {
    background-image:
      ${imageLayer(fileScrimLight)},
      var(${IMAGE_PROPERTY}) !important;
    background-position: center right !important;
    background-repeat: no-repeat !important;
    background-size: cover !important;
  }

  html[${ROOT_ATTRIBUTE}="dark"] [data-testid="file-source-editor"],
  html[${ROOT_ATTRIBUTE}="dark"]
    [data-testid="workspace-file-pane"]:has(
      [data-testid="file-mode-preview"][aria-selected="true"]
    ) {
    background-image:
      ${imageLayer(fileScrimDark)},
      var(${IMAGE_PROPERTY}) !important;
    background-position: center right !important;
    background-repeat: no-repeat !important;
    background-size: cover !important;
  }

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
    background-position: center right;
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
    background-position: center right;
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

/* Compact layouts keep Paseo's original opaque surfaces. */
@media (max-width: 720px) {
  html[${ROOT_ATTRIBUTE}] [${CHAT_SURFACE_ATTRIBUTE}] {
    background-image: none !important;
  }
}
`;
}
