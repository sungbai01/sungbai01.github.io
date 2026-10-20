export type ReaderViewport = {
  width: number;
  height: number;
  touch: boolean;
  horizontalSegments: boolean;
};

// Classify the available reading surface, not a manufacturer/model string.
// A normal phone stays single-page in landscape; an unfolded touch surface
// needs both a tablet-sized short edge and enough width for readable leaves.
export function readerPageCount(availableWidth: number, viewport: ReaderViewport): 1 | 2 {
  const minimumSpread = 260 * 2 + 16;
  if (availableWidth < minimumSpread) return 1;
  if (viewport.horizontalSegments) return 2;
  if (viewport.touch) return Math.min(viewport.width, viewport.height) >= 560 ? 2 : 1;
  return availableWidth >= 760 ? 2 : 1;
}

export function readReaderViewport(): ReaderViewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    touch: navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches,
    horizontalSegments: window.matchMedia('(horizontal-viewport-segments: 2)').matches,
  };
}
