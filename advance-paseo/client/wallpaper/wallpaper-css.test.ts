import { describe, expect, it } from "vitest";
import { buildWallpaperCss } from "./wallpaper-css";

const GRAPHITE_DEFAULT = {
  scrim: 100,
  accent: "graphite",
  blur: 22,
} as const;

describe("buildWallpaperCss", () => {
  it("paints the base coat on the html canvas for both modes", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    for (const mode of ["light", "dark"] as const) {
      const base = css.match(
        new RegExp(`html\\[data-paseo-advance-wallpaper="${mode}"\\] \\{`, "u"),
      );
      expect(base).not.toBeNull();
    }
    // The base coat references the image custom property and covers the canvas.
    expect(css).toContain(`var(--paseo-advance-wallpaper-image)`);
    expect(css).toContain("background-size: cover");
    // The static body anti-flash color must never cover the canvas.
    expect(css).toMatch(/html\[data-paseo-advance-wallpaper\] body \{/);
  });

  it("redirects the sidebar/workspace variables and scopes surface0 to shells", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    // surface-sidebar / surface-workspace only paint full-bleed containers,
    // so they redirect globally...
    expect(css).toContain("--colors-surface-sidebar: transparent");
    expect(css).toContain("--colors-surface-workspace: transparent");
    // ...but surface0 also fills popup lists and small controls, so it must
    // NOT redirect globally — only discovered shell classes go transparent.
    expect(css).not.toContain("--colors-surface0: transparent");
  });

  it("makes only the discovered shell classes transparent", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT, ["unistyles_abc123", "unistyles_def456"]);
    expect(css).toContain(
      "html[data-paseo-advance-wallpaper] .unistyles_abc123,\n  html[data-paseo-advance-wallpaper] .unistyles_def456 {",
    );
    expect(css).toContain("background-color: transparent !important");
    // Hostile tokens never reach the selector list.
    const safe = buildWallpaperCss(GRAPHITE_DEFAULT, ["unistyles_ok", "body}", "x y"]);
    expect(safe).toContain(".unistyles_ok");
    expect(safe).not.toContain("body}");
    // Without discoveries, no class rule is emitted at all.
    const bare = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(bare).not.toContain("html[data-paseo-advance-wallpaper] .unistyles_");
  });

  it("keeps glass refinement for the runtime-marked chrome surfaces", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain("[data-paseo-advance-workspace-sidebar]");
    expect(css).toContain("[data-paseo-advance-right-sidebar]");
    expect(css).toContain("[data-paseo-advance-settings-sidebar]");
    expect(css).toContain("[data-paseo-advance-workspace-tabs]");
    expect(css).toContain('[data-testid="advance-settings-card"]');
    expect(css).toContain("[data-paseo-advance-settings-card]");
  });

  it("keeps the desktop glass breakpoint", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain("@media (min-width: 721px)");
  });

  it("styles the fixed test-id surfaces and modern selectors", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain('[data-testid="user-message"]');
    expect(css).toContain('[data-testid="terminal-surface"]::after');
    expect(css).toContain('[data-testid="git-diff-canvas-root"]::after');
    expect(css).toContain(":has(");
  });

  it("uses the authored base scrim at 100%", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain("rgba(250, 250, 252, 0.72)");
    expect(css).toContain("rgba(16, 18, 24, 0.74)");
  });

  it("scales the base scrim with the percent value", () => {
    const heavy = buildWallpaperCss({ ...GRAPHITE_DEFAULT, scrim: 125 });
    expect(heavy).toContain("rgba(250, 250, 252, 0.9)");
    const light = buildWallpaperCss({ ...GRAPHITE_DEFAULT, scrim: 78 });
    expect(light).toContain("rgba(250, 250, 252, 0.56)");
  });

  it("clamps scaled alphas at full opacity", () => {
    const maxed = buildWallpaperCss({ ...GRAPHITE_DEFAULT, scrim: 150 });
    expect(maxed).toContain("rgba(250, 250, 252, 1)");
  });

  it("uses the graphite accent borders by default", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain("rgba(51, 65, 85, 0.86)");
    expect(css).toContain("rgba(148, 163, 184, 0.94)");
    expect(css).toContain("rgba(21, 24, 33, 0.5)");
  });

  it("switches message accents to magenta", () => {
    const css = buildWallpaperCss({ ...GRAPHITE_DEFAULT, accent: "magenta" });
    expect(css).toContain("rgba(225, 40, 133, 0.86)");
    expect(css).toContain("rgba(255, 126, 190, 0.94)");
    expect(css).toContain("rgba(29, 23, 48, 0.5)");
    expect(css).not.toContain("rgba(51, 65, 85, 0.86)");
  });

  it("switches message accents to turquoise", () => {
    const css = buildWallpaperCss({ ...GRAPHITE_DEFAULT, accent: "turquoise" });
    expect(css).toContain("rgba(8, 127, 121, 0.86)");
    expect(css).toContain("rgba(101, 222, 210, 0.94)");
    expect(css).toContain("rgba(13, 29, 28, 0.5)");
  });

  it("derives per-surface blur tiers from the single value", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain("blur(22px)");
    expect(css).toContain("blur(18px)");
    expect(css).toContain("blur(16px)");
    const medium = buildWallpaperCss({ ...GRAPHITE_DEFAULT, blur: 14 });
    expect(medium).toContain("blur(14px)");
    expect(medium).toContain("blur(10px)");
    expect(medium).toContain("blur(8px)");
    expect(medium).not.toContain("blur(22px)");
  });

  it("clamps out-of-range values defensively", () => {
    const clamped = buildWallpaperCss({
      ...GRAPHITE_DEFAULT,
      scrim: 999,
      blur: 999,
    });
    // Blur clamps to the 40 px ceiling; the sidebar tier takes it directly.
    expect(clamped).toContain("blur(40px)");
    expect(clamped).not.toContain("blur(41px)");
    // Scrim clamps to 150%; alphas then clamp at full opacity.
    expect(clamped).toContain("rgba(250, 250, 252, 1)");
    const floored = buildWallpaperCss({
      ...GRAPHITE_DEFAULT,
      scrim: 0,
      blur: -5,
    });
    expect(floored).not.toContain("backdrop-filter:");
  });

  it("omits every backdrop-filter layer at blur 0", () => {
    const css = buildWallpaperCss({ ...GRAPHITE_DEFAULT, blur: 0 });
    // Assert on the property, not the bare word: a code comment mentions
    // backdrop-filter by name.
    expect(css).not.toContain("backdrop-filter:");
    expect(css).not.toContain("-webkit-backdrop-filter:");
  });

  it("centers the image on every painted surface", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    // Arbitrary wallpapers must sit centered; no surface may opt back into
    // an edge-anchored image.
    for (const match of css.matchAll(/background-position: ([^;]+);/g)) {
      expect(match[1].replace(" !important", "").trim()).toBe("center");
    }
  });
});
