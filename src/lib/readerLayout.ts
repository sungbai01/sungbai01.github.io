export type ReaderViewport = {
  width: number;
  height: number;
  touch: boolean;
  horizontalSegments: boolean;
  screenWidth?: number;
  screenHeight?: number;
};

// Samsung Fold8: portrait cover 1248 x 1972, landscape main 2448 x 1848.
// https://www.samsung.com/sg/business/smartphones/galaxy-z/galaxy-z-fold8-pistachio-256gb-sm-f971bzgdxsp/
// Use the device screen rather
// than browser content bounds so toolbars and narrow desktop windows do not
// change device classification. The ratio follows the current orientation.
const FOLD_MIN_WIDTH_HEIGHT_RATIO = 1248 / 1972;
const FOLD_MAX_WIDTH_HEIGHT_RATIO = 2448 / 1848;

function readerScreenSize(viewport: ReaderViewport): { width: number; height: number } {
  const valid = (value: number | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;
  return valid(viewport.screenWidth) && valid(viewport.screenHeight)
    ? { width: viewport.screenWidth, height: viewport.screenHeight }
    : { width: viewport.width, height: viewport.height };
}

export function classifyReaderViewport(viewport: ReaderViewport): 'phone' | 'fold' | 'desktop' {
  const screen = readerScreenSize(viewport);
  if (!Number.isFinite(screen.width) || !Number.isFinite(screen.height) ||
    screen.width <= 0 || screen.height <= 0) return 'desktop';
  // Deliberately use width / height as oriented, without touch or segment
  // overrides. Both exact boundary ratios belong to the fold category.
  const ratio = screen.width / screen.height;
  if (ratio < FOLD_MIN_WIDTH_HEIGHT_RATIO) return 'phone';
  if (ratio <= FOLD_MAX_WIDTH_HEIGHT_RATIO) return 'fold';
  return 'desktop';
}

export function isMobileReaderViewport(viewport: ReaderViewport): boolean {
  return classifyReaderViewport(viewport) !== 'desktop';
}

export function readerPageCount(availableWidth: number, viewport: ReaderViewport): 1 | 2 {
  const category = classifyReaderViewport(viewport);
  if (category === 'phone') return 1;
  if (category === 'fold') return 2;
  return availableWidth >= 760 ? 2 : 1;
}

export function readReaderViewport(): ReaderViewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    touch: navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches,
    horizontalSegments: window.matchMedia('(horizontal-viewport-segments: 2)').matches,
    screenWidth: window.screen?.width,
    screenHeight: window.screen?.height,
  };
}
