// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IHederaTokenService } from "../../contracts/interfaces/IHederaTokenService.sol";

/// @notice HTS system contract stand-in. Tests etch its code at 0x167, so its storage starts empty there: set the
///         response code through the etched address before calling the vault.
contract MockHederaTokenService is IHederaTokenService {
    int64 public responseCode;

    function setResponseCode(int64 code) external {
        responseCode = code;
    }

    function associateToken(address, address) external view returns (int64) {
        return responseCode;
    }
}
