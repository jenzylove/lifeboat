import {getLogs,blockAt,MORPHO} from "./rpc.mjs";
import fs from "fs";
const OUT="../../data/replay/";
const T0=1774094400, T1=1774310400;
const M={1:["0xd9e34b1eed46d123ac1b69b224de1881dbc88798bc7b70f504920f62f58f28cc","0xe1b65304edd8ceaea9b629df4c3c926a37d1216e27900505c04f14b2ed279f33","0x8e7cc042d739a365c43d0a52d5f24160fa7ae9b7e7c9a479bd02a56041d4cf77","0x4b86442549b52826e0fc11770ec5154450cb3c5c14dc751a761d81dcfbe7a7b2"],8453:["0xff0f2bd52ca786a4f8149f96622885e880222d8bed12bbbf5950296be8d03f89"]};
const PA={1:"0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D",8453:"0xA090dD1a701408Df1d4d0B85b716c87565f90467"};
const MM_T=["0xe86b6d3313d3098f4c5f689c935de8fde876a597c185def2cedab85efedac686","0xe851bb5856808a50efd748be463b8f35bcfb5ec74c5bfde776fe0a4d2a26db27","0x1026ceca5ed3747eb5edec555732d4a6f901ce1a875ecf981064628cadde1120","0x89bf199df65bf65155e3e0a8abc4ad4a1be606220c8295840dba2ab5656c1f6d","0xdd8bf5226dff861316e0fa7863fdb7dc7b87c614eb29a135f524eb79d5a1189a","0x3240fc70754c5a2b4dab10bf7081a00024bfc8491581ee3d355360ec0dd91f16"];
const res={};
for (const c of [1,8453]){
  const a=await blockAt(c,T0), b=await blockAt(c,T1);
  const blue=await getLogs(c,{address:MORPHO,topics:[null,M[c]]},a,b,1000);
  const pa=await getLogs(c,{address:PA[c],topics:[null,null,null,M[c]]},a,b,1000);
  const mm=await getLogs(c,{topics:[MM_T,null,M[c]]},a,b,1000);
  res[c]={from:a,to:b,blue,pa,mm};
  console.log(c,a,b,"blue",blue.length,"pa",pa.length,"mm",mm.length);
  fs.writeFileSync(OUT+"_logs.json",JSON.stringify(res));
}
