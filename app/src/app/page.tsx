import Link from 'next/link';
import { Waves, Boat } from '@/components/Waves';
import { BoardTable, LiveStrip, PasteBox } from '@/components/Board';
import { HowItWorks } from '@/components/HowItWorks';
import { ReplayPlayer } from '@/components/ReplayPlayer';
import { HouseBoat } from '@/components/HouseBoat';
import { Contracts, Decisions } from '@/components/Proof';

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

const FAQ: [string, string][] = [
  ['Can Lifeboat take my money?', 'No. Your money sits in your own Lifeboat account, a small contract only you own. The agent key can do two things: pull money out of a vault into your account, and put it into another vault you approved. The contract has no function that lets the agent send money anywhere else. You can withdraw everything to your wallet at any time, and you can pause the agent with one click.'],
  ['What if the model gets it wrong?', 'Hard rules sit above the model. If the oracle sits more than 25% above the market and the curator has been silent for 30 minutes, Lifeboat leaves whatever the model says. If the curator has already cut the market to zero and moved money away, it stays. If the model is down or answers in a broken format, the rules decide. Every decision is published with the evidence it used and a hash that is written onchain with the move.'],
  ['What if the market is already fully borrowed?', 'Then nobody can get out, including Lifeboat. A lender can only withdraw the cash that borrowers have not taken. That is why minutes matter, and why the replay shows exactly how much was still withdrawable at the minute Lifeboat would have left, instead of pretending the whole deposit was saved.'],
  ['What does it cost?', 'Nothing to arm during the hackathon. The plan is 10% of the yield earned while armed, taken only when you withdraw. Running the model is cheap: reading the full evidence for one watched vault costs pennies a day on Dolphin, and the exact token counts and cost of every decision are on the proof page.'],
  ['Which chains does it work on?', 'Live accounts run on Base with USDC in Morpho vaults. The board and vault pages read Base and Ethereum. The March 22 replay uses Ethereum mainnet data, because that is where the Resolv incident happened.'],
  ['What is SERV Reasoning used for?', 'After every action, SERV Reasoning writes the plain words notice you read: what happened, why, and where your money is now. Code states the facts (amounts, vaults, transaction) so the notice can never misstate where money went; SERV explains them.'],
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
        </div>
      </section>

      <section className="section" id="board">
        <div className="wrap">
          <Head n="01" title="The board">The biggest USDC vaults on Base, every market inside them, read live. The orange dashed line is the price the market trusts. The light line is what the token really trades at. When they split and stay split, a clock opens.</Head>
          <BoardTable />
          <PasteBox />
        </div>
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <Head n="02" title="Two silences">A vault gets dangerous when two things go quiet at once: the price feed, and the people running the vault. Lifeboat waits for the second one before it moves.</Head>
          <HowItWorks />
        </div>
      </section>

      <section className="section" id="replay">
        <div className="wrap">
          <Head n="03" title="Replay March 22">On March 22 2026 a Resolv key minted about 80 million unbacked USR. Morpho markets kept pricing wstUSR near $1.13 while it traded far lower. Here is that day, block by block, and what Lifeboat would have done.</Head>
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

      <section className="section" id="proof">
        <div className="wrap">
          <Head n="06" title="Proof">Every claim on this page has something you can click.</Head>
          <div className="stat-row">
            <div><div className="bignum">9</div><div className="small dim">contract tests on a Base mainnet fork</div></div>
            <div><div className="bignum">38</div><div className="small dim">engine unit tests</div></div>
          </div>
          <Contracts />
          <h3 className="display" style={{ margin: '56px 0 8px' }}>Latest decisions</h3>
          <Decisions limit={5} />
          <p style={{ marginTop: 22 }}><Link href="/proof" className="btn small">Every record</Link></p>
        </div>
      </section>

      <section className="section" id="dolphin">
        <div className="wrap">
          <Head n="07" title="Why Dolphin" />
          <div className="why">
            <p>The core act here is a personal decision to move one person&apos;s money between named investment products. Anthropic&apos;s usage policy, effective November 12 2026, requires a qualified person to review that kind of decision before it is acted on, so an agent that runs alone at 3 a.m. cannot run it on Claude. Open weights on Dolphin can: Lifeboat uses DeepSeek V4.1 Flash served by Dolphin to make the stay or leave call, and reading the full evidence for one watched vault costs pennies a day.</p>
            <p className="dim small">Honest note: Dolphin serves the model from its own hardware today. We call it an open model on a different stack, not a fully decentralized one.</p>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap">
          <Head n="08" title="Questions" />
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
