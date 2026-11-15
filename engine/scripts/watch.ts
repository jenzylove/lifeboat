// The live watcher loop: one cycle a minute, forever. Acts on LEAVE decisions with the keeper.
import { cycle } from '../src/watcher.js';

const EVERY = Number(process.env.WATCH_EVERY_SEC ?? 60) * 1000;
const ACT = process.env.WATCH_ACT !== 'false';
let running = false;

async function tick() {
  if (running) return; // never overlap cycles
  running = true;
  const t0 = Date.now();
  try {
    const r = await cycle({ act: ACT });
    console.log(JSON.stringify({ watcher: 'cycle', at: new Date().toISOString(), ms: Date.now() - t0, accounts: r.accounts, markets: r.markets, openClocks: r.openClocks, decisions: r.decisions.map(d => ({ action: d.decision.action, by: d.decision.decidedBy, hash: d.hash })), moves: r.moves, errors: r.errors }));
  } catch (e) {
    console.error(JSON.stringify({ watcher: 'cycle_failed', at: new Date().toISOString(), error: String(e) }));
  } finally {
    running = false;
  }
}

console.log(JSON.stringify({ watcher: 'start', everySec: EVERY / 1000, act: ACT }));
await tick();
setInterval(tick, EVERY);
