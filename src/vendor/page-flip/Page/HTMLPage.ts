import { Page, PageDensity, PageOrientation } from './Page';
import { Render } from '../Render/Render';
import { Helper } from '../Helper';
import { FlipDirection } from '../Flip/Flip';
import { Point } from '../BasicTypes';

/**
 * Class representing a book page as a HTML Element
 */
export class HTMLPage extends Page {
    private readonly element: HTMLElement;
    private copiedElement: HTMLElement = null;

    private temporaryCopy: Page = null;
    private bookmarkFoldLayer: HTMLElement = null;
    private bookmarkFoldSource: HTMLElement = null;

    private isLoad = false;

    constructor(render: Render, element: HTMLElement, density: PageDensity) {
        super(render, density);

        this.element = element;
        this.element.classList.add('stf__item');
        this.element.classList.add('--' + density);
        this.element.style.display = 'none';
    }

    public newTemporaryCopy(): Page {
        if (this.nowDrawingDensity === PageDensity.HARD) {
            return this;
        }

        if (this.temporaryCopy === null) {
            this.copiedElement = this.element.cloneNode(true) as HTMLElement;
            this.copiedElement.dataset.flipCopy = 'true';
            this.copiedElement.removeAttribute('data-bookmark-folding');
            this.copiedElement.setAttribute('aria-hidden', 'true');
            this.element.parentElement.appendChild(this.copiedElement);

            this.temporaryCopy = new HTMLPage(
                this.render,
                this.copiedElement,
                this.nowDrawingDensity
            );
        }

        return this.getTemporaryCopy();
    }

    public getTemporaryCopy(): Page {
        return this.temporaryCopy;
    }

    public hideTemporaryCopy(): void {
        if (this.temporaryCopy !== null) {
            (this.temporaryCopy as HTMLPage).clearBookmarkFoldLayer();
            this.copiedElement.remove();
            this.copiedElement = null;
            this.temporaryCopy = null;
        }
    }

    public draw(tempDensity?: PageDensity): void {
        // The end CTA is not a sheet: never inherit a neighbouring cover's
        // hard density, transform or fold clip, regardless of the calling path.
        if (this.element.dataset.pageKind === 'end') {
            this.simpleDraw(PageOrientation.RIGHT);
            return;
        }
        const density = tempDensity ? tempDensity : this.nowDrawingDensity;

        const pagePos = this.render.convertToGlobal(this.state.position);
        const pageWidth = this.render.getRect().pageWidth;
        const pageHeight = this.render.getRect().height;

        this.element.classList.remove('--simple');

        const commonStyle = `
            display: block;
            z-index: ${this.element.style.zIndex};
            left: 0;
            top: 0;
            width: ${pageWidth}px;
            height: ${pageHeight}px;
        `;

        density === PageDensity.HARD
            ? this.drawHard(commonStyle)
            : this.drawSoft(pagePos, commonStyle);
        this.drawBookmarkFoldLayer();
    }

    /** A sibling follows the exact rendered sheet transform without its clip.
     * Only the ribbon is cloned; page contents and event handlers stay in place.
     */
    private drawBookmarkFoldLayer(): void {
        const slip = this.element.querySelector<HTMLElement>('.reader-bookmark-slip');
        if (!slip || this.element.dataset.bookmarkHidden === 'true' ||
            !this.element.parentElement) {
            this.clearBookmarkFoldLayer();
            return;
        }
        if (this.bookmarkFoldSource !== slip || !this.bookmarkFoldLayer?.isConnected) {
            this.clearBookmarkFoldLayer();
            const layer = document.createElement('div');
            layer.setAttribute('aria-hidden', 'true');
            layer.setAttribute('inert', '');
            const ribbon = slip.cloneNode(true) as HTMLElement;
            for (const node of [ribbon, ...Array.from(ribbon.querySelectorAll('[id]'))]) {
                node.removeAttribute('id');
            }
            ribbon.style.pointerEvents = 'none';
            layer.appendChild(ribbon);
            this.element.parentElement.appendChild(layer);
            this.bookmarkFoldLayer = layer;
            this.bookmarkFoldSource = slip;
        }
        const layer = this.bookmarkFoldLayer;
        layer.className = 'reader-bookmark-fold-layer';
        for (const side of ['reader-page-left', 'reader-page-right']) {
            if (this.element.classList.contains(side)) layer.classList.add(side);
        }
        // Copy the inline result of drawSoft/drawHard, not computed layout or a
        // second animation. Keep only this sibling's ribbon outside the fold clip.
        layer.style.cssText = this.element.style.cssText;
        layer.style.position = 'absolute';
        layer.style.clipPath = 'none';
        layer.style.setProperty('-webkit-clip-path', 'none');
        layer.style.overflow = 'visible';
        layer.style.contain = 'none';
        layer.style.pointerEvents = 'none';
        layer.style.transition = 'none';
        layer.style.animation = 'none';
        layer.style.transformStyle = 'preserve-3d';
        layer.style.zIndex = String((Number(this.element.style.zIndex) || 0) + 1);
        this.element.dataset.bookmarkFolding = 'true';
    }

