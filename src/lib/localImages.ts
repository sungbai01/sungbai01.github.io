import type {Book} from './library';

type Images=Pick<Book,'assets'|'cover'|'backCover'|'characterIcon'|'bookmarkStyle'|'bookmarkAssetId'|'shareCardAssetId'|'imageRules'|'displayRules'>;
type RecordValue=Images&{id:string};
const database='galpi-device-images';
function open(){return new Promise<IDBDatabase>((resolve,reject)=>{
 const request=indexedDB.open(database,2);
 request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('images'))request.result.createObjectStore('images',{keyPath:'id'});if(!request.result.objectStoreNames.contains('previews'))request.result.createObjectStore('previews',{keyPath:'id'});};
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('이 기기 이미지 저장소를 열지 못했어요.'));
});}
function key(owner:string,id:string){if(!/^u_[A-Za-z0-9_-]{43}$/.test(owner))throw new Error('계정이 올바르지 않아요.');return owner+':'+id;}
function images(book:Book):Images{return {assets:book.assets,cover:book.cover,backCover:book.backCover,characterIcon:book.characterIcon,bookmarkStyle:book.bookmarkStyle,bookmarkAssetId:book.bookmarkAssetId,shareCardAssetId:book.shareCardAssetId,imageRules:book.imageRules,displayRules:book.displayRules};}
async function transaction<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>,name='images'){
 const db=await open();try{return await new Promise<T>((resolve,reject)=>{
  const tx=db.transaction(name,mode),request=action(tx.objectStore(name));let result:T;
  request.onsuccess=()=>{result=request.result;};
  tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(new Error('이 기기 이미지를 저장하지 못했어요.'));tx.onerror=()=>{};
 });}finally{db.close();}
}
/** No title, prose, chapter, source log, or bookmark position is persisted here. */
export async function loadAccountImages(owner:string):Promise<Map<string,Images>>{
 const prefix=key(owner,'');
 const rows=await transaction('readonly',store=>store.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff')) as IDBRequest<RecordValue[]>,'previews');
 return new Map(rows.map(({id,...value})=>[id.slice(prefix.length),value]));
}
export async function loadBookImages(owner:string,id:string):Promise<Images|undefined>{const row=await transaction('readonly',store=>store.get(key(owner,id)) as IDBRequest<RecordValue|undefined>);if(!row)return;const {id:_id,...value}=row;return value;}
export async function saveAccountImages(owner:string,book:Book){
 const value=images(book),id=key(owner,book.id);
 if(!Object.values(value).some(item=>item!==undefined))return;
 await transaction('readwrite',store=>store.put({id,...value}));
 const preview={...value,assets:value.assets?.filter(asset=>asset.type==='icon'||asset.id===value.bookmarkAssetId||asset.id===value.shareCardAssetId),imageRules:undefined,displayRules:undefined};
 await transaction('readwrite',store=>store.put({id,...preview}),'previews');
}
export async function deleteAccountImages(owner:string,id:string){await transaction('readwrite',store=>store.delete(key(owner,id)));await transaction('readwrite',store=>store.delete(key(owner,id)),'previews');}
