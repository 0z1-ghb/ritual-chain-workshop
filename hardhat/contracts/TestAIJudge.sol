// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AIJudge} from "./AIJudge.sol";

contract TestAIJudge is AIJudge {
    bytes public lastLlmInput;

    function _runLlm(bytes calldata llmInput) internal override returns (bytes memory) {
        lastLlmInput = llmInput;
        return abi.encode(
            false,
            bytes('{"winnerIndex":0,"summary":"ok"}'),
            bytes(""),
            "",
            AIJudge.ConvoHistory("", "", "")
        );
    }
}
