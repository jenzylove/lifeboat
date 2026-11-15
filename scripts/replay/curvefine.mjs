// Per-minute Curve USR/USDC quote around the depeg onset (Mar 22 01:30 -> 04:00 UTC)
import {call,rpc,hex,blockAt} from "./rpc.mjs";
import fs from "fs";
const CURVE="0x3eE841F47947FEFbE510366E4bbb49e145484195";
const a=await blockAt(1,1774143000), b=await blockAt(1,1774152000);
const blocks=[]; for(let x=a;x<=b;x+=5) blocks.push(x);
const out=[]; let i=0;
await Promise.all(Array.from({length:5},async()=>{ while(i<blocks.length){ const bl=blocks[i++];
  for(let t=0;t<5;t++){ try{ const h=await rpc(1,"eth_getBlockByNumber",[hex(bl),false]);
    const dy=BigInt(await call(1,CURVE,"0x5e0d443f"+"0".repeat(64)+"0".repeat(63)+"1"+(1000n*10n**18n).toString(16).padStart(64,"0"),bl));
    out.push({block:bl,ts:Number(h.timestamp),usrPerUsdc:Number(dy)/1e9}); break; }catch(e){ await new Promise(r=>setTimeout(r,1500)); } } } }));
out.sort((x,y)=>x.block-y.block);
fs.writeFileSync("../../data/replay/_curve_fine.json",JSON.stringify(out));
for(const r of out) if(r.usrPerUsdc<0.995) { console.log("first <0.995", new Date(r.ts*1000).toISOString(), r); break; }
for(const r of out) if(r.usrPerUsdc<0.95) { console.log("first <0.95", new Date(r.ts*1000).toISOString(), r); break; }
for(const r of out) if(r.usrPerUsdc*1.0<0.95/1) {}
console.log(out.length);
