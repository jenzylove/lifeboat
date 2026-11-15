const BS={1:"https://eth.blockscout.com",8453:"https://base.blockscout.com"};
export async function bsLogs(chain,{address,topics={}},from,to){
  const out=[]; let a=from;
  while(a<=to){
    const p=new URLSearchParams({module:"logs",action:"getLogs",fromBlock:String(a),toBlock:String(to)});
    if(address)p.set("address",address);
    const keys=Object.keys(topics); for(const k of keys)p.set("topic"+k,topics[k]);
    for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++)p.set(`topic${keys[i]}_${keys[j]}_opr`,"and");
    let j;
    for(let t=0;t<12;t++){ await new Promise(r=>setTimeout(r,800)); try{ const r=await fetch(BS[chain]+"/api?"+p); j=await r.json(); if(j.result||j.message==="No logs found")break; }catch(e){} await new Promise(r=>setTimeout(r,5000)); }
    if(!j||!Array.isArray(j.result)) { if(j?.message==="No logs found") break; throw new Error("bs fail "+JSON.stringify(j).slice(0,200)); }
    out.push(...j.result);
    if(j.result.length<1000) break;
    const last=parseInt(j.result.at(-1).blockNumber,16);
    // drop last block's entries and refetch from it to avoid partial blocks
    while(out.length&&parseInt(out.at(-1).blockNumber,16)===last) out.pop();
    a=last;
  }
  return out;
}
