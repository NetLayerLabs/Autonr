/**
 * Commands the dashboard asks operators to run. They live in a .ts file on purpose: when a project is scaffolded with
 * npm, create-scaffold-hbar rewrites package manager commands in .ts files (it skips .tsx), so every page shows the
 * form that works for the package manager the project was created with.
 */
export const COMMANDS = {
  chain: "yarn chain",
  deploy: "yarn deploy:testnet",
  setup: "yarn agent:setup",
  doctor: "yarn agent:doctor",
  fund: "yarn vault:fund -- --hbar 20",
  dryRun: "yarn agent:dry-run",
  tick: "yarn agent:tick",
  loop: "yarn agent:loop",
  redTeam: "yarn agent:red-team",
  audit: "yarn verify -- --audit",
} as const;

export const verifyCommand = (tx: string, network: string) => `yarn verify -- ${tx} --network ${network}`;

export const replayCommand = (sequence: number) => `yarn verify -- --replay ${sequence}`;
