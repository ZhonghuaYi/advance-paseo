// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { buildWallpaperCss, ROOT_ATTRIBUTE } from "./wallpaper-css";

afterEach(() => {
  document.head.textContent = "";
  document.body.textContent = "";
  document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
});

it("scopes every shell selector to an active wallpaper", () => {
  const style = document.createElement("style");
  style.textContent = ".shell-one,.shell-two { background-color: rgb(20, 30, 40); }\n" +
    buildWallpaperCss({ scrim: 100, blur: 22, accent: "graphite" }, ["shell-one", "shell-two"]);
  document.head.append(style);
  const shells = ["shell-one", "shell-two"].map(name => {
    const el = document.createElement("div");
    el.setAttribute("class", name);
    document.body.append(el);
    return el;
  });
  document.documentElement.setAttribute(ROOT_ATTRIBUTE, "light");
  for (const el of shells) expect(window.getComputedStyle(el).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
  for (const el of shells) expect(window.getComputedStyle(el).backgroundColor).toBe("rgb(20, 30, 40)");
});
