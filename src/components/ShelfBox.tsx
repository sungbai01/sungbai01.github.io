import type {CSSProperties,ReactNode} from 'react';

type ShelfBoxProps={
 view:'covers'|'spines';
 children:ReactNode;
 bookHeight?:number|string;
 detailsHeight?:number;
};

/** The same cabinet frame, sized by its books and each view's caption space. */
export default function ShelfBox({view,children,bookHeight,detailsHeight}:ShelfBoxProps){
 const style={
  '--shelf-book-height':typeof bookHeight==='number'?`${bookHeight}px`:bookHeight??(view==='covers'?'var(--cover-stage-height)':'225px'),
  '--shelf-details-height':`${detailsHeight??(view==='covers'?90:0)}px`,
 } as CSSProperties;
 return <div className={`shelf-box ${view==='covers'?'bookshelf-grid':'spines-shelf'}`} data-shelf-view={view} style={style}>{children}</div>;
}
