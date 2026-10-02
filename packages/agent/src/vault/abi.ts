import { parseAbi } from "viem";

/** Views AgentVault inherits from OpenZeppelin (Ownable2Step, Pausable); IAgentVault does not declare them. */
export const vaultAccessAbi = parseAbi([
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
]);

/** Errors AgentVault can revert with beyond IAgentVault: OpenZeppelin v5's. */
export const vaultImplementationErrorsAbi = parseAbi([
  "error EnforcedPause()",
  "error ExpectedPause()",
  "error ReentrancyGuardReentrantCall()",
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
  "error SafeERC20FailedOperation(address token)",
]);

/** Solidity's built-in revert payloads. viem decodes them without being told; declaring them types their arguments. */
export const solidityErrorsAbi = parseAbi(["error Error(string reason)", "error Panic(uint256 code)"]);
