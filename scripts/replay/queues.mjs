import {getLogs,blockAt} from "./rpc.mjs";
import fs from "fs";
const V=JSON.parse(fs.readFileSync("../../data/replay/_vaults_api.json"));
const T0=1774094400, T1=1774310400;
const res={};
for(const c of ["1","8453"]){
  const addrs=Object.keys(V).filter(k=>k.startsWith(c+":")).map(k=>k.split(":")[1]);
  const a=await blockAt(+c,T0), b=await blockAt(+c,T1);
  res[c]=await getLogs(+c,{address:addrs,topics:[["0x6ce31538fc7fba95714ddc8a275a09252b4b1fb8f33d2550aa58a5f62ad934de","0xe0c2db6b54586be6d7d49943139fccf0dd315ba63e55364a76c73cd8fdba724d"]]},a,b,1000);
  console.log(c,res[c].length);
}
fs.writeFileSync("../../data/replay/_queues.json",JSON.stringify(res));
