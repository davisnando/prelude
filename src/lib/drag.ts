import { useStore } from "./store";
import type { Side } from "./types";

/** Gutter drag-to-select: mousedown starts, mouseenter extends, mouseup opens the composer. */
let drag: { file: string; side: Side; anchor: number } | null = null;

export function startDrag(file: string, side: Side, line: number, shift: boolean) {
  const { selection, setSelection, composer } = useStore.getState();
  if (composer?.editingId) return; // finish the edit in progress first
  let anchor = line;
  if (shift && selection && selection.file === file && selection.side === side) {
    anchor = line >= selection.start ? selection.start : selection.end;
  }
  drag = { file, side, anchor };
  setSelection({ file, side, start: Math.min(anchor, line), end: Math.max(anchor, line) });
}

export function extendDrag(file: string, side: Side, line: number) {
  if (!drag || drag.file !== file || drag.side !== side || !line) return;
  const { anchor } = drag;
  useStore.getState().setSelection({ file, side, start: Math.min(anchor, line), end: Math.max(anchor, line) });
}

export function endDrag() {
  if (!drag) return;
  drag = null;
  const { selection, openComposer } = useStore.getState();
  if (selection) openComposer({ file: selection.file, sel: selection, editingId: null });
}
