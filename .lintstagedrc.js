const path = require("path");

const buildNextEslintCommand = filenames =>
  `yarn workspace @sh/nextjs eslint --fix ${filenames.map(f => path.relative(path.join("packages", "nextjs"), f)).join(" ")}`;

const checkTypesNextCommand = () => "yarn next:check-types";

const buildAgentEslintCommand = filenames =>
  `yarn workspace @sh/agent eslint --fix ${filenames.map(f => path.relative(path.join("packages", "agent"), f)).join(" ")}`;

const checkTypesAgentCommand = () => "yarn agent:check-types";

// Foundry files are deliberately absent: create-scaffold-hbar amends its first commit with the forge-installed lib/
// submodules while this hook runs, and `forge fmt` already guards Solidity in CI.
module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [buildNextEslintCommand, checkTypesNextCommand],
  "packages/agent/**/*.ts": [buildAgentEslintCommand, checkTypesAgentCommand],
};
