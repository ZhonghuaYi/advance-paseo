import { describe, expect, it } from "vitest";
import { buildWallpaperCss } from "./wallpaper-css";

const GRAPHITE_DEFAULT = {
  scrim: 100,
  accent: "graphite",
  blur: 22,
} as const;

describe("buildWallpaperCss", () => {
  it("marks every runtime-decorated surface", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain('[data-paseo-advance-chat-surface]');
    expect(css).toContain('[data-paseo-advance-chat-clear]');
    expect(css).toContain('[data-paseo-advance-workspace-sidebar]');
    expect(css).toContain('[data-paseo-advance-right-sidebar]');
    expect(css).toContain('[data-paseo-advance-workspace-tabs]');
    expect(css).toContain('data-paseo-advance-wallpaper="light"');
    expect(css).toContain('data-paseo-advance-wallpaper="dark"');
  });

  it("keeps the compact-layout fallback and the desktop breakpoint", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain("@media (min-width: 721px)");
    expect(css).toContain("@media (max-width: 720px)");
  });

  it("styles the fixed test-id surfaces and modern selectors", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain('[data-testid="user-message"]');
    expect(css).toContain('[data-testid="terminal-surface"]::after');
    expect(css).toContain('[data-testid="git-diff-canvas-root"]::after');
    expect(css).toContain(":has(");
  });

  it("uses the authored base alphas at scrim 100", () => {
    const css = buildWallpaperCss(GRAPHITE_DEFAULT);
    expect(css).toContain("rgba(250, 250, 252, 0.72)");
    expect(css).toContain("rgba(16, 18, 24, 0.74)");
  });

  it("scales scrims with the percent value", () => {
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
});