    public clearBookmarkFoldLayer(): void {
        this.bookmarkFoldLayer?.remove();
        this.bookmarkFoldLayer = null;
        this.bookmarkFoldSource = null;
        this.element.removeAttribute('data-bookmark-folding');
    }

    private drawHard(commonStyle = ''): void {
        const pos = this.render.getRect().left + this.render.getRect().width / 2;

        const angle = this.state.hardDrawingAngle;

        const newStyle =
            commonStyle +
            `
                backface-visibility: hidden;
                -webkit-backface-visibility: hidden;
                clip-path: none;
                -webkit-clip-path: none;
            ` +
            (this.orientation === PageOrientation.LEFT
                ? `transform-origin: ${this.render.getRect().pageWidth}px 0; 
                   transform: translate3d(0, 0, 0) rotateY(${angle}deg);`
                : `transform-origin: 0 0; 
                   transform: translate3d(${pos}px, 0, 0) rotateY(${angle}deg);`);

        this.element.style.cssText = newStyle;
    }

    private drawSoft(position: Point, commonStyle = ''): void {
        let polygon = 'polygon( ';
        for (const p of this.state.area) {
            if (p !== null) {
                let g =
                    this.render.getDirection() === FlipDirection.BACK
                        ? {
                              x: -p.x + this.state.position.x,
                              y: p.y - this.state.position.y,
                          }
                        : {
                              x: p.x - this.state.position.x,
                              y: p.y - this.state.position.y,
                          };

                g = Helper.GetRotatedPoint(g, { x: 0, y: 0 }, this.state.angle);
                polygon += g.x + 'px ' + g.y + 'px, ';
            }
        }
        polygon = polygon.slice(0, -2);
        polygon += ')';

        const newStyle =
            commonStyle +
            `transform-origin: 0 0; clip-path: ${polygon}; -webkit-clip-path: ${polygon};` +
            (this.render.isSafari() && this.state.angle === 0
                ? `transform: translate(${position.x}px, ${position.y}px);`
                : `transform: translate3d(${position.x}px, ${position.y}px, 0) rotate(${this.state.angle}rad);`);

        this.element.style.cssText = newStyle;
    }

    public simpleDraw(orient: PageOrientation): void {
        this.clearBookmarkFoldLayer();
        if (this.element.dataset.pageKind === 'end') {
            orient = PageOrientation.RIGHT;
            this.setOrientation(orient);
            this.setDrawingDensity(PageDensity.SOFT);
            this.setAngle(0);
            this.setHardAngle(0);
            this.setArea([]);
        }
        const rect = this.render.getRect();

        const pageWidth = rect.pageWidth;
        const pageHeight = rect.height;

        const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;

        const y = rect.top;

        this.element.classList.add('--simple');
        this.element.style.cssText = `
            position: absolute; 
            display: block; 
            height: ${pageHeight}px; 
            left: ${x}px; 
            top: ${y}px; 
            width: ${pageWidth}px; 
            z-index: ${this.render.getSettings().startZIndex + 1};`;
    }

    public getElement(): HTMLElement {
        return this.element;
    }

    public load(): void {
        this.isLoad = true;
    }

    public setOrientation(orientation: PageOrientation): void {
        super.setOrientation(orientation);
        this.element.classList.remove('--left', '--right');

        this.element.classList.add(orientation === PageOrientation.RIGHT ? '--right' : '--left');
    }

    public setDrawingDensity(density: PageDensity): void {
        this.element.classList.remove('--soft', '--hard');
        this.element.classList.add('--' + density);

        super.setDrawingDensity(density);
    }
}
