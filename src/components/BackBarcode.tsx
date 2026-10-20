// Code 39 digit patterns and start/stop marker from the JsBarcode encoder:
// https://github.com/lindell/JsBarcode/blob/master/src/barcodes/CODE39/index.js
// Numeric payload is encoded only as bars: no visible/accessibility text label.
const digits = [20957,29783,23639,30485,20951,29813,23669,20855,29789,23645];
const guard = (35770).toString(2);
const encoded = guard + [...'155788848'].map(digit=>digits[Number(digit)].toString(2)+'0').join('') + guard;
const quiet = 10;
export default function BackBarcode(){
 const bars=[];
 for(let index=0;index<encoded.length;){
  if(encoded[index]!=='1'){index++;continue;}
  const start=index;while(encoded[index]==='1')index++;
  bars.push(<rect key={start} x={quiet+start} y={5} width={index-start} height={40}/>);
 }
 return <svg className="reader-back-barcode" viewBox={`0 0 ${encoded.length+quiet*2} 50`} aria-hidden="true" focusable="false" shapeRendering="crispEdges"><rect width="100%" height="100%" fill="var(--reader-preview-paper)"/><g fill="var(--reader-preview-ink)">{bars}</g></svg>;
}
