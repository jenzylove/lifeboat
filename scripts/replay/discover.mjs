import {gql} from "./gql.mjs";
import fs from "fs";
const addrs=process.argv.slice(2);
const d=await gql(`query($a:[String!]){ markets(first:200, where:{collateralAssetAddress_in:$a}){ items{ marketId lltv oracle{address} badDebt{usd} realizedBadDebt{usd} morphoBlue{address chain{id}} loanAsset{symbol address decimals} collateralAsset{symbol address decimals} state{supplyAssetsUsd borrowAssetsUsd utilization} supplyingVaults{address name} } } }`,{a:addrs});
fs.writeFileSync("../../data/replay/_markets_raw.json",JSON.stringify(d,null,1));
for(const m of d.markets.items)console.log(m.morphoBlue.chain.id,m.marketId,m.collateralAsset.symbol+"/"+m.loanAsset.symbol,m.lltv/1e16,m.oracle?.address,m.badDebt?.usd,m.realizedBadDebt?.usd,Math.round(m.state?.supplyAssetsUsd),Math.round(m.state?.borrowAssetsUsd),m.supplyingVaults.map(v=>v.name).join("|"))
