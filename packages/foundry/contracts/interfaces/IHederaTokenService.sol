// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// @title IHederaTokenService
/// @notice The Hedera Token Service system contract at 0x167, reduced to what the vault calls.
/// @dev HTS reports failures as response codes instead of reverting, so callers must check the returned code.
interface IHederaTokenService {
    /// @notice Associates `account` with `token` so it can hold the token. A contract may associate itself.
    /// @return responseCode SUCCESS is 22, TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT is 194.
    function associateToken(address account, address token) external returns (int64 responseCode);
}
