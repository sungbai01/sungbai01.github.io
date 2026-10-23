import {bookAuthor} from '../lib/bookAuthor';
import type {Book} from '../lib/library';
import type {TicketTextLayout} from '../lib/shareTicket';
import ShareCardBackground from './ShareCardBackground';
import './share-dialog.css';
/** Shared presentation only: editing and drag handlers belong to the caller. */
export default function ShareTicketFace({book:cardBook,preview,layout,position}:{book:Book;preview:string;layout:TicketTextLayout;position:number}){
 const imagePosition=position;
 return <>    {preview&&<ShareCardBackground color={cardBook.color} artwork={layout.artwork} position={imagePosition}/>}
    <h3 className="sr-only">{cardBook.title}</h3>
    {preview?<img className="share-ticket-render" src={preview} alt={`${cardBook.title} 공유 카드 미리보기`}/>:<div className="share-ticket-placeholder" style={{backgroundColor:cardBook.color}} aria-busy="true"><div><small>GALPI / A STORY TO KEEP</small></div><aside><small>갈피 / 간직할 이야기</small><strong>{String(cardBook.volumeNumber??1).padStart(2,'0')}</strong><small style={{whiteSpace:'pre-line',textAlign:'center'}}>{bookAuthor(cardBook,'\n✦\n')}</small></aside></div>}
</>;
}
