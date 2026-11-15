import fs from "fs";
const L=JSON.parse(fs.readFileSync("../../data/replay/_logs.json"));
const id=process.argv[2], c=process.argv[3]||"1";
const iso=t=>new Date(parseInt(t,16)*1000).toISOString().slice(5,19);
const N={"0xedf88704":"Supply","0xa56fc0ad":"Withdraw","0x57095454":"Borrow","0x52acb05c":"Repay","0xa3b9472a":"SupplyColl","0xe80ebd7c":"WithdrawColl","0xa4946ede":"Liquidate","0xe86b6d33":"SetCap","0xe851bb58":"SubmitCap","0x89bf199d":"ReallocSupply","0xdd8bf522":"ReallocWithdraw","0x3240fc70":"SubmitRemoval","0xf8ae80b0":"PA_ReallocTo","0x6218cdb9":"PA_Withdrawal"};
const all=[...L[c].blue.filter(l=>l.topics[1].startsWith(id)),...L[c].mm.filter(l=>l.topics[2].startsWith(id)),...L[c].pa.filter(l=>l.topics[3].startsWith(id))].filter(l=>N[l.topics[0].slice(0,10)]).sort((a,b)=>parseInt(a.blockNumber,16)-parseInt(b.blockNumber,16));
let n=0;for(const l of all){const t=N[l.topics[0].slice(0,10)];const amt=["Withdraw","Borrow"].includes(t)?Number(BigInt("0x"+l.data.slice(66,130)))/1e6:["SupplyColl"].includes(t)?Number(BigInt("0x"+l.data.slice(2,66)))/1e18:Number(BigInt("0x"+l.data.slice(2,66)))/1e6;
 const who=l.address.toLowerCase()==="0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb"?"":(l.topics[0].startsWith("0xf8ae")||l.topics[0].startsWith("0x6218")?"PA v="+l.topics[2].slice(26,34):"v="+l.address.slice(0,8)+" by="+l.topics[1].slice(26,34));
 if(++n<=Number(process.argv[4]||400))console.log(iso(l.blockTimestamp),t,amt.toFixed(2),who);}
