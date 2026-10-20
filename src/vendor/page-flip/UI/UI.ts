import { PageFlip } from '../PageFlip';
import { Point } from '../BasicTypes';
import { FlipSetting, SizeType } from '../Settings';
import { FlippingState } from '../Flip/Flip';
import { Orientation } from '../Render/Render';

type SwipeData = {
    point: Point;
    time: number;
    identifier: number;
};

/**
 * UI Class, represents work with DOM
 */
export abstract class UI {
    protected readonly parentElement: HTMLElement;

    protected readonly app: PageFlip;
    protected readonly wrapper: HTMLElement;
    protected distElement: HTMLElement;

    private touchPoint: SwipeData = null;
    private mouseActive = false;
    private readonly swipeTimeout = 250;
    private readonly swipeDistance: number;

    private onResize = (): void => {
        this.update();
    };

    /**
     * @constructor
     *
     * @param {HTMLElement} inBlock - Root HTML Element
     * @param {PageFlip} app - PageFlip instanse
     * @param {FlipSetting} setting - Configuration object
     */
    protected constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
        this.parentElement = inBlock;

        inBlock.classList.add('stf__parent');
        // Add first wrapper
        inBlock.insertAdjacentHTML('afterbegin', '<div class="stf__wrapper"></div>');

        this.wrapper = inBlock.querySelector('.stf__wrapper');

        this.app = app;

        const k = this.app.getSettings().usePortrait ? 1 : 2;

        // Setting block sizes based on configuration
        inBlock.style.minWidth = setting.minWidth * k + 'px';
        inBlock.style.minHeight = setting.minHeight + 'px';

        if (setting.size === SizeType.FIXED) {
            inBlock.style.minWidth = setting.width * k + 'px';
            inBlock.style.minHeight = setting.height + 'px';
        }

        if (setting.autoSize) {
            inBlock.style.width = '100%';
            inBlock.style.maxWidth = setting.maxWidth * 2 + 'px';
        }

        inBlock.style.display = 'block';

