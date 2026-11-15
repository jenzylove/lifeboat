import {call} from "./rpc.mjs";
import fs from "fs";
const F="../../data/replay/_stream_timeline_raw.json"; const R=JSON.parse(fs.readFileSync(F)); let n=0, bad=0;
for(const r of R) if(r.oracle==null){ for(let t=0;t<4;t++){ try{ r.oracle=BigInt(await call(42161,"0x1837efFC34Bb5a96EFdA00d53560799bE3a4226E","0xa035b1fe",r.block)).toString(); n++; break;}catch(e){ if(t===3)bad++; await new Promise(q=>setTimeout(q,800)); } } }
fs.writeFileSync(F,JSON.stringify(R)); console.log("fixed",n,"bad",bad,"rows",R.length);
