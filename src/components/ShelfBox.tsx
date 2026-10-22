import {useLayoutEffect,useRef,type CSSProperties,type ReactNode} from 'react';

type ShelfBoxProps={
 view:'covers'|'spines';
 children:ReactNode;
 bookHeight?:number|string;
 detailsHeight?:number;
};

/** The same cabinet frame, sized by its books and each view's caption space. */
export default function ShelfBox({view,children,bookHeight,detailsHeight}:ShelfBoxProps){
 const ref=useRef<HTMLDivElement>(null);
 const previous=useRef<{view:string;rects:Map<string,DOMRect>;height:number;signature:string}|null>(null);
 useLayoutEffect(()=>{
  const box=ref.current;if(!box)return;
  const items=Array.from(box.querySelectorAll<HTMLElement>('[data-drag-book]'));
  const signature=`${view}:${box.clientWidth}:${items.map(item=>item.dataset.dragBook).join(',')}`;
  if(previous.current?.signature===signature)return;
  const offsets=new Map(items.map(item=>{const transform=getComputedStyle(item).transform;const matrix=transform==='none'?null:new DOMMatrixReadOnly(transform);item.getAnimations().forEach(animation=>animation.cancel());return [item.dataset.dragBook!,{x:matrix?.m41??0,y:matrix?.m42??0}];}));
  const bounds=box.getBoundingClientRect();
  const rects=new Map(items.map(item=>{const r=item.getBoundingClientRect();return [item.dataset.dragBook!,new DOMRect(r.x-bounds.x+box.scrollLeft,r.y-bounds.y+box.scrollTop,r.width,r.height)];}));
  const before=previous.current,height=box.getBoundingClientRect().height;
  if(before&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
   for(const item of items){const from=before.rects.get(item.dataset.dragBook!),to=rects.get(item.dataset.dragBook!)!;if(!from)continue;
    const offset=offsets.get(item.dataset.dragBook!)!;
    if(from.x!==to.x||from.y!==to.y||offset.x!==0||offset.y!==0||before.view!==view){
     item.animate([{transform:`translate(${from.x+offset.x-to.x}px,${from.y+offset.y-to.y}px)`,opacity:before.view===view?1:.35},{transform:'translate(0,0)',opacity:1}],{duration:280,easing:'cubic-bezier(.2,.7,.2,1)'});
    }
   }
   if(before.view!==view&&before.height!==height)box.animate([{height:`${before.height}px`},{height:`${height}px`}],{duration:280,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  previous.current={view,rects,height,signature};
 });
 const style={
  '--shelf-book-height':typeof bookHeight==='number'?`${bookHeight}px`:bookHeight??(view==='covers'?'var(--cover-stage-height)':'225px'),
  '--shelf-details-height':`${detailsHeight??(view==='covers'?90:0)}px`,
 } as CSSProperties;
 return <div ref={ref} className={`shelf-box ${view==='covers'?'bookshelf-grid':'spines-shelf'}`} data-shelf-view={view} style={style}>{children}</div>;
}
