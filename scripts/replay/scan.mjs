import {marketState,oraclePrice,blockAt} from "./rpc.mjs";
import fs from "fs";
const d=JSON.parse(fs.readFileSync("../../data/replay/_markets_raw.json"));
const tss=[1774051200,1774137600,1774180800,1774224000,1774310400];
const blocks={};
for(const c of [1,8453,42161]){blocks[c]=[];for(const t of tss)blocks[c].push(await blockAt(c,t));}
console.log(JSON.stringify(blocks));
for(const m of d.markets.items){
  const c=m.morphoBlue.chain.id; const ld=m.loanAsset.decimals, cd=m.collateralAsset.decimals;
  const row=[];
  for(const b of blocks[c]){
    try{ const s=await marketState(c,m.marketId,b); const p=await oraclePrice(c,m.oracle.address,b);
      row.push(`${(Number(s.totalSupplyAssets)/10**ld).toFixed(0)}/${(Number(s.totalBorrowAssets)/10**ld).toFixed(0)}@${p===null?"na":(Number(p)/10**(36+ld-cd)).toFixed(4)}`);}catch(e){row.push("err")}
  }
  console.log(c,m.marketId.slice(0,10),m.collateralAsset.symbol+"/"+m.loanAsset.symbol,row.join("  "));
}
