export const RPCS = {
  1: ["https://mainnet.gateway.tenderly.co","https://eth.drpc.org","https://rpc.flashbots.net","https://ethereum-rpc.publicnode.com"],
  8453: ["https://base.gateway.tenderly.co","https://base.drpc.org","https://mainnet.base.org","https://base-rpc.publicnode.com"],
  42161: ["https://arbitrum.gateway.tenderly.co","https://arbitrum.drpc.org","https://arb1.arbitrum.io/rpc"],
};
export const LOG_RPCS = { 1: ["https://mainnet.gateway.tenderly.co"], 8453: ["https://base.gateway.tenderly.co"] };
export const MORPHO = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
let id=0;
export async function rpc(chain, method, params, tries=0) {
  const list = (method==="eth_getLogs" && LOG_RPCS[chain]) || RPCS[chain];
  let lastErr;
  for (let k=0;k<list.length*2;k++){
    const url = list[(k+tries)%list.length];
    try {
      const r = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:++id,method,params})});
      const t = await r.text(); let j; try{ j=JSON.parse(t);}catch{ throw new Error("bad json "+r.status+" "+t.slice(0,100)); }
      if (j.error) { lastErr=new Error(url+" "+JSON.stringify(j.error).slice(0,200)); if(/revert/i.test(j.error.message||"")) throw lastErr; continue; }
      return j.result;
    } catch(e){ lastErr=e; if(/revert/i.test(e.message)) throw e; await new Promise(r=>setTimeout(r,300)); }
  }
  throw lastErr;
}
export const hex = n => "0x"+BigInt(n).toString(16);
export async function call(chain,to,data,block){ return rpc(chain,"eth_call",[{to,data},typeof block==="string"?block:hex(block)]); }
export async function marketState(chain,id,block,morpho=MORPHO){
  const r = await call(chain,morpho,"0x5c60e39a"+id.slice(2),block);
  const w=i=>BigInt("0x"+r.slice(2+64*i,2+64*(i+1)));
  return {totalSupplyAssets:w(0),totalSupplyShares:w(1),totalBorrowAssets:w(2),totalBorrowShares:w(3),lastUpdate:w(4),fee:w(5)};
}
export async function oraclePrice(chain,oracle,block){
  try { const r=await call(chain,oracle,"0xa035b1fe",block); return BigInt(r);} catch(e){ return null; }
}
export async function blockTs(chain,n){ const b=await rpc(chain,"eth_getBlockByNumber",[hex(n),false]); return Number(b.timestamp); }
const LLNAME={1:"ethereum",8453:"base",42161:"arbitrum"};
export async function blockAt(chain,ts){ const r=await fetch(`https://coins.llama.fi/block/${LLNAME[chain]}/${ts}`); return (await r.json()).height; }
export async function getLogs(chain,filter,from,to,step=5000){
  const out=[];
  for(let a=from;a<=to;a+=step){
    const b=Math.min(to,a+step-1);
    
    try { out.push(...await rpc(chain,"eth_getLogs",[{...filter,fromBlock:hex(a),toBlock:hex(b)}])); }
    catch(e){ if(step>200){ out.push(...await getLogs(chain,filter,a,b,Math.floor(step/4))); } else throw e; }
  }
  return out;
}
