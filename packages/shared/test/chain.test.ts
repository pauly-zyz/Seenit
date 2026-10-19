import { describe, expect, it } from "vitest";

import {
  explorerAddressUrl,
  explorerTxUrl,
  getChain,
  robinhoodChainTestnet,
} from "../src/index.js";

describe("chain", () => {
  it("defines Robinhood Chain testnet from the official docs", () => {
    expect(robinhoodChainTestnet.id).toBe(46630);
    expect(robinhoodChainTestnet.nativeCurrency.symbol).toBe("ETH");
    expect(robinhoodChainTestnet.testnet).toBe(true);
  });

  it("looks up supported chains and rejects unknown ones", () => {
    expect(getChain(46630)).toBe(robinhoodChainTestnet);
    expect(() => getChain(1)).toThrow("Unsupported chain id 1");
  });

  it("builds explorer links", () => {
    expect(explorerTxUrl(46630, "0xabc")).toBe(
      "https://explorer.testnet.chain.robinhood.com/tx/0xabc",
    );
    expect(explorerAddressUrl(46630, "0xdef")).toBe(
      "https://explorer.testnet.chain.robinhood.com/address/0xdef",
    );
  });
});
