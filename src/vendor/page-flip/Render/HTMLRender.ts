import { Orientation, Render } from './Render';
import { PageFlip } from '../PageFlip';
import { FlipDirection, FlippingState } from '../Flip/Flip';
import { PageDensity, PageOrientation } from '../Page/Page';
import type { Page } from '../Page/Page';
import { HTMLPage } from '../Page/HTMLPage';
import { Helper } from '../Helper';
import { FlipSetting } from '../Settings';

/**
 * Class responsible for rendering the HTML book
 */
export class HTMLRender extends Render {
    private visiblePages = new Set<Page>();
    /** Parent HTML Element */
    private readonly element: HTMLElement;

    /** Pages List as HTMLElements */
    private readonly items: NodeListOf<HTMLElement> | HTMLElement[];

    private outerShadow: HTMLElement = null;
    private innerShadow: HTMLElement = null;
    private hardShadow: HTMLElement = null;
    private hardInnerShadow: HTMLElement = null;
    private shadowLayers: HTMLElement[] = [];

    /**
     * @constructor
     *
     * @param {PageFlip} app - PageFlip object
     * @param {FlipSetting} setting - Configuration object
     * @param {HTMLElement} element - Parent HTML Element
     */
    constructor(app: PageFlip, setting: FlipSetting, element: HTMLElement) {
        super(app, setting);

        this.element = element;

        this.createShadows();
    }

    private createShadows(): void {
        this.element.insertAdjacentHTML(
            'beforeend',
            `<div class="stf__outerShadow"></div>
             <div class="stf__innerShadow"></div>
             <div class="stf__hardShadow"></div>
             <div class="stf__hardInnerShadow"></div>`
        );

        this.outerShadow = this.element.querySelector('.stf__outerShadow');
        this.innerShadow = this.element.querySelector('.stf__innerShadow');
        this.hardShadow = this.element.querySelector('.stf__hardShadow');
        this.hardInnerShadow = this.element.querySelector('.stf__hardInnerShadow');

        // Clip in stationary book coordinates, outside each shadow's rotating
        // coordinate system. Separate layers preserve the original stacking order.
        this.shadowLayers = [];
        for (const [shadow, level] of [
            [this.outerShadow, 10], [this.innerShadow, 10],
            [this.hardShadow, 4], [this.hardInnerShadow, 5],
        ] as [HTMLElement, number][]) {
            const layer = document.createElement('div');
            layer.style.cssText = `position: absolute; inset: 0; pointer-events: none;
                z-index: ${this.getSettings().startZIndex + level};`;
            shadow.parentElement.insertBefore(layer, shadow);
            layer.appendChild(shadow);
            this.shadowLayers.push(layer);
        }
        this.hideShadows();
    }

    public clearShadow(): void {
        super.clearShadow();

        this.hideShadows();
    }

    /** DOM-only reset: drawing a read frame must not schedule another frame. */
    private hideShadows(): void {
        for (const layer of this.shadowLayers) layer.style.display = 'none';
        this.outerShadow.style.cssText = 'display: none';
        this.innerShadow.style.cssText = 'display: none';
        this.hardShadow.style.cssText = 'display: none';
        this.hardInnerShadow.style.cssText = 'display: none';
    }

    private isEndPage(page: Page): boolean {
        return page !== null && (page as HTMLPage).getElement().dataset.pageKind === 'end';
    }

    private hasEndPage(): boolean {
        return [this.leftPage, this.rightPage, this.bottomPage, this.flippingPage]
            .some(page => this.isEndPage(page));
    }

    /** The end CTA belongs to the stationary right-hand blank area. */
    private drawEndPage(page: Page): void {
        page.setOrientation(PageOrientation.RIGHT);
        page.setDrawingDensity(PageDensity.SOFT);
        page.setAngle(0);
        page.setHardAngle(0);
        page.simpleDraw(PageOrientation.RIGHT);
        (page as HTMLPage).getElement().style.zIndex =
            (this.getSettings().startZIndex + 3).toString(10);
    }

