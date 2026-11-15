import {gql} from "./gql.mjs";
import fs from "fs";
const L=JSON.parse(fs.readFileSync("../../data/replay/_logs.json"));
const out={};
for(const c of Object.keys(L)){
  const s=new Set(L[c].mm.map(l=>l.address.toLowerCase())); for(const l of L[c].pa) s.add("0x"+l.topics[2].slice(26));
  const addrs=[...s];
  const d=await gql(`query($a:[String!],$c:[Int!]){vaults(first:200,where:{address_in:$a,chainId_in:$c}){items{address name symbol asset{symbol} state{curator owner totalAssetsUsd curators{name}} }}}`,{a:addrs,c:[Number(c)]});
  const found=new Map(d.vaults.items.map(v=>[v.address.toLowerCase(),v]));
  for(const a of addrs){ const v=found.get(a); out[c+":"+a]=v?{name:v.name,asset:v.asset.symbol,curatorAddr:v.state?.curator,owner:v.state?.owner,curatorNames:(v.state?.curators||[]).map(x=>x.name)}:null; }
}
fs.writeFileSync("../../data/replay/_vaults_api.json",JSON.stringify(out,null,1));
for(const [k,v] of Object.entries(out)) console.log(k, v?`${v.name} | ${v.asset} | ${v.curatorNames.join(",")} | ${v.curatorAddr}`:"(not in API)");
