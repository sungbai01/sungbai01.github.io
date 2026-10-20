import type {CSSProperties} from 'react';
import type {Book} from '../lib/library';
import './book-ribbon.css';
type Mark={message:number;char:number;progress?:number;title:string;style?:'normal'|'character'|'image';icon?:string;image?:string};
export default function BookRibbon({book,mark,view}:{book:Book;mark:Mark;view:'covers'|'spines'}){
 const total=book.messages.reduce((sum,message)=>sum+message.content.length+1,0);
 const offset=book.messages.slice(0,mark.message).reduce((sum,message)=>sum+message.content.length+1,0)+mark.char;
 const progress=Math.max(0,Math.min(1,mark.progress??offset/Math.max(1,total)));
 return <span className={`shelf-ribbon shelf-ribbon-${view} shelf-ribbon-${mark.style??'normal'}`} role="img" aria-label={`${book.title} 책갈피`} style={{'--ribbon-color':book.color,'--ribbon-position':`${(1-progress)*100}%`} as CSSProperties}>{mark.style==='image'&&mark.image&&<img className="shelf-ribbon-image-fill" src={mark.image} alt="" draggable={false}/>}<span className="shelf-ribbon-hole"/><span className="shelf-ribbon-cord"/>{mark.style==='character'&&<>{mark.icon&&<img src={mark.icon} alt=""/>}<span className="shelf-ribbon-title">{mark.title}</span></>}</span>;
}
