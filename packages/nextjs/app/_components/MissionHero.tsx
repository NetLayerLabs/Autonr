import type { ReactNode } from "react";

const FLOW = [
  { step: "Decide", detail: "The strategy picks trade or hold." },
  { step: "Publish", detail: "The decision goes to an HCS topic only the agent key can write to." },
  { step: "Price", detail: "The vault reads Chainlink and requires Supra to agree." },
  { step: "Enforce", detail: "Trade cap, daily cap, cooldown and an oracle-derived minimum output." },
  { step: "Swap", detail: "SaucerSwap V2 executes; the output stays in the vault." },
  { step: "Verify", detail: "Anyone re-checks the trade from Mirror Node data." },
];

/** Pitch and flow on the left, the live deployment card (passed in) on the right. */
export const MissionHero = ({ aside }: { aside: ReactNode }) => (
  <div className="hedera-gradient dark:bg-none dark:bg-hedera-charcoal w-full px-4 sm:px-6 pt-8 pb-14">
    <div className="mx-auto grid max-w-7xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="min-w-0 text-white">
        <p className="m-0 text-xs font-medium uppercase tracking-widest">Autonr on Hedera</p>
        <h1 className="m-0 mt-2 text-3xl font-bold leading-tight sm:text-4xl">Let an AI trade without trusting it.</h1>
        <p className="m-0 mt-3 max-w-2xl text-sm leading-relaxed sm:text-base">
          The agent only decides whether to trade. Two independent oracle networks decide at what price: Chainlink
          prices each leg and Supra must agree. The vault derives the minimum output itself, swaps on SaucerSwap V2 and
          only accepts trades whose reasoning was published to HCS first.
        </p>
        <ol className="m-0 mt-5 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
          {FLOW.map(({ step, detail }, index) => (
            <li key={step} className="rounded-box bg-black/20 px-3 py-2 dark:bg-white/5">
              <p className="m-0 text-xs font-semibold">
                <span className="tabular-nums">{index + 1}.</span> {step}
              </p>
              <p className="m-0 mt-0.5 text-xs leading-snug">{detail}</p>
            </li>
          ))}
        </ol>
      </div>
      {aside}
    </div>
  </div>
);
