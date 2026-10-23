/** Public aliases keep the private object key and all access checks unchanged. */
export function imageExtension(mime:string){return mime==='image/png'?'png':mime==='image/jpeg'?'jpg':mime==='image/webp'?'webp':null;}
export function shareMediaUrl(origin:string,share:string,image:string,mime:string){const extension=imageExtension(mime);return `${origin}/share-media/${share}/${image}${extension?'.'+extension:''}`;}