        window.addEventListener('resize', this.onResize, false);
        this.swipeDistance = setting.swipeDistance;
    }

    /**
     * Destructor. Remove all HTML elements and all event handlers
     */
    public destroy(): void {
        this.removeHandlers();

        this.distElement.remove();
        this.wrapper.remove();
    }

    /**
     * Updating child components when resizing
     */
    public abstract update(): void;

    /**
     * Get parent element for book
     *
     * @returns {HTMLElement}
     */
    public getDistElement(): HTMLElement {
        return this.distElement;
    }

    /**
     * Get wrapper element
     *
     * @returns {HTMLElement}
     */
    public getWrapper(): HTMLElement {
        return this.wrapper;
    }

    /**
     * Updates styles and sizes based on book orientation
     *
     * @param {Orientation} orientation - New book orientation
     */
    public setOrientationStyle(orientation: Orientation): void {
        this.wrapper.classList.remove('--portrait', '--landscape');

        if (orientation === Orientation.PORTRAIT) {
            if (this.app.getSettings().autoSize)
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / this.app.getSettings().width) * 100 + '%';

            this.wrapper.classList.add('--portrait');
        } else {
            if (this.app.getSettings().autoSize)
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / (this.app.getSettings().width * 2)) * 100 +
                    '%';

            this.wrapper.classList.add('--landscape');
        }

        this.update();
    }

    protected removeHandlers(): void {
        window.removeEventListener('resize', this.onResize);

        this.distElement.removeEventListener('mousedown', this.onMouseDown);
        this.distElement.removeEventListener('touchstart', this.onTouchStart);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('touchmove', this.onTouchMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('touchend', this.onTouchEnd);
        window.removeEventListener('touchcancel', this.onTouchCancel);
        window.removeEventListener('blur', this.onTouchCancel);
    }

    protected setHandlers(): void {
        window.addEventListener('resize', this.onResize, false);
        if (!this.app.getSettings().useMouseEvents) return;

        this.distElement.addEventListener('mousedown', this.onMouseDown);
        this.distElement.addEventListener('touchstart', this.onTouchStart, { passive: false });
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('touchmove', this.onTouchMove, {
            passive: !this.app.getSettings().mobileScrollSupport,
        });
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('touchend', this.onTouchEnd);
        window.addEventListener('touchcancel', this.onTouchCancel);
        window.addEventListener('blur', this.onTouchCancel);
    }

    /**
     * Convert global coordinates to relative book coordinates
     *
     * @param x
     * @param y
     */
    private getMousePos(x: number, y: number): Point {
        const rect = this.distElement.getBoundingClientRect();

        return {
            x: x - rect.left,
            y: y - rect.top,
        };
    }

    private checkTarget(target: EventTarget): boolean {
        if (!this.app.isInteractionEnabled()) return false;
        const element = target instanceof Element ? target : (target as Node)?.parentElement;
        if (!element) return false;
        // Controls and editors must retain native focus, selection and gestures,
        // regardless of the legacy clickEventForward setting.
        return !element.closest('a,button,input,textarea,select,label,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[data-no-flip]');
    }

    private onMouseDown = (e: MouseEvent): void => {
        if (e.button === 0 && this.touchPoint === null && this.checkTarget(e.target)) {
            this.mouseActive = true;
            const pos = this.getMousePos(e.clientX, e.clientY);

            this.app.startUserTouch(pos);

            e.preventDefault();
        }
    };

    private onTouchStart = (e: TouchEvent): void => {
        if (e.touches.length > 1) {
            this.onTouchCancel();
            return;
        }
        if (this.touchPoint === null && this.checkTarget(e.target)) {
            if (e.touches.length === 1 && e.changedTouches.length > 0) {
                const t = e.changedTouches[0];
                const pos = this.getMousePos(t.clientX, t.clientY);

                this.touchPoint = {
                    point: pos,
                    time: Date.now(),
                    identifier: t.identifier,
                };

                // The reader is a fixed book surface. Register a tap immediately;
                // delaying it by 250ms discarded short taps and let native scroll
                // and compatibility mouse events compete with the page curl.
                this.app.startUserTouch(pos);
                if (e.cancelable) e.preventDefault();
            }
        }
    };

    private onMouseUp = (e: MouseEvent): void => {
        if (!this.mouseActive || e.button !== 0) return;
        this.mouseActive = false;
        const pos = this.getMousePos(e.clientX, e.clientY);

        this.app.userMove(pos, false);
        this.app.userStop(pos);
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (!this.mouseActive) return; // No hover work, including layout reads.
        const pos = this.getMousePos(e.clientX, e.clientY);

        this.app.userMove(pos, false);
    };

    private onTouchMove = (e: TouchEvent): void => {
        if (this.touchPoint === null || !this.app.isInteractionEnabled()) return;
        const t = Array.from(e.changedTouches).find(t => t.identifier === this.touchPoint.identifier);
        if (t) {
            const pos = this.getMousePos(t.clientX, t.clientY);

            if (this.app.getSettings().mobileScrollSupport) {
                if (this.touchPoint !== null) {
                    if (
                        Math.abs(this.touchPoint.point.x - pos.x) > 10 ||
                        this.app.getState() !== FlippingState.READ
                    ) {
                        this.app.userMove(pos, true);
                    }
                }

                if (this.app.getState() !== FlippingState.READ) {
                    if (e.cancelable) e.preventDefault();
                }
            } else {
                this.app.userMove(pos, true);
            }
        }
    };

    private onTouchEnd = (e: TouchEvent): void => {
        if (this.touchPoint === null) return;
        const t = Array.from(e.changedTouches).find(t => t.identifier === this.touchPoint.identifier);
        if (t) {
            const pos = this.getMousePos(t.clientX, t.clientY);
            let isSwipe = false;

            if (this.app.getState() === FlippingState.READ &&
                Math.abs(pos.x - this.touchPoint.point.x) < 10 &&
                Math.abs(pos.y - this.touchPoint.point.y) > 10) {
                this.onTouchCancel();
                return;
            }

            // swipe detection
            if (this.touchPoint !== null) {
                const dx = pos.x - this.touchPoint.point.x;
                const distY = Math.abs(pos.y - this.touchPoint.point.y);

                if (
                    Math.abs(dx) > this.swipeDistance &&
                    distY < this.swipeDistance * 2 &&
                    Date.now() - this.touchPoint.time < this.swipeTimeout
                ) {
                    isSwipe = true;
                }

                this.touchPoint = null;
            }

            // Account for a final move delivered only with touchend. Settle the
            // existing fold instead of replacing it with a corner animation.
            this.app.userMove(pos, true);
            this.app.userStop(pos, isSwipe);
        }
    };

    public clearUserTouch(): void {
        this.touchPoint = null;
        this.mouseActive = false;
    }

    private onTouchCancel = (): void => {
        if (this.touchPoint === null && !this.mouseActive) return;
        this.clearUserTouch();
        this.app.cancelUserTouch();
    };
}
