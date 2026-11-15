import {getLogs,blockAt} from "./rpc.mjs";
import fs from "fs";
const PA={1:"0xfd32fA2ca22c76dD6E550706Ad913FC6CE91c75D",8453:"0xA090dD1a701408Df1d4d0B85b716c87565f90467"};
const T0=1774094400, T1=1774310400; const res={};
for(const c of [1,8453]){ const a=await blockAt(c,T0), b=await blockAt(c,T1); res[c]=await getLogs(c,{address:PA[c]},a,b,1000); const k={}; for(const l of res[c]) k[l.topics[0].slice(0,10)]=(k[l.topics[0].slice(0,10)]||0)+1; console.log(c,res[c].length,JSON.stringify(k)); }
fs.writeFileSync("../../data/replay/_pa_all.json",JSON.stringify(res));
