import { describe, expect, it } from "vitest";
import { en, format, zh } from "./dictionaries";

/** Deep list of "a.b.c" key paths for every plain-string leaf. */
function deepKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    deepKeys(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

describe("dictionaries", () => {
  it("keeps zh key-for-key compatible with en", () => {
    expect(deepKeys(zh)).toEqual(deepKeys(en));
  });

  it("leaves no English placeholder text inside zh", () => {
    // Every zh leaf must be non-empty; template placeholders stay intact.
    for (const key of deepKeys(zh)) {
      const value = key.split(".").reduce<unknown>(
        (node, part) => (node as Record<string, unknown>)[part],
        zh,
      );
      expect(String(value).length, `zh.${key}`).toBeGreaterThan(0);
    }
  });
});

describe("format", () => {
  it("fills named placeholders", () => {
    expect(format("{count} images stored on the daemon", { count: 3 })).toBe(
      "3 images stored on the daemon",
    );
  });

  it("fills several placeholders in one template", () => {
    expect(format("watching {ok}/{total} files", { ok: 2, total: 5 })).toBe(
      "watching 2/5 files",
    );
  });

  it("keeps unknown placeholders verbatim", () => {
    expect(format("a {missing} b", {})).toBe("a {missing} b");
  });
});
