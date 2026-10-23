import {useState,type ReactNode} from 'react';
import {Check,ImageOff,Search} from 'lucide-react';
import type {BookAsset} from '../lib/library';
import './asset-picker.css';
export default function AssetPicker({assets,label='에셋 목록',selectedIds=[],onSelect,selectionLabel='선택',disabled=false,layout='grid',renderDetails,renderActions,emptyText='등록된 에셋이 없어요.'}:{assets:readonly BookAsset[];label?:string;selectedIds?:readonly string[];onSelect?:(asset:BookAsset)=>void;selectionLabel?:string;disabled?:boolean;layout?:'grid'|'list';renderDetails?:(asset:BookAsset,index:number)=>ReactNode;renderActions?:(asset:BookAsset,index:number)=>ReactNode;emptyText?:string}){
 const [query,setQuery]=useState('');const filtered=assets.map((asset,index)=>({asset,index})).filter(({asset})=>asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <div className="asset-picker"><label className="asset-picker-search"><Search size={15}/><input aria-label={`${label} 검색`} placeholder="에셋 검색" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className={`asset-picker-items asset-picker-${layout}`} aria-label={label}>
 {!filtered.length&&<p className="asset-picker-empty">{assets.length?'검색 결과가 없어요.':emptyText}</p>}
 {filtered.map(({asset,index})=><div className="asset-picker-item" key={asset.id} data-selected={selectedIds.includes(asset.id)||undefined}>
 {onSelect?<button type="button" className="asset-picker-choice" aria-label={`${asset.name} ${selectionLabel}`} aria-pressed={selectedIds.includes(asset.id)} disabled={disabled} onClick={()=>onSelect(asset)}><AssetThumbnail source={asset.src}/><span>{asset.name}</span>{selectedIds.includes(asset.id)&&<Check className="asset-picker-check" size={16}/>}</button>:<AssetThumbnail source={asset.src}/>}
 {renderDetails?<div className="asset-picker-details">{renderDetails(asset,index)}</div>:!onSelect&&<span className="asset-picker-name">{asset.name}</span>}{renderActions&&<div className="asset-picker-actions">{renderActions(asset,index)}</div>}
 </div>)}
 </div></div>;
}
export function AssetThumbnail({source}:{source:string}){const [failed,setFailed]=useState('');return <span className="asset-picker-thumbnail">{failed===source?<ImageOff size={20} aria-label="미리보기 없음"/>:<img src={source} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(source)}/>}</span>;}
