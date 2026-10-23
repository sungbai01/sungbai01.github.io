import {bookAuthor} from './bookAuthor';
import type {Book} from './library';

export const SHARE_QUOTE_LIMIT=240;
export type QuotePageRange={start:number;end:number};
export const TICKET_QUOTE_MARK={x:60,y:278,size:70};
export type TicketArtwork={src:string;x:number;width:number;height:number;overflow:number};
export type TicketTextLayout={titleSize:number;quoteSize:number;artwork?:TicketArtwork};
export type TicketOptions={imagePosition?:number};

// References: Behance /242278809 (perforation and separate stub),
// Dribbble /26570471 (typographic hierarchy and whitespace).
// Book details replace travel/cinema fields; the user's artwork remains the backdrop.
export async function makeTicketCard(book:Book,quote='',quotePages?:QuotePageRange,onEditorPreview?:(blob:Blob,layout:TicketTextLayout)=>void,options:TicketOptions={}):Promise<Blob>{
 const source=book.assets?.find(asset=>asset.id===book.shareCardAssetId)?.src
   ??book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;
 // Card text and artwork prepare concurrently. Unrelated UI fonts must not
 // block this canvas indefinitely on a cold or unreliable connection.
 const fonts=new Promise<void>(resolve=>{
  const timer=setTimeout(resolve,700);
  void document.fonts.load('400 48px "Gowun Batang"',(book.title+bookAuthor(book,'\n')+quote).slice(0,512)).then(()=>{clearTimeout(timer);resolve();},()=>{clearTimeout(timer);resolve();});
 });
 const artworkReady=source?new Promise<HTMLImageElement>((resolve,reject)=>{
  const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
  const timer=setTimeout(()=>{image.src='';reject(new Error('공유 카드 이미지를 불러오지 못했어요.'));},10000);
  image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);reject(new Error('공유 카드 이미지를 불러오지 못했어요.'));};image.src=source;
 }):Promise.resolve(null);
 const [,image]=await Promise.all([fonts,artworkReady]);
 const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=720;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('카드를 만들지 못했어요.');
 ctx.save();ctx.beginPath();ctx.roundRect(0,0,1440,720,24);ctx.clip();
 ctx.fillStyle=book.color;ctx.fillRect(0,0,1440,720);
 const position=Math.max(0,Math.min(1,Number.isFinite(options.imagePosition)?options.imagePosition!:0));
 const scale=image?Math.max(1440/image.naturalWidth,720/image.naturalHeight):1;
 const artwork=image?{src:source!,x:(1440-image.naturalWidth*scale)/2,width:image.naturalWidth*scale,height:image.naturalHeight*scale,overflow:Math.max(0,image.naturalHeight*scale-720)}:undefined;
 if(image&&artwork)ctx.drawImage(image,artwork.x,-artwork.overflow*position,artwork.width,artwork.height);
 const shade=ctx.createLinearGradient(0,720,1050,0);
 shade.addColorStop(0,'#101813ed');shade.addColorStop(.6,'#101813b8');shade.addColorStop(1,'#10181344');
 ctx.fillStyle=shade;ctx.fillRect(0,0,1440,720);
 let quoteSize=32,pageLabel='',pageLabelY=0;
 const lines=(text:string,width:number)=>{
  const result:string[]=[];
  for(const paragraph of text.split('\n')){let line='';for(const char of paragraph){if(line&&ctx.measureText(line+char).width>width){result.push(line);line='';}line+=char;}result.push(line);}
  return result;
 };
 const fit=(text:string,width:number,max:number,start:number,min:number)=>{
  let size=start,rows:string[]=[];
  do{ctx.font=`${size}px "Gowun Batang",serif`;rows=lines(text,width);if(rows.length<=max||size<=min)break;size-=2;}while(size>=min);
  if(rows.length>max){rows=rows.slice(0,max);let last=rows[max-1];while(ctx.measureText(last+'…').width>width)last=last.slice(0,-1);rows[max-1]=last+'…';}
  return {rows,size};
 };
 ctx.fillStyle='#eeede7';ctx.font='20px sans-serif';ctx.fillText('GALPI  /  A STORY TO KEEP',64,62);
 ctx.fillStyle='#fffdf5';
 const title=fit(book.title.replace(/\s*·\s*\d+권\s*$/,''),990,1,48,24);
 title.rows.forEach((line,i)=>ctx.fillText(line,64,133+i*title.size*1.4));
 const excerpt=quote.trim().slice(0,SHARE_QUOTE_LIMIT);
 if(excerpt){
  ctx.fillStyle='#fffdf5';ctx.font=`${TICKET_QUOTE_MARK.size}px Georgia,serif`;ctx.fillText('“',TICKET_QUOTE_MARK.x,TICKET_QUOTE_MARK.y);
  const passage=fit(excerpt,960,quotePages?7:8,32,26);quoteSize=passage.size;
  passage.rows.forEach((line,i)=>ctx.fillText(line,70,310+i*passage.size*1.3));
  if(quotePages&&Number.isInteger(quotePages.start)&&quotePages.start>0&&quotePages.end>=quotePages.start){
   ctx.fillStyle='#eeede7';ctx.font='20px sans-serif';ctx.textAlign='right';
   pageLabel=quotePages.end===quotePages.start?`p. ${quotePages.start}`:`pp. ${quotePages.start}–${quotePages.end}`;pageLabelY=Math.min(610,310+(passage.rows.length-1)*passage.size*1.3+44);ctx.fillText(pageLabel,1030,pageLabelY);
   ctx.textAlign='left';
  }
 }
 ctx.strokeStyle='#ffffff55';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(64,638);ctx.lineTo(1056,638);ctx.stroke();
 ctx.fillStyle='#eeede7';ctx.font='20px sans-serif';ctx.fillText(excerpt?'이 이야기의 한 장면':'당신에게 건네는 이야기',64,680);
 ctx.fillStyle='#f1eee6f2';ctx.fillRect(1120,0,320,720);
 ctx.fillStyle='#545952';ctx.font='19px sans-serif';ctx.fillText('갈피  /  간직할 이야기',1160,62);
 ctx.fillStyle='#263d32';ctx.font='18px sans-serif';ctx.fillText('VOLUME',1160,146);
 ctx.font='108px Georgia,serif';ctx.fillText(String(book.volumeNumber??1).padStart(2,'0'),1154,254);
 ctx.fillStyle='#263d32';
 const author=fit(bookAuthor(book,'\n✦\n'),236,5,26,20);
 ctx.textAlign='center';
 author.rows.forEach((line,i)=>{ctx.font=`${line==='✦'?14:author.size}px "Gowun Batang",serif`;ctx.fillText(line,1278,380+i*author.size*1.45);});
 ctx.textAlign='left';
 ctx.fillStyle='#263d32';ctx.font='28px "Gowun Batang",serif';ctx.fillText('책 읽기  ↗',1160,660);
 ctx.strokeStyle='#f1eee666';ctx.lineWidth=2;ctx.setLineDash([4,10]);ctx.beginPath();ctx.moveTo(1120,30);ctx.lineTo(1120,690);ctx.stroke();ctx.setLineDash([]);
 ctx.restore();
 // Genuine transparent cut-outs, so the card works on light and dark communities.
 ctx.globalCompositeOperation='destination-out';for(const y of [0,720]){ctx.beginPath();ctx.arc(1120,y,19,0,Math.PI*2);ctx.fill();}
 ctx.globalCompositeOperation='source-over';
 const encode=(source:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>source.toBlob(blob=>blob?resolve(blob):reject(new Error('카드 이미지를 만들지 못했어요.')),'image/png'));
 if(onEditorPreview){
  const editor=document.createElement('canvas');editor.width=1440;editor.height=720;const edit=editor.getContext('2d')!;edit.drawImage(canvas,0,0);
  // A transparent foreground keeps all fixed typography stationary while the
  // original image moves immediately underneath, without per-frame encoding.
  edit.clearRect(0,0,1120,720);
  edit.fillStyle='#eeede7';edit.font='20px sans-serif';edit.fillText('GALPI  /  A STORY TO KEEP',64,62);
  edit.strokeStyle='#ffffff55';edit.lineWidth=1;edit.beginPath();edit.moveTo(64,638);edit.lineTo(1056,638);edit.stroke();
  edit.fillText(excerpt?'이 이야기의 한 장면':'당신에게 건네는 이야기',64,680);
  if(pageLabel){edit.fillStyle='#eeede7';edit.font='20px sans-serif';edit.textAlign='right';edit.fillText(pageLabel,1030,pageLabelY);}
  const [result,preview]=await Promise.all([encode(canvas),encode(editor)]);onEditorPreview(preview,{titleSize:title.size,quoteSize,artwork});return result;
 }
 return encode(canvas);
}