    private clipShadowsToPhysicalPages(): boolean {
        const rect = this.getRect();
        const hasPage = (page: Page): boolean => page !== null && !this.isEndPage(page);
        const landscape = this.orientation === Orientation.LANDSCAPE;
        const flipping = hasPage(this.flippingPage);
        const left = landscape && (hasPage(this.leftPage) || flipping ||
            (this.direction === FlipDirection.BACK && hasPage(this.bottomPage)));
        // An incoming end page reserves the blank half throughout the cover
        // turn, even while the outgoing physical sheet still occupies that side.
        const endVisible = [this.leftPage, this.rightPage, this.bottomPage, this.flippingPage]
            .some(page => this.isEndPage(page));
        const right = !endVisible && (hasPage(this.rightPage) || flipping ||
            ((!landscape || this.direction === FlipDirection.FORWARD) && hasPage(this.bottomPage)));
        const x = rect.left + (left ? 0 : rect.pageWidth);
        const width = (Number(left) + Number(right)) * rect.pageWidth;
        const clip = `polygon(${x}px ${rect.top}px, ${x + width}px ${rect.top}px,
            ${x + width}px ${rect.top + rect.height}px, ${x}px ${rect.top + rect.height}px)`;
        for (const layer of this.shadowLayers) {
            layer.style.display = 'block';
            layer.style.clipPath = clip;
            layer.style.setProperty('-webkit-clip-path', clip);
        }
        return width > 0;
    }

    public reload(): void {
        for (const page of this.visiblePages) {
            (page as HTMLPage).clearBookmarkFoldLayer();
        }
        const testShadow = this.element.querySelector('.stf__outerShadow');

        if (!testShadow) {
            this.createShadows();
        }
    }

