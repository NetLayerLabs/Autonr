// Generated from packages/foundry/contracts/interfaces/IAgentVault.sol.
// Regenerate with `yarn foundry:export-abi` after changing the interface; do not edit by hand.
export const agentVaultAbi = [
  {
    "type": "function",
    "name": "ROUTER",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ISaucerSwapV2SwapRouter"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SUPRA",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ISupraSValueFeed"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "agent",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "allowedTokens",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "associateToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "configureToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "chainlinkFeed",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "supraPairId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "supraEnabled",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "executeSwap",
    "inputs": [
      {
        "name": "request",
        "type": "tuple",
        "internalType": "struct IAgentVault.SwapRequest",
        "components": [
          {
            "name": "tokenIn",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "poolFee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "reasoning",
        "type": "tuple",
        "internalType": "struct IAgentVault.Reasoning",
        "components": [
          {
            "name": "hash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "sequence",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "hcsTopicNum",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastReasoningSequence",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lastTradeAt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextTradeAt",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "oracleReading",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IAgentVault.OracleReading",
        "components": [
          {
            "name": "priceE18",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "updatedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "crossCheckE18",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "crossCheckUpdatedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "divergenceBps",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "policy",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IAgentVault.Policy",
        "components": [
          {
            "name": "maxTradeUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dailyCapUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "cooldown",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxPriceAge",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxOracleDivergenceBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "poolFee",
    "inputs": [
      {
        "name": "tokenA",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenB",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quote",
    "inputs": [
      {
        "name": "request",
        "type": "tuple",
        "internalType": "struct IAgentVault.SwapRequest",
        "components": [
          {
            "name": "tokenIn",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenOut",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "poolFee",
            "type": "uint24",
            "internalType": "uint24"
          },
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IAgentVault.Quote",
        "components": [
          {
            "name": "usdValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expectedOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minAmountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "tokenIn",
            "type": "tuple",
            "internalType": "struct IAgentVault.OracleReading",
            "components": [
              {
                "name": "priceE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "updatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckUpdatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "divergenceBps",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "tokenOut",
            "type": "tuple",
            "internalType": "struct IAgentVault.OracleReading",
            "components": [
              {
                "name": "priceE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "updatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckUpdatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "divergenceBps",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "remainingDailyUsd",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "removeToken",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setAgent",
    "inputs": [
      {
        "name": "newAgent",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setDecisionTopic",
    "inputs": [
      {
        "name": "topicNum",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPolicy",
    "inputs": [
      {
        "name": "newPolicy",
        "type": "tuple",
        "internalType": "struct IAgentVault.Policy",
        "components": [
          {
            "name": "maxTradeUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dailyCapUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "cooldown",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxPriceAge",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxOracleDivergenceBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setPoolFee",
    "inputs": [
      {
        "name": "tokenA",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "tokenB",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "spentUsdOn",
    "inputs": [
      {
        "name": "day",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tokenConfig",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct IAgentVault.TokenConfig",
        "components": [
          {
            "name": "allowed",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "decimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "chainlinkFeed",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "supraPairId",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "supraEnabled",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tradeCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "unpause",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "to",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AgentUpdated",
    "inputs": [
      {
        "name": "previousAgent",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "newAgent",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DecisionTopicUpdated",
    "inputs": [
      {
        "name": "previousTopicNum",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "newTopicNum",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PolicyUpdated",
    "inputs": [
      {
        "name": "policy",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct IAgentVault.Policy",
        "components": [
          {
            "name": "maxTradeUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "dailyCapUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "cooldown",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxPriceAge",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "maxSlippageBps",
            "type": "uint16",
            "internalType": "uint16"
          },
          {
            "name": "maxOracleDivergenceBps",
            "type": "uint16",
            "internalType": "uint16"
          }
        ]
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PoolFeeSet",
    "inputs": [
      {
        "name": "tokenA",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenB",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "fee",
        "type": "uint24",
        "indexed": false,
        "internalType": "uint24"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenAssociated",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenConfigured",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "chainlinkFeed",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "supraPairId",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "supraEnabled",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "decimals",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TokenRemoved",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TradeExecuted",
    "inputs": [
      {
        "name": "tradeId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "tokenIn",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tokenOut",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "receipt",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct IAgentVault.TradeReceipt",
        "components": [
          {
            "name": "amountIn",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "amountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "minAmountOut",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "usdValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "oracleIn",
            "type": "tuple",
            "internalType": "struct IAgentVault.OracleReading",
            "components": [
              {
                "name": "priceE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "updatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckUpdatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "divergenceBps",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "oracleOut",
            "type": "tuple",
            "internalType": "struct IAgentVault.OracleReading",
            "components": [
              {
                "name": "priceE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "updatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckE18",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "crossCheckUpdatedAt",
                "type": "uint256",
                "internalType": "uint256"
              },
              {
                "name": "divergenceBps",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "reasoningHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "hcsTopicNum",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "hcsSequence",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawn",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "CooldownActive",
    "inputs": [
      {
        "name": "readyAt",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DailyCapExceeded",
    "inputs": [
      {
        "name": "usdValue",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "remainingUsd",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "DecisionTopicNotSet",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HtsAssociationFailed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "responseCode",
        "type": "int256",
        "internalType": "int256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InsufficientOutput",
    "inputs": [
      {
        "name": "amountOut",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "minAmountOut",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidOraclePrice",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidPair",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPolicy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoPriceSource",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAgent",
    "inputs": [
      {
        "name": "caller",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "OracleDivergence",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "divergenceBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxDivergenceBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "OwnershipCannotBeRenounced",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PoolFeeNotAllowed",
    "inputs": [
      {
        "name": "fee",
        "type": "uint24",
        "internalType": "uint24"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReasoningOutOfOrder",
    "inputs": [
      {
        "name": "sequence",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "lastSequence",
        "type": "uint64",
        "internalType": "uint64"
      }
    ]
  },
  {
    "type": "error",
    "name": "ReasoningRequired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "StalePrice",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "updatedAt",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxAge",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "TokenNotAllowed",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "TradeTooLarge",
    "inputs": [
      {
        "name": "usdValue",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxTradeUsd",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnsupportedDecimals",
    "inputs": [
      {
        "name": "decimals",
        "type": "uint8",
        "internalType": "uint8"
      }
    ]
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
