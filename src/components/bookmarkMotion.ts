type MotionSample={x:number;y:number;t:number};
const throwSamples=new WeakMap<HTMLElement,MotionSample[]>();
export function sampleBookmarkThrow(node:HTMLElement,x:number,y:number,reset=false){
 const now=performance.now(),samples=reset?[]:(throwSamples.get(node)??[]).filter(point=>now-point.t<100);
 samples.push({x,y,t:now});throwSamples.set(node,samples);
}
function releaseVelocity(node:HTMLElement){
 const points=throwSamples.get(node)??[],last=points.at(-1),first=points[0];
 if(!last||!first||performance.now()-last.t>100||last.t-first.t<8)return {x:0,y:0};
 const dt=last.t-first.t;
 return {x:Math.max(-2.5,Math.min(2.5,(last.x-first.x)/dt)),y:Math.max(-2.5,Math.min(2.5,(last.y-first.y)/dt))};
}
/** A removed bookmark has a visual lifetime separate from its saved anchor. */
export class BookmarkMotion {
  private floating: HTMLElement | null = null;
  private plane: HTMLElement | null = null;
  private detached = false;
  private animation: Animation | null = null;
  private destroyed = false;
  private busy = false;
  private flight=0;
  private stopFlight(){cancelAnimationFrame(this.flight);this.flight=0;}
  private coast(velocity:{x:number;y:number}){
    this.stopFlight();
    if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    let last=performance.now(),vx=velocity.x,vy=velocity.y;
    const step=(now:number)=>{
      const node=this.floating;if(!node||this.destroyed||!this.detached)return;
      const dt=Math.min(32,now-last);last=now;
      const left=parseFloat(node.style.left),top=parseFloat(node.style.top);
      const x=Math.max(0,Math.min(Math.max(0,innerWidth-node.offsetWidth),left+vx*dt));
      const y=Math.max(0,Math.min(Math.max(0,innerHeight-node.offsetHeight),top+vy*dt));
      if(x!==left+vx*dt)vx=0;if(y!==top+vy*dt)vy=0;
      node.style.left=`${x}px`;node.style.top=`${y}px`;
      const friction=Math.exp(-dt/180);vx*=friction;vy*=friction;
      if(Math.hypot(vx,vy)>.015)this.flight=requestAnimationFrame(step);else this.flight=0;
    };
    this.flight=requestAnimationFrame(step);
  }

  constructor(private root: () => HTMLElement | null, private reinsert: () => void) {}

  private source(): HTMLElement | null {
    const root = this.root();
    if (!root) return null;
    const candidates = root.querySelectorAll<HTMLElement>(
      '.reader-phone-bookmark .reader-bookmark-slip, .reader-bookmark-peek .reader-bookmark-slip, .reader-page:not([data-flip-copy]) .reader-bookmark-slip',
    );
    for (const node of candidates) {
      if (!node.getClientRects().length || node.closest('[data-bookmark-hidden="true"]')) continue;
      return node;
    }
    return null;
  }

  private geometry(node: HTMLElement) {
    const rect = node.getBoundingClientRect();
    const page = node.closest<HTMLElement>('.reader-page');
    const scale = page ? page.getBoundingClientRect().width / Math.max(1, page.offsetWidth) : 1;
    const width = node.offsetWidth * scale, height = node.offsetHeight * scale;
    return {left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height};
  }

