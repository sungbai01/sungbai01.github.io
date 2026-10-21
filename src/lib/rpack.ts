/** Official RisuAI byte-substitution RPack; see RPACK-LICENSE.txt (MIT).
 * https://github.com/kwaroran/Risuai/blob/main/src/ts/rpack/rpack_js.js
 * Decode module JSON and inert image bytes. Scripts and triggers never run.
 */
const MAP_BASE64 = 'xA0eC70rP1X8RW71ZlNPGuC7MJSGumu/QVBvm+/etxBhFyDfMomonW2ryZAADF2v0sFW5RZkkYJldJfKI9ZS0f+0oOgvilg4WmAZlknb18g7PkNLpWNHqmopkvQVz2I0eNMdPOIFjipXDhvNTC3yQCwleUgPsnq1p2w35px7VH7+h9yaAuQzouuxLgPdmaaw59WIGIN89r7hXJ/DIUYfCE7QdhJf7v2PROqjXosoCTWeacwKx4UHrUrzd+ln1NqEgJO2TXP6JyZ/BMb78XI5UcI2qWis+O3FucvOdaQ9gdlCcByVEbzYjJj5WaET9xR9s+xxwOON8AGuWzEGJCI6uCz3hIvJZfu2n66zAy0BaXQf5KPs7lw0IZNKD2riYgKeIpz9PPxxx8atWWcFcG2KRBL6JIZfr9F6R87+UGPdUQZvGOBSqAmdVnNMuFNsw6AOGc8+DX4HMmhG6kj5mS6rpEkgXlU1OAy807FYFnkoChrh8s3EOduiumBydn2V73/IwN43lL+1FIGSJUWs5/Vmpys2WsET40s66I2DG3wnsJpC64eq3FSOeCbSVynUt/gvj4l18EF3wh7/2BUR5QSXF/Mx0JsA18q0Tyo72bJr2l2hPzBhvZE9Tubfvk2CjB0jEJhk9IUze5BDu6mI8dalHPbMbrlbC5bt1enFywimgEA=';
export function decodeRPack(data: Uint8Array): Uint8Array {
  const map = atob(MAP_BASE64);
  const result = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index++) result[index] = map.charCodeAt(256 + data[index]!);
  return result;
}
export function readModuleData(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.length < 7 || bytes[0] !== 111 || bytes[1] !== 0) throw new Error('지원하지 않는 RISUM 모듈 헤더입니다.');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, true);
  if (!length || length > bytes.length - 6) throw new Error('RISUM JSON 길이가 올바르지 않습니다.');
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodeRPack(bytes.subarray(6, 6 + length))));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('RISUM 데이터가 올바르지 않습니다.');
  const envelope = value as Record<string, unknown>;
  if (envelope.type !== 'risuModule' || !envelope.module || typeof envelope.module !== 'object' || Array.isArray(envelope.module)) throw new Error('RISUM 모듈 JSON이 올바르지 않습니다.');
  return envelope.module as Record<string, unknown>;
}

/** Legacy RISUM: JSON length + RPack JSON, then 1/length/RPack asset blocks,
 * terminated by 0. Asset order matches module.assets in the official exporter:
 * https://github.com/kwaroran/Risuai/blob/main/src/ts/process/modules.ts */
export function readModuleBundle(bytes:Uint8Array){
 const module=readModuleData(bytes);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let offset=6+view.getUint32(2,true);
 const assets:Uint8Array[]=[];
 while(offset<bytes.length){
  const marker=bytes[offset++]!;
  if(marker===0)return {module,assets};
  if(marker!==1||offset+4>bytes.length)throw new Error('RISUM 에셋 헤더가 올바르지 않습니다.');
  const length=view.getUint32(offset,true);offset+=4;
  if(length>bytes.length-offset)throw new Error('RISUM 에셋 데이터가 잘렸습니다.');
  assets.push(decodeRPack(bytes.subarray(offset,offset+length)));offset+=length;
 }
 throw new Error('RISUM 파일의 끝 표시가 없습니다.');
}
