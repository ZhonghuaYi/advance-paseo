// Server-side path helpers shared by the feature modules.

import { homedir } from "node:os";
import path from "node:path";

/** The daemon's home directory (defaults to ~/.paseo). */
export function paseoHome(): string {
  return process.env.PASEO_HOME ?? path.join(homedir(), ".paseo");
}

/** Expand a leading `~` to the user's home directory; resolve to absolute. */
export function expandHomePath(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(homedir(), input.slice(2));
  }
  return input;
}