  private capture(source: HTMLElement | null) {
    if (this.floating || !source || !this.root()) return;
    const geometry = this.geometry(source);
    const wrapper = document.createElement('div');
    wrapper.className = 'reader-bookmark-loose';
    Object.assign(wrapper.style, {
      left: `${geometry.left}px`, top: `${geometry.top}px`, width: `${geometry.width}px`, height: `${geometry.height}px`,
      transform: `rotate(${getComputedStyle(source).rotate === 'none' ? '0deg' : getComputedStyle(source).rotate})`,
    });
    const copy = source.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    copy.removeAttribute('id');
    copy.classList.remove('reader-bookmark-dragging');
    copy.removeAttribute('aria-disabled');
    copy.style.cssText = '';
    copy.style.setProperty('--bookmark-color', getComputedStyle(source).getPropertyValue('--bookmark-color'));
    copy.tabIndex = 0;
    copy.setAttribute('aria-label', '책갈피 다시 꽂기');
    copy.title = '끌어서 다시 꽂기';
    wrapper.append(copy);
    const plane = document.createElement('div');
    plane.className = 'reader-bookmark-motion-plane';
    // A hidden bookmark must emerge from behind the paper as it is pulled up.
    // Keep this mask in viewport coordinates, separate from the moving ribbon.
    if (source.closest('.reader-bookmark-peek')) {
      const host = this.root()?.querySelector<HTMLElement>('.reader-flip-host');
      if (host) {
        const box = host.getBoundingClientRect();
        const flush=this.root()?.dataset.flushCovers==='true';
        const edge=flush?0:5, depth=flush?0:8;
        const left=box.left-edge, right=box.right+edge, top=box.top-edge, bottom=box.bottom+depth;
        plane.style.clipPath=`polygon(evenodd, -100vw -100vh, 200vw -100vh, 200vw 200vh, -100vw 200vh, -100vw -100vh, ${left}px ${top}px, ${right}px ${top}px, ${right}px ${bottom}px, ${left}px ${bottom}px, ${left}px ${top}px)`;
      }
    }
    plane.append(wrapper);
    this.root()!.append(plane);
    this.plane = plane;
    this.floating = wrapper;
    this.bindDrag(wrapper, copy);
  }

  private safe(x: number, y: number) {
    const host = this.root()?.querySelector<HTMLElement>('.reader-flip-host');
    if (!host) return false;
    const rect = host.getBoundingClientRect();
    if(this.root()?.dataset.device==='phone'){
      const width=rect.height*.08;
      return x>=rect.left-28&&x<=rect.left+12+width+40&&y>=rect.top-60&&y<=rect.top+rect.height*.24+40;
    }
    const width = rect.height * 2 / 15;
    const gutter = rect.left + rect.width / 2;
    return x >= gutter - width - 40 && x <= gutter + width + 40 &&
      y >= rect.top - 60 && y <= rect.top + rect.height * .4 + 40;
  }

  private bindDrag(wrapper: HTMLElement, copy: HTMLElement) {
    let drag: {id: number; x: number; y: number; left: number; top: number; angle: number; px: number; py: number; distance: number} | null = null;
    const finish = () => {
      if (drag && wrapper.hasPointerCapture(drag.id)) wrapper.releasePointerCapture(drag.id);
      drag = null;
    };
    wrapper.onpointerdown = event => {
      event.stopPropagation();
      if (this.busy || !this.detached || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      this.stopFlight();sampleBookmarkThrow(wrapper,event.clientX,event.clientY,true);
      const rect = wrapper.getBoundingClientRect();
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY,
        left: parseFloat(wrapper.style.left), top: parseFloat(wrapper.style.top),
        angle: parseFloat(wrapper.style.transform.replace('rotate(', '')) || 0,
        px: event.clientX < rect.left + rect.width / 2 ? .25 : .75,
        py: event.clientY < rect.top + rect.height / 2 ? .25 : .75, distance: 0};
      wrapper.setPointerCapture(event.pointerId);
    };
    wrapper.onpointermove = event => {
      if (!drag || event.pointerId !== drag.id) return;
      event.preventDefault();event.stopPropagation();
      sampleBookmarkThrow(wrapper,event.clientX,event.clientY);
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      drag.distance = Math.max(drag.distance, Math.hypot(dx, dy));
      const torque = (drag.px - .5) * dy - (drag.py - .5) * dx;
      const angle = Math.sign(torque) * Math.min(58, Math.hypot(dx, dy) * .2);
      wrapper.style.left = `${drag.left + dx}px`;
      wrapper.style.top = `${drag.top + dy}px`;
      wrapper.style.transform = `rotate(${drag.angle + angle}deg)`;
    };
    wrapper.onpointerup = event => {
      if (!drag || event.pointerId !== drag.id) return;
      event.stopPropagation();event.preventDefault();
      const insert = drag.distance <= 5 || this.safe(event.clientX, event.clientY);
      sampleBookmarkThrow(wrapper,event.clientX,event.clientY);
      const velocity=releaseVelocity(wrapper);
      finish();
      if (insert) this.reinsert();else this.coast(velocity);
    };
    wrapper.onpointercancel = finish;
    wrapper.onlostpointercapture = () => {drag = null;};
    wrapper.onclick = event => {event.stopPropagation();event.preventDefault();};
    copy.onkeydown = event => {
      if ((event.key === 'Enter' || event.key === ' ') && !this.busy && this.detached) {
        event.preventDefault();event.stopPropagation();this.reinsert();
      }
    };
  }

