import {marketState,oraclePrice,blockAt} from "./rpc.mjs";
const M=[[1,"0xc05394d0261ed1c3c1af310007fdc4e64b3bcf650822b70526763fefc64b729e","0xc36F094172a04D93f97f7154183e13bf241c0EEF","0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"],
[1,"0x39fe55e5102beac5fb3caff54142f26250b97dcdb5bea6122818c7760f38b331","0x2F05Ac98D85101b5F826D51337dF573CF02A0A38","0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"],
[42161,"0x9e90aec7d768403dacc9dd0d8320307fda3f980eed4df43e3e52168a1c667709","0x1837efFC34Bb5a96EFdA00d53560799bE3a4226E","0x6c247b1F6182318877311737BaC0844bAa518F5e"],
[42161,"0x7c03103c24ccfa9188bf41a8d44423cf5492645805eb1d23d9f862717d3fe5ab","0x14A7F156062D35861a285c7A7F5662964c2fe155","0x6c247b1F6182318877311737BaC0844bAa518F5e"]];
const tss=[1762128000,1762214400,1762300800,1762473600];
for(const [c,id,o,mb] of M){ const row=[]; for(const t of tss){ const b=await blockAt(c,t); try{const s=await marketState(c,id,b,mb); const p=await oraclePrice(c,o,b); row.push(`${b}:${(Number(s.totalSupplyAssets)/1e6).toFixed(0)}/${(Number(s.totalBorrowAssets)/1e6).toFixed(0)}@${p===null?"na":(Number(p)/1e24).toFixed(4)}`);}catch(e){row.push("err "+e.message.slice(0,60))} } console.log(c,id.slice(0,10),row.join("  ")); }
