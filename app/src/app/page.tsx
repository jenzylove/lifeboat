import Link from 'next/link';
import { Waves, Boat } from '@/components/Waves';
import { BoardTable, LiveStrip, PasteBox } from '@/components/Board';
import { HowItWorks } from '@/components/HowItWorks';
import { ReplayPlayer } from '@/components/ReplayPlayer';
import { HouseBoat } from '@/components/HouseBoat';
import { Contracts, Decisions } from '@/components/Proof';
import { WatcherLine } from '@/components/Watcher';
import { PaymentsLive } from '@/components/Agents';

function Head({ n, title, children }: { n: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="sec-head">
      <div className="sec-num">{n}</div>
      <div>
        <h2 className="display">{title}</h2>
        {children && <p className="lede">{children}</p>}
      </div>
    </div>
  );
}

const AGENT_CODE = "curl -i \"https://lifeboat.jdollar.site/api/x402/ask?vault=0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61&chain=8453\"\n# 402 Payment Required, with the terms: $0.01 USDC on Base\n\nnode scripts/x402-ask.mjs 0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61\n# signs the payment, Lifeboat settles it, the live decision comes back";

const FAQ: [string, string][] = [
  ['Can Lifeboat take my money?', 'No. Your money sits in your own Lifeboat account, a small contract only you own. The agent key can do two things: pull money out of a vault into your account, and put it into another vault you approved. The contract has no function that lets the agent send money anywhere else. You can withdraw everything to your wallet at any time, and you can pause the agent with one click.'],
  ['What if the model gets it wrong?', 'Hard rules sit above the model. If the oracle sits more than 25% above the market and the curator has been silent for 30 minutes, Lifeboat leaves whatever the model says. If the curator has already cut the market to zero and moved money away, it stays. If the model answers in a broken format, the rules decide that call, and if the model is unavailable for 10 minutes while a clock is open, Lifeboat leaves by rule. Every decision is published with the evidence it used and a hash that is written onchain with the move.'],
  ['What if the market is already fully borrowed?', 'Then nobody can get out, including Lifeboat. A lender can only withdraw the cash that borrowers have not taken. That is why minutes matter, and why the replay shows exactly how much was still withdrawable at the minute Lifeboat would have left, instead of pretending the whole deposit was saved. It is also why Lifeboat opens a second kind of clock when a market sits near fully borrowed, before any price moves: in the Stream collapse of November 2025, lenders were locked in 13 hours before the price broke.'],
  ['What does it cost?', 'Two ways: agents and apps pay $0.01 per live check over x402 today; for armed accounts, a planned 10% of yield earned, taken when you withdraw, not charged during the hackathon. Running the model is cheap: reading the full evidence for one watched vault costs pennies a day on Dolphin, and the exact token counts and cost of every decision are on the proof page.'],
  ['Which chains does it work on?', 'Live accounts run on Base with USDC in Morpho vaults. The board and vault pages read Base and Ethereum. The replays use Ethereum and Base mainnet data from the incidents themselves (the Stream replay reads Arbitrum, where that market lived).'],
  ['What is SERV Reasoning used for?', 'After every action, SERV Reasoning writes the plain words notice you read: what happened, why, and where your money is now. Code states the facts (amounts, vaults, transaction) so the notice can never misstate where money went; SERV explains them. SERV Reasoning with PromptGuard also screens every outside text Lifeboat reads (forum posts, vault, curator and token names) before Dolphin sees it; a planted "ignore your rules" post is blocked and never reaches the decision.'],
  ['What does the curator have to do with it?', 'Curators run Morpho vaults and choose which markets your money lends into. When a price feed breaks, a good curator cuts the cap or moves money away within minutes. Lifeboat watches for those onchain moves. If the curator acts, you stay and keep earning. Lifeboat only steps in when the curator is silent.'],
  ['What is an oracle, and why does a stale one matter?', 'An oracle is the price feed a lending market trusts. If it keeps saying a token is worth $1.13 while it trades far lower, borrowers can post that token and borrow your USDC against a price that is not real. Lenders end up holding the loss. That is what happened on March 22 2026.'],
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <Waves />
        <Boat />
        <div className="wrap">
          <div className="eyebrow" style={{ marginBottom: 22 }}>Morpho vaults on Base · USDC</div>
          <h1 className="display">Your USDC gets off <em>before</em> the vault sinks.</h1>
          <p className="lede">Lifeboat watches the people running your vault. When a price feed freezes while the market falls and they stay silent, your money moves to a safer vault you picked. Nobody can send it anywhere else.</p>
          <div className="hero-ctas">
            <a href="#board" className="btn hot">Watch a vault</a>
            <Link href="/replay" className="btn">Replay March 22</Link>
          </div>
          <LiveStrip />
          <WatcherLine />
        </div>
      </section>

      <section className="section" id="board">
        <div className="wrap">
          <Head n="01" title="The board">The biggest USDC vaults on Base, every market inside them, read live. Open any vault to see each market as two lines: the orange dashed line is the price the market trusts, the light line is what the token really trades at. When they split and stay split, a clock opens.</Head>
          <BoardTable />
          <PasteBox />
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <Head n="02" title="Two silences">A vault gets dangerous when two things go quiet at once: the price feed, and the people running the vault. Lifeboat waits for the second one before it moves. And it looks sideways: one break on the board can sink a market whose own feed looks fine.</Head>
          <HowItWorks />
        </div>
      </section>

      <section className="section" id="replay">
        <div className="wrap">
          <Head n="03" title="Replay March 22">On March 22 2026 a Resolv key minted about 80 million unbacked USR. Morpho markets kept pricing wstUSR near $1.13 while it traded far lower. Here is that day, block by block, with every call Lifeboat would have made. Switch to Stream, November 2025, for the case where lenders were locked in before the price moved at all.</Head>
          <ReplayPlayer compact />
          <p style={{ marginTop: 22 }}><Link href="/replay" className="btn small">Open the full replay</Link></p>
        </div>
      </section>

      <section className="section" id="house">
        <div className="wrap">
          <Head n="04" title="The house boat">A real Lifeboat account on Base with real USDC. Press the button and the keeper runs a real exit and re park, with the transaction on Basescan.</Head>
          <HouseBoat />
        </div>
      </section>

      <section className="section" id="arm">
        <div className="wrap">
          <Head n="05" title="Arm your own">Connect a wallet with USDC on Base. Create your account, pick the vaults it may use, and put in as little as $1. You can pause the agent or take everything back at any time.</Head>
          <Link href="/app" className="btn hot">Arm your Lifeboat</Link>
        </div>
      </section>

      <section className="section" id="agents">
        <div className="wrap">
          <Head n="06" title="For agents: pay per check">Any agent or app can buy a live Lifeboat decision on any Morpho vault for $0.01 in USDC on Base, over x402. It is gasless for the payer: the agent signs an EIP 3009 transfer and Lifeboat settles it onchain. The site itself stays free for people.</Head>
          <div className="split">
            <div>
              <ol className="flow">
                <li><b>Ask.</b> The agent calls the check with a vault address and gets 402 back, with the price and where to pay.</li>
                <li><b>Sign.</b> It signs a $0.01 USDC transfer to Lifeboat. No gas, no account, no key exchange.</li>
                <li><b>Get the answer.</b> Lifeboat settles the payment on Base and returns the live decision with the receipt.</li>
              </ol>
              <pre className="code"><code>{AGENT_CODE}</code></pre>
              
              <p className="small"><a href="https://github.com/jenzylove/lifeboat/blob/master/scripts/x402-ask.mjs" target="_blank" rel="noreferrer">The client script on GitHub</a></p>
            </div>
            <div><PaymentsLive /></div>
          </div>
        </div>
      </section>

      <section className="section" id="proof">
        <div className="wrap">
          <Head n="07" title="Proof">Every claim on this page has something you can click.</Head>
          <div className="stat-row">
            <div><a href="https://github.com/jenzylove/lifeboat/tree/master/contracts/test" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><div className="bignum">9</div></a><div className="small dim"><a href="https://github.com/jenzylove/lifeboat/tree/master/contracts/test" target="_blank" rel="noreferrer">contract tests on a Base mainnet fork</a></div></div>
            <div><a href="https://github.com/jenzylove/lifeboat/tree/master/engine/test" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}><div className="bignum">48</div></a><div className="small dim">engine unit tests: <a href="https://github.com/jenzylove/lifeboat/blob/master/engine/src/decide/policy.test.ts" target="_blank" rel="noreferrer">policy</a> and <a href="https://github.com/jenzylove/lifeboat/tree/master/engine/test" target="_blank" rel="noreferrer">engine/test</a></div></div>
          </div>
          <Contracts />
          <h3 className="display" style={{ margin: '56px 0 8px' }}>Latest decisions</h3>
          <Decisions limit={5} />
          <p style={{ marginTop: 22 }}><Link href="/proof" className="btn small">Every record</Link></p>
        </div>
      </section>

      <section className="section" id="dolphin">
        <div className="wrap">
          <Head n="08" title="Why Dolphin" />
          <div className="why">
            <p>The core act here is a personal decision to move one person&apos;s money between named investment products. <a href="https://www.anthropic.com/legal/aup" target="_blank" rel="noreferrer">Anthropic&apos;s usage policy</a>, effective November 12 2026, requires a qualified person to review that kind of decision before it is acted on, so an agent that runs alone at 3 a.m. cannot run it on Claude. Open weights on Dolphin can: Lifeboat uses DeepSeek V4.1 Flash served by Dolphin to make the stay or leave call, and reading the full evidence for one watched vault costs pennies a day.</p>
            <p className="dim small">Dolphin serves open weights (DeepSeek V4.1 Flash) on its own network today; Lifeboat calls it over a standard API, so the model can move to any node that serves the same weights.</p>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap">
          <Head n="09" title="Questions" />
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