  private async animate(frames: Keyframe[]) {
    if (!this.floating || this.destroyed) return;
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 340;
    const animation = this.floating.animate(frames, {duration, easing: 'cubic-bezier(.22,.7,.25,1)', fill: 'forwards'});
    this.animation = animation;
    try {await animation.finished;} catch { /* Reader closed or movement replaced. */ }
  }

  async change(save: () => Promise<boolean>, inserting: boolean, dragged?: HTMLElement) {
    if (this.busy || this.destroyed) return;
    this.busy = true;this.stopFlight();
    const velocity=dragged?releaseVelocity(dragged):{x:0,y:0};
    const wasDetached = this.detached;
    this.capture(dragged ?? this.source());
    this.root()?.setAttribute('data-bookmark-motion', 'true');
    const removeOnPhone = !inserting && this.root()?.dataset.device === 'phone';
    const leaving = (removeOnPhone || (!dragged && !wasDetached)) && this.floating
      ? this.animate([{transform: this.floating.style.transform}, {transform: `translateY(-${parseFloat(this.floating.style.top) + this.floating.offsetHeight + 60}px) rotate(0deg)`}])
      : Promise.resolve();
    const [saved] = await Promise.all([save(), leaving]);
    if (this.destroyed) return;
    if (!saved) {
      this.animation?.cancel();
      if (!wasDetached) this.clear();
    } else if (removeOnPhone) {
      // Phones discard the visual copy too, including drag-to-remove.
      this.clear();
    } else if (dragged) {
      this.detached = true;
      if (this.plane) this.plane.style.clipPath = 'none';
      this.coast(velocity);
    } else if (inserting) {
      // Let the saved anchor reach the independently mounted page roots.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (this.destroyed) return;
      const target = this.source();
      if (target) {
        const destination = this.geometry(target);
        this.capture(target);
        if (this.floating) {
          // Adopt the destination face before descending, not when the moving
          // copy is replaced by the real bookmark at the end of the animation.
          const ribbon = this.floating.firstElementChild as HTMLElement | null;
          if (ribbon) ribbon.dataset.bookmarkSide = target.dataset.bookmarkSide ?? 'after';
          if (this.plane) this.plane.style.clipPath = 'none';
          const from = wasDetached ? {
            left: this.floating.style.left, top: this.floating.style.top,
            width: this.floating.style.width, height: this.floating.style.height, transform: this.floating.style.transform,
          } : {left: `${destination.left}px`, top: `${-destination.height - 60}px`, transform: 'rotate(0deg)'};
          this.animation?.cancel();
          await this.animate([from, {left: `${destination.left}px`, top: `${destination.top}px`,
            width: `${destination.width}px`, height: `${destination.height}px`, transform: 'rotate(0deg)'}]);
        }
      }
      this.clear();
    } else {
      this.clear();
    }
    this.root()?.removeAttribute('data-bookmark-motion');
    this.busy = false;
  }

  private clear() {
    this.stopFlight();
    this.animation?.cancel();this.animation = null;
    this.plane?.remove();this.plane = null;this.floating = null;this.detached = false;
  }
  dispose() {this.destroyed = true;this.clear();this.root()?.removeAttribute('data-bookmark-motion');}
}
