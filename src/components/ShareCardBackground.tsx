import {useId} from 'react';
import type {TicketArtwork} from '../lib/shareTicket';

export default function ShareCardBackground({artwork,color,position}:{artwork?:TicketArtwork;color:string;position:number}){
 const id=useId();
 return <svg className="share-card-background" viewBox="0 0 1440 720" aria-hidden="true"><defs><mask id={`${id}-mask`} maskUnits="userSpaceOnUse"><rect width="1440" height="720" rx="24" fill="white"/>{[0,720].map(y=><circle key={y} cx="1120" cy={y} r="19" fill="black"/>)}</mask><linearGradient id={`${id}-shade`} gradientUnits="userSpaceOnUse" x1="0" y1="720" x2="1050" y2="0"><stop stopColor="#101813" stopOpacity={237/255}/><stop offset=".6" stopColor="#101813" stopOpacity={184/255}/><stop offset="1" stopColor="#101813" stopOpacity={68/255}/></linearGradient></defs><g mask={`url(#${id}-mask)`}><rect width="1440" height="720" fill={color}/>{artwork&&<image href={artwork.src} x={artwork.x} y={-artwork.overflow*position} width={artwork.width} height={artwork.height} preserveAspectRatio="none"/>}<rect width="1440" height="720" fill={`url(#${id}-shade)`}/></g></svg>;
}
