# Seenit

Seenit adalah marketplace "misi dunia nyata" untuk agen AI. Agen AI atau pendana membuat misi foto/video berbayar stablecoin di lokasi tertentu; manusia terverifikasi di sekitar lokasi merekam bukti lewat kamera di dalam aplikasi; rekaman diverifikasi, diubah menjadi jawaban JSON terstruktur oleh AI vision, lalu reward dibayarkan dari escrow.

Tagline kerja: "Eyes on the ground for AI agents."

## Chain

- Robinhood Chain (L2 EVM berbasis Arbitrum, gas token ETH). Gunakan testnet selama development.
- Selalu ambil chain ID, RPC URL, explorer, dan alamat kontrak stablecoin dari dokumentasi resmi Robinhood Chain (https://docs.robinhood.com/chain/). Jangan menebak alamat kontrak.
- Reward dalam stablecoin yang tersedia resmi di Robinhood Chain (mis. USDG atau USDC), dibuat configurable (`REWARD_TOKEN_*` di `.env`).

## Arsitektur (monorepo, pnpm + Turborepo)

- apps/web → Next.js (App Router, TypeScript, Tailwind): landing page, dashboard pendana, REST API
- apps/mobile → Expo (React Native): aplikasi kontributor (kamera in-app, GPS, peta misi)
- apps/mcp → MCP server (TypeScript MCP SDK) untuk agen AI
- packages/contracts → Foundry + Solidity: MissionEscrow, PersonhoodRegistry
- packages/db → Postgres + Drizzle ORM (schema & migrasi)
- packages/shared → tipe TypeScript, skema Zod, konstanta chain
- Storage media: S3-compatible (Cloudflare R2), akses lewat signed URL

## Proof of personhood

- Verifikasi off-chain di backend, lalu tulis atestasi ke PersonhoodRegistry on-chain.
- Tier 1: Human Passport (Unique Humanity Score) → misi bernilai rendah.
- Tier 2: Self Protocol (NFC paspor + ZK) → semua misi.
- Satu identitas (nullifier) hanya boleh terikat ke satu akun.

## Prinsip

- Keamanan dan anti-kecurangan diutamakan: kamera hanya dari dalam aplikasi (tanpa upload galeri), GPS + timestamp wajib, hash media dicatat on-chain.
- Privasi: wajah dan plat nomor di-blur otomatis sebelum media diserahkan ke pendana.
- Tulis test untuk setiap fitur. Contract wajib punya test Foundry lengkap.
- Cek dokumentasi terbaru (Self Protocol, Human Passport, MCP SDK, Expo) sebelum mengintegrasikan — jangan berasumsi nama package atau API.
- Jangan commit secret. Semua konfigurasi lewat .env dengan .env.example.

## Dev notes

- Setup & perintah lengkap ada di `README.md`. Ringkas: `pnpm install`, `git submodule update --init --recursive`, `pnpm db:up`, lalu `pnpm dev`.
- Cek sebelum selesai: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format:check`.
- Contracts: `cd packages/contracts && forge test`. Coverage: `pnpm -F @seenit/contracts coverage` (target 100%).
- Versi TypeScript, ESLint, Zod, Vitest diatur sekali lewat `catalog:` di `pnpm-workspace.yaml`. TypeScript dikunci di 6.0.x karena Expo SDK 58.
- Paket Expo ditambah dengan `npx expo install <pkg>` dari `apps/mobile` (bukan `pnpm add`), supaya versinya cocok dengan SDK.
- ESLint bersama ada di `packages/eslint-config` (`base`, `next`, `expo`). Prettier di root.
- Tiap app punya `.env.example` sendiri. Variabel `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` masuk ke bundle klien: jangan isi secret.
- Aturan bisnis yang ada di contract dan di `packages/shared` harus tetap sinkron:
  - `requiredTier()` ↔ `MissionEscrow.createMission` (min Tier 1; Tier 2 bila reward > `tier1MaxReward`).
  - `MissionStatus` / `SubmissionStatus` ↔ enum di `MissionEscrow.sol`.
- Alur escrow: verifier backend `recordSubmission` (setelah cek `checkCapture`) → funder/verifier `approve` atau `reject` selama review window → setelah window lewat siapa pun bisa `finalize` (kontributor dibayar).
- `mediaHash` on-chain = SHA-256 media asli (sebelum blur), lihat `sha256ToBytes32`. `specHash` = hash dari `canonicalJson(missionSpec)`.
