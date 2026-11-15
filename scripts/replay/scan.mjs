import {marketState,oraclePrice} from "./rpc.mjs";
import fs from "fs";
const d=JSON.parse(fs.readFileSync("../../data/replay/_markets_raw.json"));
const blocks={"1":[24702157,24709327,24712911,24716494,24723660],"8453":[43630927,43674127,43695727,43717327,43760527],"42161":[443938204,444283789,444456704,444629629,444975139]};
const skip=new Set(process.argv.slice(2));
const res=await Promise.all(d.markets.items.filter(m=>!skip.has(m.marketId.slice(0,10))).map(async m=>{
  const c=m.morphoBlue.chain.id; const ld=m.loanAsset.decimals, cd=m.collateralAsset.decimals;
  const row=await Promise.all(blocks[c].map(async b=>{
    try{ const s=await marketState(c,m.marketId,b,m.morphoBlue.address); const p=await oraclePrice(c,m.oracle.address,b);
      return `${(Number(s.totalSupplyAssets)/10**ld).toFixed(0)}/${(Number(s.totalBorrowAssets)/10**ld).toFixed(0)}@${p===null?"na":(Number(p)/10**(36+ld-cd)).toFixed(4)}`;}catch(e){return "err:"+e.message.slice(0,80)}
  }));
  return [c,m.marketId.slice(0,10),m.collateralAsset.symbol+"/"+m.loanAsset.symbol,row.join("  ")].join(" ");
}));
console.log(res.join("\n"));
