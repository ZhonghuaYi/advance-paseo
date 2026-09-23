// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isTextOnlyBatch } from "./dom-nodes";

describe("DOM mutation collections", () => {
  it("handles real NodeLists for added and removed elements and text", async () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    const batch = (mutate: () => void) => new Promise<MutationRecord[]>(resolve => {
      const observer = new MutationObserver(records => { observer.disconnect(); resolve(records); });
      observer.observe(parent, { childList: true });
      mutate();
    });
    const added = await batch(() => parent.append(child));
    expect(Array.isArray(added[0].addedNodes)).toBe(false);
    expect(isTextOnlyBatch(added)).toBe(false);
    expect(isTextOnlyBatch(await batch(() => child.remove()))).toBe(false);
    expect(isTextOnlyBatch(await batch(() => { parent.textContent = "streamed text"; }))).toBe(true);
  });
});
