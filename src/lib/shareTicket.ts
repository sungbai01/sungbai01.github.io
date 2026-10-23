import type {Book} from './library';

export const SHARE_QUOTE_LIMIT=240;
export type QuotePageRange={start:number;end:number};
export const TICKET_QUOTE_MARK={x:60,y:278,size:70};
export type TicketTextLayout={titleSize:number;quoteSize:number};

// References: Behance /242278809 (perforation and separate stub),
// Dribbble /26570471 (typographic hierarchy and whitespace).
// Book details replace travel/cinema fields; the user's artwork remains the backdrop.
export async function makeTicketCard(book:Book,quote='',quotePages?:QuotePageRange,onEditorPreview?:(blob:Blob,layout:TicketTextLayout)=>void):Promise<Blob>{
 const source=book.assets?.find(asset=>asset.id===book.shareCardAssetId)?.src
   ??book.characterIcon??book.assets?.find(asset=>asset.type==='icon')?.src;
 // Card text and artwork prepare concurrently. Unrelated UI fonts must not
 // block this canvas indefinitely on a cold or unreliable connection.
 const fonts=new Promise<void>(resolve=>{
  const timer=setTimeout(resolve,700);
  void document.fonts.load('400 48px "Gowun Batang"',(book.title+(book.author??'')+quote).slice(0,512)).then(()=>{clearTimeout(timer);resolve();},()=>{clearTimeout(timer);resolve();});
 });
 const artwork=source?new Promise<HTMLImageElement>((resolve,reject)=>{
  const image=new Image();image.crossOrigin='anonymous';image.referrerPolicy='no-referrer';
  const timer=setTimeout(()=>{image.src='';reject(new Error('공유 카드 이미지를 불러오지 못했어요.'));},10000);
  image.onload=()=>{clearTimeout(timer);resolve(image);};image.onerror=()=>{clearTimeout(timer);reject(new Error('공유 카드 이미지를 불러오지 못했어요.'));};image.src=source;
 }):Promise.resolve(null);
 const [,image]=await Promise.all([fonts,artwork]);
 const canvas=document.createElement('canvas');canvas.width=1440;canvas.height=720;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('카드를 만들지 못했어요.');
 ctx.save();ctx.beginPath();ctx.roundRect(0,0,1440,720,24);ctx.clip();
 ctx.fillStyle=book.color;ctx.fillRect(0,0,1440,720);
 if(image){const scale=Math.max(1440/image.naturalWidth,720/image.naturalHeight);ctx.drawImage(image,(1440-image.naturalWidth*scale)/2,0,image.naturalWidth*scale,image.naturalHeight*scale);}
 const shade=ctx.createLinearGradient(0,720,1050,0);
 shade.addColorStop(0,'#101813ed');shade.addColorStop(.6,'#101813b8');shade.addColorStop(1,'#10181344');
 ctx.fillStyle=shade;ctx.fillRect(0,0,1440,720);
 const background=onEditorPreview?document.createElement('canvas'):null;
 if(background){background.width=1440;background.height=720;background.getContext('2d')!.drawImage(canvas,0,0);}
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
   pageLabel=`${quotePages.start}${quotePages.end!==quotePages.start?'–'+quotePages.end:''}쪽`;pageLabelY=Math.min(610,310+(passage.rows.length-1)*passage.size*1.3+44);ctx.fillText(pageLabel,1030,pageLabelY);
   ctx.textAlign='left';
  }
 }
 ctx.strokeStyle='#ffffff55';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(64,638);ctx.lineTo(1056,638);ctx.stroke();
 ctx.fillStyle='#eeede7';ctx.font='20px sans-serif';ctx.fillText(excerpt?'이 이야기의 한 장면':'당신에게 건네는 이야기',64,680);
 ctx.fillStyle='#f1eee6f2';ctx.fillRect(1120,0,320,720);
 ctx.fillStyle='#545952';ctx.font='19px sans-serif';ctx.fillText('갈피  /  SHARED BOOK',1160,62);
 ctx.fillStyle='#263d32';ctx.font='18px sans-serif';ctx.fillText('VOLUME',1160,146);
 ctx.font='108px Georgia,serif';ctx.fillText(String(book.volumeNumber??1).padStart(2,'0'),1154,254);
 ctx.fillStyle='#666b63';ctx.font='18px sans-serif';ctx.fillText('저자 모델',1160,356);
 ctx.fillStyle='#263d32';
 const author=fit(book.author?.trim()||book.aiModel?.trim()||'저자 모델 미상',236,4,26,20);
 author.rows.forEach((line,i)=>ctx.fillText(line,1160,399+i*author.size*1.45));
 ctx.fillStyle='#263d32';ctx.font='28px "Gowun Batang",serif';ctx.fillText('책 읽기  ↗',1160,660);
 ctx.strokeStyle='#f1eee666';ctx.lineWidth=2;ctx.setLineDash([4,10]);ctx.beginPath();ctx.moveTo(1120,30);ctx.lineTo(1120,690);ctx.stroke();ctx.setLineDash([]);
 ctx.restore();
 // Genuine transparent cut-outs, so the card works on light and dark communities.
 ctx.globalCompositeOperation='destination-out';for(const y of [0,720]){ctx.beginPath();ctx.arc(1120,y,19,0,Math.PI*2);ctx.fill();}
 ctx.globalCompositeOperation='source-over';
 const encode=(source:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>source.toBlob(blob=>blob&&blob.size<=2_000_000?resolve(blob):reject(new Error('카드 이미지가 너무 커요. 다른 배경 이미지를 선택해 주세요.')),'image/webp',.94));
 if(background&&onEditorPreview){
  const editor=document.createElement('canvas');editor.width=1440;editor.height=720;const edit=editor.getContext('2d')!;edit.drawImage(canvas,0,0);
  // Preserve the exported artwork and all noneditable details, then let the
  // two in-place text fields paint title/quote without duplicate canvas text.
  edit.drawImage(background,54,80,1010,540,54,80,1010,540);
  if(pageLabel){edit.fillStyle='#eeede7';edit.font='20px sans-serif';edit.textAlign='right';edit.fillText(pageLabel,1030,pageLabelY);}
  const [result,preview]=await Promise.all([encode(canvas),encode(editor)]);onEditorPreview(preview,{titleSize:title.size,quoteSize});return result;
 }
 return encode(canvas);
}
