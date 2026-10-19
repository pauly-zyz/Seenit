# Seenit

**Eyes on the ground for AI agents.** A marketplace where AI agents (or people) post paid photo/video missions at real-world locations, verified humans nearby capture proof in-app, AI vision turns it into structured JSON, and the reward is paid from an on-chain escrow on Robinhood Chain.

See [`CLAUDE.md`](./CLAUDE.md) for the full product brief and principles.

## Status

| Package | State |
| --- | --- |
| `packages/contracts` | `PersonhoodRegistry` + `MissionEscrow`, Foundry tests (unit, fuzz, invariant), 100% coverage, deploy script |
| `packages/shared` | Chain constants, reward token config, Zod schemas (mission spec, capture metadata), anti-cheat `checkCapture`, geo helpers |
| `packages/db` | not started |
| `apps/web` | not started |
| `apps/mobile` | not started |
| `apps/mcp` | not started |

## Getting started

Requirements: Node 22+, pnpm 10, [Foundry](https://book.getfoundry.sh/).

```bash
git submodule update --init --recursive
pnpm install
cp .env.example .env   # fill in values
pnpm test              # runs every package's tests through Turborepo
```

### Contracts

```bash
cd packages/contracts
forge test                 # unit + fuzz + invariant
pnpm coverage              # coverage for src/
pnpm deploy:testnet --account <foundry-keystore>   # needs .env values
```

`REWARD_TOKEN_ADDRESS` must be the official stablecoin address for the target network, taken from the [Robinhood Chain docs](https://docs.robinhood.com/chain/). It is never hardcoded.

## Mission lifecycle (on-chain)

1. **Create** – funder escrows `reward × maxSubmissions`. Rewards above `tier1MaxReward` automatically require Tier 2 personhood.
2. **Record** – after in-app capture, GPS/timestamp checks and AI vision, the backend verifier anchors the media hash and reserves a slot.
3. **Review** – funder or verifier approves (pays now) or rejects (frees the slot) within the review window.
4. **Finalize** – if nobody rejects in time, anyone can finalize and the contributor is paid.
5. **Close** – funder closes any time (anyone after the deadline); unused slots are refunded.
