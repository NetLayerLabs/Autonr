import type { ReactNode } from "react";
import { PageTitle } from "~~/components/autonr/PageTitle";

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
  <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] lg:gap-12">
    <div className="min-w-0">
      <PageTitle title="Mission control" eyebrow={<p className="tagline">Autonomy, enforced.</p>}>
        <p className="hero-subtitle m-0 text-[20px] font-medium leading-snug tracking-[-0.01em] sm:text-[22px]">
          Let an AI trade without trusting it.
        </p>
        <p className="m-0 mt-4">
          The agent only decides whether to trade. Two independent oracle networks decide at what price: Chainlink
          prices each leg and Supra must agree. The vault derives the minimum output itself, swaps on SaucerSwap V2 and
          only accepts trades whose reasoning was published to HCS first.
        </p>
      </PageTitle>
      <ol className="m-0 mt-10 grid list-none grid-cols-1 gap-3 p-0 min-[480px]:grid-cols-2 sm:grid-cols-3">
        {FLOW.map(({ step, detail }, index) => (
          <li key={step} className="surface-card px-4 py-3.5">
            <p className="m-0 flex items-baseline gap-2.5 text-[14px] font-semibold text-white">
              <span className="font-mono text-[11.5px] font-medium text-[#7a7a7a]">
                {String(index + 1).padStart(2, "0")}
              </span>
              {step}
            </p>
            <p className="m-0 mt-1 text-[13px] leading-snug">{detail}</p>
          </li>
        ))}
      </ol>
    </div>
    {aside}
  </div>
);
