const originals=new Map<string,Promise<Blob>>();
/** Bounded to the same nearby assets mounted by the reader. */
export function prepareAssetPreview(source:string):Promise<Blob>{
 const existing=originals.get(source);if(existing)return existing;
 const pending=fetch(source,{credentials:'omit'}).then(response=>{if(!response.ok)throw new Error('Image unavailable');return response.blob();});
 originals.set(source,pending);void pending.catch(()=>{if(originals.get(source)===pending)originals.delete(source);});
 while(originals.size>24)originals.delete(originals.keys().next().value!);
 return pending;
}
