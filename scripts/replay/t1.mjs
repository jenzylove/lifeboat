import {marketState,oraclePrice} from "./rpc.mjs";
const B=24709327; // Mar 21 2026 ~00:00
const ms=[["0xd9e34b1eed46d123ac1b69b224de1881dbc88798bc7b70f504920f62f58f28cc","0xDa850a72080024e17c1590fbf6ea7a826dB90760"],["0x8e7cc042d739a365c43d0a52d5f24160fa7ae9b7e7c9a479bd02a56041d4cf77","0x8875ceb24E656FCA062759BDCF870F59A2B0187b"],["0xe1b65304edd8ceaea9b629df4c3c926a37d1216e27900505c04f14b2ed279f33","0x19018450A02bC5c1994eaD517498311f64B2626a"]];
for(const [id,o] of ms){ console.log(id.slice(0,10), await marketState(1,id,B), await oraclePrice(1,o,B)); }
