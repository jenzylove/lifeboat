// Samples oracle price, market state and secondary price every 10 min (Mar 21 12:00 -> Mar 24 00:00 UTC)
import {marketState,oraclePrice,call,rpc,hex,blockAt} from "./rpc.mjs";
import fs from "fs";
const OUT="../../data/replay/";
const T0=1774094400, T1=1774310400, STEP=600;
const CURVE="0x3eE841F47947FEFbE510366E4bbb49e145484195", WSTUSR="0x1202F5C7b4B9E47a1A484E8B270be34dbbC75055";
const MK=[
 {chain:1,id:"0xd9e34b1eed46d123ac1b69b224de1881dbc88798bc7b70f504920f62f58f28cc",oracle:"0xDa850a72080024e17c1590fbf6ea7a826dB90760",ld:6,cd:18},
 {chain:1,id:"0xe1b65304edd8ceaea9b629df4c3c926a37d1216e27900505c04f14b2ed279f33",oracle:"0x19018450A02bC5c1994eaD517498311f64B2626a",ld:6,cd:18},
 {chain:1,id:"0x8e7cc042d739a365c43d0a52d5f24160fa7ae9b7e7c9a479bd02a56041d4cf77",oracle:"0x8875ceb24E656FCA062759BDCF870F59A2B0187b",ld:6,cd:18},
 {chain:1,id:"0x4b86442549b52826e0fc11770ec5154450cb3c5c14dc751a761d81dcfbe7a7b2",oracle:"0x19018450A02bC5c1994eaD517498311f64B2626a",ld:6,cd:18},
 {chain:8453,id:"0xff0f2bd52ca786a4f8149f96622885e880222d8bed12bbbf5950296be8d03f89",oracle:"0xa40E4a5C4ff8ec8ae05648A4F34E02CeD8Ae9EFB",ld:6,cd:18},
];
async function pool(items,n,fn){const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;for(let t=0;;t++){try{out[k]=await fn(items[k]);break;}catch(e){if(t>4){console.error("fail",k,e.message.slice(0,120));out[k]=null;break;}await new Promise(r=>setTimeout(r,1000*(t+1)));}}}}));return out;}
// anchor blocks
const anchors={};
for(const c of [1,8453]){ const b=await blockAt(c,T0); const h=await rpc(c,"eth_getBlockByNumber",[hex(b),false]); anchors[c]={b,ts:Number(h.timestamp)}; }
const grid=[]; for(let t=T0;t<=T1;t+=STEP) grid.push(t);
async function blockFor(c,t){ // estimate then refine
  const per=c===1?12:2; let b=anchors[c].b+Math.round((t-anchors[c].ts)/per);
  for(let k=0;k<4;k++){ const h=await rpc(c,"eth_getBlockByNumber",[hex(b),false]); const ts=Number(h.timestamp); const d=Math.round((t-ts)/per); if(d===0||(c===1&&Math.abs(t-ts)<12)) return {b,ts}; b+=d; }
  const h=await rpc(c,"eth_getBlockByNumber",[hex(b),false]); return {b,ts:Number(h.timestamp)};
}
const cache=fs.existsSync(OUT+"_timeline_raw.json")?JSON.parse(fs.readFileSync(OUT+"_timeline_raw.json")):{};
for(const c of [1,8453]){
  if(cache[c]) continue;
  const rows=await pool(grid,6,async t=>{
    const {b,ts}=await blockFor(c,t);
    const r={t,ts,block:b,markets:{}};
    for(const m of MK.filter(m=>m.chain===c)){ const s=await marketState(c,m.id,b); const p=await oraclePrice(c,m.oracle,b);
      r.markets[m.id]={supply:s.totalSupplyAssets.toString(),borrow:s.totalBorrowAssets.toString(),oracle:p===null?null:p.toString()}; }
    if(c===1){ r.curveUSR1000=BigInt(await call(1,CURVE,"0x5e0d443f"+"0".repeat(64)+"0".repeat(63)+"1"+(1000n*10n**18n).toString(16).padStart(64,"0"),b)).toString();
      r.wstRate=BigInt(await call(1,WSTUSR,"0x07a2d13a"+(10n**18n).toString(16).padStart(64,"0"),b)).toString(); }
    return r;
  });
  cache[c]=rows; fs.writeFileSync(OUT+"_timeline_raw.json",JSON.stringify(cache));
  console.log("chain",c,"done",rows.filter(Boolean).length);
}
