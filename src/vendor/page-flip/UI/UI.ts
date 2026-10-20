import { PageFlip } from '../PageFlip';
import { Point } from '../BasicTypes';
import { FlipSetting, SizeType } from '../Settings';
import { Orientation } from '../Render/Render';

/**
 * UI Class, represents work with DOM
 */
export abstract class UI {
    protected readonly parentElement: HTMLElement;

    protected readonly app: PageFlip;
    protected readonly wrapper: HTMLElement;
    protected distElement: HTMLElement;

    private pointer: {id:number;start:Point;last:Point;startedAt:number;touch:boolean} | null = null;
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
        this.distElement.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerCancel);
        this.distElement.removeEventListener('lostpointercapture', this.onLostCapture);
        window.removeEventListener('blur', this.onBlur);
        this.clearUserTouch();
    }

    protected setHandlers(): void {
        window.addEventListener('resize', this.onResize);
        if (!this.app.getSettings().useMouseEvents) return;
        this.distElement.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointermove', this.onPointerMove, {passive:false});
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerCancel);
        this.distElement.addEventListener('lostpointercapture', this.onLostCapture);
        window.addEventListener('blur', this.onBlur);
    }

    private getMousePos(x:number,y:number):Point {
        const rect=this.distElement.getBoundingClientRect();
        return {x:x-rect.left,y:y-rect.top};
    }
    private checkTarget(target:EventTarget):boolean {
        if(!this.app.isInteractionEnabled())return false;
        const element=target instanceof Element?target:(target as Node)?.parentElement;
        return !!element&&!element.closest('a,button,input,textarea,select,label,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="textbox"],[data-no-flip]');
    }
    private onPointerDown=(event:PointerEvent):void=>{
        if(!event.isPrimary||event.button!==0||this.pointer||!this.checkTarget(event.target))return;
        const point=this.getMousePos(event.clientX,event.clientY);
        this.pointer={id:event.pointerId,start:point,last:point,startedAt:performance.now(),touch:event.pointerType!=='mouse'};
        this.app.startUserTouch(point);
        try{this.distElement.setPointerCapture(event.pointerId);}catch{}
        if(event.cancelable)event.preventDefault();
    };
    private onPointerMove=(event:PointerEvent):void=>{
        const pointer=this.pointer;if(!pointer||event.pointerId!==pointer.id)return;
        const point=this.getMousePos(event.clientX,event.clientY);pointer.last=point;
        if(!this.app.isInteractionEnabled()){this.clearUserTouch();return;}
        // A release outside the window may not deliver pointerup. Recover on reentry.
        if(event.pointerType==='mouse'&&event.buttons===0){this.completeGesture(point);return;}
        this.app.userMove(point,pointer.touch);
        if(event.cancelable)event.preventDefault();
    };
    private onPointerUp=(event:PointerEvent):void=>{
        if(this.pointer?.id!==event.pointerId)return;
        this.completeGesture(this.getMousePos(event.clientX,event.clientY));
        if(event.cancelable)event.preventDefault();
    };
    private completeGesture(point:Point):void {
        const pointer=this.pointer;if(!pointer)return;
        const dx=point.x-pointer.start.x,dy=point.y-pointer.start.y;
        const swipe=pointer.touch&&Math.abs(dx)>this.swipeDistance&&Math.abs(dx)>Math.abs(dy)&&performance.now()-pointer.startedAt<300;
        // Clear capture before settling so lostpointercapture cannot cancel it.
        this.clearUserTouch();
        if(pointer.touch&&this.app.getState()==='read'&&Math.abs(dy)>10&&Math.abs(dx)<10){this.app.cancelUserTouch();return;}
        this.app.userMove(point,pointer.touch);
        this.app.userStop(point,swipe);
    }
    private onPointerCancel=(event:PointerEvent):void=>{
        if(this.pointer?.id!==event.pointerId)return;
        this.completeGesture(this.pointer.last);
    };
    private onLostCapture=(event:PointerEvent):void=>{
        if(this.pointer?.id===event.pointerId)this.completeGesture(this.pointer.last);
    };
    private onBlur=():void=>{if(this.pointer)this.completeGesture(this.pointer.last);};

    public clearUserTouch():void {
        const pointer=this.pointer;this.pointer=null;
        if(pointer)try{if(this.distElement.hasPointerCapture(pointer.id))this.distElement.releasePointerCapture(pointer.id);}catch{}
    }
}
