import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

/**
 * Writes what forge compiled into packages/agent/src/abi/, the single source the agent, verifier and dashboard share:
 * the IAgentVault ABI (agentVault.ts), and AgentVault's runtime bytecode with the byte ranges of its immutables
 * (agentVaultCode.ts), which the verifier compares against the code of the contract that emitted a trade. Run it after
 * changing the contracts (the package script builds first). The output depends only on the compiled artifacts.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "out");
const abiDir = join(__dirname, "..", "..", "agent", "src", "abi");
const abiTarget = join(abiDir, "agentVault.ts");
const codeTarget = join(abiDir, "agentVaultCode.ts");

const abiHeader = `// Generated from packages/foundry/contracts/interfaces/IAgentVault.sol.
// Regenerate with \`yarn foundry:export-abi\` after changing the interface; do not edit by hand.
`;

const codeHeader = `// Generated from packages/foundry/contracts/AgentVault.sol.
// Regenerate with \`yarn foundry:export-abi\` after changing the contract; do not edit by hand.
`;

function readArtifact(file, contract) {
  const path = join(outDir, file, `${contract}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${path} (${error.message}). Compile the contracts with \`forge build\` first.`);
  }
}

/** Every immutable's byte range in the runtime code, sorted by offset; AST ids are dropped as they carry no meaning. */
function immutableRanges(deployedBytecode) {
  return Object.values(deployedBytecode.immutableReferences ?? {})
    .flat()
    .map(({ start, length }) => ({ start, length }))
    .sort((a, b) => a.start - b.start);
}

function codeModule(artifact) {
  const bytecode = artifact.deployedBytecode.object;
  if (!/^0x[0-9a-f]+$/.test(bytecode)) throw new Error("AgentVault has no runtime bytecode; is it abstract?");
  const ranges = immutableRanges(artifact.deployedBytecode)
    .map(({ start, length }) => `  { start: ${start}, length: ${length} },`)
    .join("\n");
  return `${codeHeader}
/** AgentVault's runtime bytecode as compiled, with its immutables (ROUTER, SUPRA) still zero. */
export const agentVaultRuntimeBytecode =
  "${bytecode}" as const;

/** Byte ranges the deployment fills with the immutables' values; mask them before comparing deployed code. */
export const agentVaultImmutableReferences: readonly { start: number; length: number }[] = [
${ranges}
];
`;
}

try {
  const { abi } = readArtifact("IAgentVault.sol", "IAgentVault");
  writeFileSync(abiTarget, `${abiHeader}export const agentVaultAbi = ${JSON.stringify(abi, null, 2)} as const;\n`);
  console.log(`Wrote ${abi.length} IAgentVault ABI entries to ${abiTarget}`);

  writeFileSync(codeTarget, codeModule(readArtifact("AgentVault.sol", "AgentVault")));
  console.log(`Wrote AgentVault's runtime bytecode to ${codeTarget}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
