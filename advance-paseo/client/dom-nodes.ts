/** DOM collections are iterable, but are not JavaScript arrays. */
export function isTextOnlyBatch(records: readonly MutationRecord[]): boolean {
  return records.length > 0 && records.every((record) =>
    record.type === "childList" &&
    containsNoElements(record.addedNodes) && containsNoElements(record.removedNodes),
  );
}

function containsNoElements(nodes: Iterable<unknown>): boolean {
  for (const node of nodes) {
    if (node instanceof HTMLElement) return false;
  }
  return true;
}
