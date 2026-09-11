// Web-only helpers for the wallpaper settings UI: a hidden file input for
// picking an image and a canvas pipeline that downscales it before upload so
// RPC payloads stay around 1-2 MiB regardless of the source photo size.
//
// Per the plugin contract, DOM globals live only in this module and
// client/dom.d.ts; every export is gated so native hosts get a no-op. React
// components must call these instead of touching the DOM themselves.

import { Platform } from "react-native";

export interface PickedImage {
  readonly name: string;
  readonly dataUrl: string;
}

/** Longest image edge kept after re-encoding. */
const MAX_EDGE = 2560;
const WEBP_QUALITY = 0.85;
const JPEG_QUALITY = 0.9;

export function isWebPlatform(): boolean {
  return Platform.OS === "web";
}

/** Map the browser locale to a plugin language; null when unavailable. */
export function detectWebLanguage(): "zh" | "en" | null {
  if (typeof navigator === "undefined") return null;
  const language = navigator.language;
  if (typeof language !== "string" || language.length === 0) return null;
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/**
 * Open the host's file picker and return the chosen image, downscaled and
 * re-encoded as WebP (JPEG when WebP encoding is unavailable). Resolves null
 * when the dialog is cancelled, the host is not web, or decoding fails.
 * Animated GIFs flatten to their first frame.
 */
export function pickWallpaperImage(): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/webp,image/jpeg,image/png,image/gif";
    input.onchange = (event) => {
      const target = event.target;
      const files = target === null ? null : target.files;
      const file = files === null || files.length === 0 ? null : files[0];
      if (file === null) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
          resolve(null);
          return;
        }
        void downscaleDataUrl(dataUrl).then((optimized) => {
          const picked: PickedImage = {
            name: file.name,
            dataUrl: optimized ?? dataUrl,
          };
          resolve(picked);
        });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.click();
  });
}

function downscaleDataUrl(dataUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(
          1,
          MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
        );
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (context === null) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0, width, height);
        const webp = canvas.toDataURL("image/webp", WEBP_QUALITY);
        // Safari and older engines silently fall back to PNG for unsupported
        // types; detect the actual prefix and use JPEG there.
        resolve(
          webp.startsWith("data:image/webp")
            ? webp
            : canvas.toDataURL("image/jpeg", JPEG_QUALITY),
        );
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}
