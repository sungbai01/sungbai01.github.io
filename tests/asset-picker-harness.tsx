import React from 'react';
import {createRoot} from 'react-dom/client';
import AssetManager from '../src/components/AssetManager';
export function mountAssetManager(){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const canvas=document.createElement('canvas');canvas.width=40;canvas.height=80;const src=canvas.toDataURL();root.render(<AssetManager assets={[{id:'first',name:'첫 이미지',type:'icon',src},{id:'second',name:'두번째',type:'asset',src}]} onClose={()=>root.unmount()} onSave={async(assets,rules,displayRules,bookmarkAssetId,shareCardAssetId)=>{(window as any).savedAssets={assets,bookmarkAssetId,shareCardAssetId};}}/>);}
