import {call} from "./rpc.mjs";
import fs from "fs";
const F="../../data/replay/_timeline_raw.json"; const TL=JSON.parse(fs.readFileSync(F));
const OR={"0xd9e34b1eed46d123ac1b69b224de1881dbc88798bc7b70f504920f62f58f28cc":"0xDa850a72080024e17c1590fbf6ea7a826dB90760","0xe1b65304edd8ceaea9b629df4c3c926a37d1216e27900505c04f14b2ed279f33":"0x19018450A02bC5c1994eaD517498311f64B2626a","0x8e7cc042d739a365c43d0a52d5f24160fa7ae9b7e7c9a479bd02a56041d4cf77":"0x8875ceb24E656FCA062759BDCF870F59A2B0187b","0x4b86442549b52826e0fc11770ec5154450cb3c5c14dc751a761d81dcfbe7a7b2":"0x19018450A02bC5c1994eaD517498311f64B2626a","0xff0f2bd52ca786a4f8149f96622885e880222d8bed12bbbf5950296be8d03f89":"0xa40E4a5C4ff8ec8ae05648A4F34E02CeD8Ae9EFB"};
let fixed=0, still=[];
for(const c of Object.keys(TL)) for(const r of TL[c]) for(const [id,s] of Object.entries(r.markets)) if(s.oracle==null){
  for(let t=0;t<4;t++){ try{ s.oracle=BigInt(await call(+c,OR[id],"0xa035b1fe",r.block)).toString(); fixed++; break;}catch(e){ if(t===3) still.push([c,id.slice(0,10),r.block,e.message.slice(0,150)]); await new Promise(q=>setTimeout(q,800)); } }
}
fs.writeFileSync(F,JSON.stringify(TL)); console.log("fixed",fixed,"still",JSON.stringify(still.slice(0,5)),still.length);
