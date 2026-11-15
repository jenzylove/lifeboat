import fs from "fs";
const L=JSON.parse(fs.readFileSync("../../data/replay/_logs.json"));
const N={"0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0":"Supply","0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf":"Withdraw","0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43":"Borrow","0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09":"Repay","0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184":"SupplyCollateral","0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142":"WithdrawCollateral","0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41":"Liquidate","0x9d9bd501d0657d7dfe415f779a620a62b78bc508ddc0891fbbd8b7ac0f8fce87":"AccrueInterest",
"0xe86b6d3313d3098f4c5f689c935de8fde876a597c185def2cedab85efedac686":"SetCap","0xe851bb5856808a50efd748be463b8f35bcfb5ec74c5bfde776fe0a4d2a26db27":"SubmitCap","0x1026ceca5ed3747eb5edec555732d4a6f901ce1a875ecf981064628cadde1120":"RevokePendingCap","0x89bf199df65bf65155e3e0a8abc4ad4a1be606220c8295840dba2ab5656c1f6d":"ReallocateSupply","0xdd8bf5226dff861316e0fa7863fdb7dc7b87c614eb29a135f524eb79d5a1189a":"ReallocateWithdraw","0x3240fc70754c5a2b4dab10bf7081a00024bfc8491581ee3d355360ec0dd91f16":"SubmitMarketRemoval","0x6218cdb9e8efb3d0e8136d32c91d9446eaf19e2e486bc67dfcb3d574ca60d504":"PublicReallocateTo","0xf8ae80b0854dfc3c73d3eb4b6160df1996a5859e6c1d11d10f3980a7f4691991":"PublicWithdrawal"};
for(const c of Object.keys(L)){
  for(const k of ["blue","pa","mm"]){
    const cnt={}; for(const l of L[c][k]){ const key=l.topics[k==="mm"?2:k==="pa"?3:1].slice(0,10)+" "+(N[l.topics[0]]||l.topics[0].slice(0,10)); cnt[key]=(cnt[key]||0)+1; }
    console.log(c,k,JSON.stringify(cnt));
  }
  const vaults={}; for(const l of L[c].mm){ vaults[l.address]=(vaults[l.address]||0)+1;} console.log("mm emitters",JSON.stringify(vaults));
  const pav={}; for(const l of L[c].pa){ const v="0x"+l.topics[2].slice(26); pav[v]=(pav[v]||0)+1;} console.log("PA vaults",JSON.stringify(pav));
  console.log("has ts?", L[c].blue[0].blockTimestamp);
}