    /**
     * Draw inner shadow to the hard page
     */
    private drawHardInnerShadow(): void {
        const rect = this.getRect();

        const progress =
            this.shadow.progress > 100 ? 200 - this.shadow.progress : this.shadow.progress;

        let innerShadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (innerShadowSize > rect.pageWidth) innerShadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 5).toString(10)};
            width: ${innerShadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to right,
                rgba(0, 0, 0, ${(this.shadow.opacity * progress) / 100}) 5%,
                rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            top: ${rect.top}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && this.shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && this.shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0);`
                : `transform: translate3d(0, 0, 0) rotateY(180deg);`;

        this.hardInnerShadow.style.cssText = newStyle;
    }

    /**
     * Draw outer shadow to the hard page
     */
    private drawHardOuterShadow(): void {
        const rect = this.getRect();

        const progress =
            this.shadow.progress > 100 ? 200 - this.shadow.progress : this.shadow.progress;

        let shadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (shadowSize > rect.pageWidth) shadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 4).toString(10)};
            width: ${shadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to left, rgba(0, 0, 0, ${
                this.shadow.opacity
            }) 5%, rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            top: ${rect.top}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && this.shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && this.shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0) rotateY(180deg);`
                : `transform: translate3d(0, 0, 0);`;

        this.hardShadow.style.cssText = newStyle;
    }

    /**
     * Draw inner shadow to the soft page
     */
    private drawInnerShadow(): void {
        const rect = this.getRect();

        const innerShadowSize = (this.shadow.width * 3) / 4;
        const shadowTranslate = this.getDirection() === FlipDirection.FORWARD ? innerShadowSize : 0;

        const shadowDirection =
            this.getDirection() === FlipDirection.FORWARD ? 'to left' : 'to right';

        const shadowPos = this.convertToGlobal(this.shadow.pos);

        const angle = this.shadow.angle + (3 * Math.PI) / 2;

        const clip = [
            this.pageRect.topLeft,
            this.pageRect.topRight,
            this.pageRect.bottomRight,
            this.pageRect.bottomLeft,
        ];

        let polygon = 'polygon( ';
        for (const p of clip) {
            let g =
                this.getDirection() === FlipDirection.BACK
                    ? {
                          x: -p.x + this.shadow.pos.x,
                          y: p.y - this.shadow.pos.y,
                      }
                    : {
                          x: p.x - this.shadow.pos.x,
                          y: p.y - this.shadow.pos.y,
                      };

            g = Helper.GetRotatedPoint(g, { x: shadowTranslate, y: 100 }, angle);

            polygon += g.x + 'px ' + g.y + 'px, ';
        }
        polygon = polygon.slice(0, -2);
        polygon += ')';

        const newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 10).toString(10)};
            width: ${innerShadowSize}px;
            height: ${rect.height * 2}px;
            background: linear-gradient(${shadowDirection},
                rgba(0, 0, 0, ${this.shadow.opacity}) 5%,
                rgba(0, 0, 0, 0.05) 15%,
                rgba(0, 0, 0, ${this.shadow.opacity}) 35%,
                rgba(0, 0, 0, 0) 100%);
            transform-origin: ${shadowTranslate}px 100px;
            transform: translate3d(${shadowPos.x - shadowTranslate}px, ${
            shadowPos.y - 100
        }px, 0) rotate(${angle}rad);
            clip-path: ${polygon};
            -webkit-clip-path: ${polygon};
        `;

        this.innerShadow.style.cssText = newStyle;
    }

    /**
     * Draw outer shadow to the soft page
     */
    private drawOuterShadow(): void {
        const rect = this.getRect();

        const shadowPos = this.convertToGlobal({ x: this.shadow.pos.x, y: this.shadow.pos.y });

        const angle = this.shadow.angle + (3 * Math.PI) / 2;
        const shadowTranslate = this.getDirection() === FlipDirection.BACK ? this.shadow.width : 0;

        const shadowDirection =
            this.getDirection() === FlipDirection.FORWARD ? 'to right' : 'to left';

        const clip = [
            { x: 0, y: 0 },
            { x: rect.pageWidth, y: 0 },
            { x: rect.pageWidth, y: rect.height },
            { x: 0, y: rect.height },
        ];

        let polygon = 'polygon( ';
        for (const p of clip) {
            if (p !== null) {
                let g =
                    this.getDirection() === FlipDirection.BACK
                        ? {
                              x: -p.x + this.shadow.pos.x,
                              y: p.y - this.shadow.pos.y,
                          }
                        : {
                              x: p.x - this.shadow.pos.x,
                              y: p.y - this.shadow.pos.y,
                          };

                g = Helper.GetRotatedPoint(g, { x: shadowTranslate, y: 100 }, angle);

                polygon += g.x + 'px ' + g.y + 'px, ';
            }
        }

        polygon = polygon.slice(0, -2);
        polygon += ')';

        const newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 10).toString(10)};
            width: ${this.shadow.width}px;
            height: ${rect.height * 2}px;
            background: linear-gradient(${shadowDirection}, rgba(0, 0, 0, ${
            this.shadow.opacity
        }), rgba(0, 0, 0, 0));
            transform-origin: ${shadowTranslate}px 100px;
            transform: translate3d(${shadowPos.x - shadowTranslate}px, ${
            shadowPos.y - 100
        }px, 0) rotate(${angle}rad);
            clip-path: ${polygon};
            -webkit-clip-path: ${polygon};
        `;

        this.outerShadow.style.cssText = newStyle;
    }

    /**
     * Draw left static page
     */
    private drawLeftPage(): void {
        if (this.orientation === Orientation.PORTRAIT || this.leftPage === null) return;
        if (this.isEndPage(this.leftPage)) {
            this.drawEndPage(this.leftPage);
            return;
        }

        if (
            this.direction === FlipDirection.BACK &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.leftPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.leftPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.leftPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.leftPage.simpleDraw(PageOrientation.LEFT);
        }
    }

    /**
     * Draw right static page
     */
    private drawRightPage(): void {
        if (this.rightPage === null) return;
        if (this.isEndPage(this.rightPage)) {
            this.drawEndPage(this.rightPage);
            return;
        }

        if (
            this.direction === FlipDirection.FORWARD &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.rightPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.rightPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.rightPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.rightPage.simpleDraw(PageOrientation.RIGHT);
        }
    }

    /**
     * Draw the next page at the time of flipping
     */
    private drawBottomPage(): void {
        if (this.bottomPage === null) return;
        if (this.isEndPage(this.bottomPage)) {
            this.drawEndPage(this.bottomPage);
            return;
        }

        const tempDensity =
            this.flippingPage != null ? this.flippingPage.getDrawingDensity() : null;

        (this.bottomPage as HTMLPage).getElement().style.zIndex = (
            this.getSettings().startZIndex + 3
        ).toString(10);

        this.bottomPage.draw(tempDensity);
    }

    protected drawFrame(): void {
        // Clear both families on every frame, including read frames and density
        // transitions; only this frame's active family may become visible again.
        this.hideShadows();
        const reading = this.app.getState() === FlippingState.READ;
        const endVisible = this.hasEndPage();
        // The CTA is outside the physical book. Suppress both shadow families
        // for the whole turn, rather than relying on transformed clipping.
        if (reading || endVisible) this.shadow = null;
        this.updateBookmarkVisibility();
        this.clear();

        this.drawLeftPage();

        this.drawRightPage();

        this.drawBottomPage();

        if (this.flippingPage != null) {
            if (this.isEndPage(this.flippingPage)) {
                this.drawEndPage(this.flippingPage);
            } else {
                (this.flippingPage as HTMLPage).getElement().style.zIndex = (
                    this.getSettings().startZIndex + 5
                ).toString(10);

                this.flippingPage.draw();
            }
        }

        if (this.shadow != null && this.flippingPage !== null && !this.isEndPage(this.flippingPage) &&
            this.getSettings().drawShadow && !reading && !endVisible &&
            this.clipShadowsToPhysicalPages()) {
            if (this.flippingPage.getDrawingDensity() === PageDensity.SOFT) {
                this.drawOuterShadow();
                this.drawInnerShadow();
            } else {
                this.drawHardOuterShadow();
                this.drawHardInnerShadow();
            }
        }
    }

    /** Keep the ribbon on the moving clone, never on its stationary source.
     * Include the previous visible spread so a departing source is restored too.
     */
    private updateBookmarkVisibility(): void {
        const clone = this.flippingPage === null
            ? null : (this.flippingPage as HTMLPage).getElement();
        const cloneIndex = clone?.dataset.flipCopy === 'true' &&
            (this.flippingPage as HTMLPage).hasVisibleBookmarkFold()
            ? clone.dataset.readerPageIndex : undefined;
        const pages = new Set<Page>([
            ...this.visiblePages,
            this.leftPage, this.rightPage, this.bottomPage, this.flippingPage,
        ].filter(Boolean));
        for (const page of pages) {
            const element = (page as HTMLPage).getElement();
            if (this.flippingPage === null) (page as HTMLPage).clearBookmarkFoldLayer();
            const hide = cloneIndex !== undefined && element !== clone &&
                element.dataset.flipCopy !== 'true' &&
                (page === this.leftPage || page === this.rightPage) &&
                element.dataset.readerPageIndex === cloneIndex;
            if (hide) {
                if (element.dataset.bookmarkHidden !== 'true') element.dataset.bookmarkHidden = 'true';
            } else if (element.hasAttribute('data-bookmark-hidden')) {
                // Also clear flags inherited when a temporary copy was cloned.
                element.removeAttribute('data-bookmark-hidden');
            }
        }
    }

    private clear(): void {
        // Only the previous/current spread can need hiding or copy disposal.
        // Iterating the entire collection here made every animation frame O(book length).
        const current = new Set<Page>(
            [this.leftPage, this.rightPage, this.flippingPage, this.bottomPage].filter(Boolean)
        );
        for (const page of new Set([...this.visiblePages, ...current])) {
            if (!current.has(page)) {
                (page as HTMLPage).clearBookmarkFoldLayer();
                    (page as HTMLPage).getElement().style.cssText = 'display: none';
            }

            if (page.getTemporaryCopy() !== this.flippingPage) {
                page.hideTemporaryCopy();
            }
        }
        this.visiblePages = current;
    }

    public update(): void {
        super.update();

        if (this.rightPage !== null) {
            this.rightPage.setOrientation(PageOrientation.RIGHT);
        }

        if (this.leftPage !== null) {
            this.leftPage.setOrientation(PageOrientation.LEFT);
        }
    }
}
