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
  - `requiredTier()` ↔ `MissionEscrow.requiredTier` (min Tier 1; Tier 2 bila reward > `tier1MaxReward`).
  - `MissionStatus` / `SubmissionStatus` / `PersonhoodProvider` ↔ enum Solidity (dicek otomatis oleh `packages/shared/test/contracts-sync.test.ts`).
- Setelah mengubah contract: `pnpm -F @seenit/contracts export-abi` (menulis `packages/shared/src/abi/*` dan `deployments.ts`, jangan edit manual). CI gagal kalau hasil ekspor tidak di-commit.
- PersonhoodRegistry: provider menentukan tier (HumanPassport = 1, Self = 2). Satu nullifier terikat permanen ke satu wallet, revoke tidak membebaskannya. Hanya `ATTESTER_ROLE` yang menulis.
- MissionEscrow, role: `OPERATOR_ROLE` (backend: record, accept, reject), `PAUSER_ROLE`, admin 2-langkah (`AccessControlDefaultAdminRules`).
- Alur escrow: operator `recordSubmission` (setelah cek `checkCapture`, kontributor wajib `isVerified`) → pendana/operator `acceptSubmission` atau `rejectSubmission` selama review window → setelah window lewat siapa pun bisa `finalize`. Payout = reward − platform fee (bps, di-snapshot per misi, maks 10%). `cancelMission` (pendana, kapan saja) / `refund` (siapa pun, setelah deadline) mengembalikan slot yang tidak terpakai.
- Pause memblokir create/record/accept/reject. Cancel/refund/finalize tetap jalan supaya dana tidak pernah terkunci.
- `mediaHash` on-chain = SHA-256 media asli (sebelum blur), lihat `sha256ToBytes32`. `specHash` = hash dari `canonicalJson(missionSpec)`.
- Backend (`apps/web/src/server`): route handler tipis di `src/app/api/**/route.ts` memakai `route()` (auth, rate limit, validasi Zod, error JSON, log pino). Logika ada di `server/domain/*`.
- Layanan eksternal lewat interface di `server/services`: `EscrowGateway` (viem), `MediaStorage` (R2), `now()`. Test memakai `server/testing/harness.ts` (PGlite + fake), jangan memanggil jaringan sungguhan.
- Status DB disinkronkan dari event chain lewat `server/domain/sync.ts` (dipakai API dan indexer, idempoten via `chain_events`). Jangan menulis status on-chain ke DB di tempat lain.
- Media asli (`submissions.media_key`) tidak pernah dikirim ke pendana; hasil hanya memakai `blurred_media_key`.
- Setelah mengubah schema: `pnpm db:generate` lalu commit migrasi di `packages/db/drizzle`.
- Proof of personhood (`server/personhood/*`, `server/domain/personhood.ts`): setiap provider adalah adapter `PersonhoodProvider` (`instant` seperti Human Passport, atau `redirect` + callback seperti Self). Alur bersama `recordVerification`: cek wallet, tolak nullifier milik akun lain, simpan hanya `keccak256("seenit:<provider>:<nullifier>")`, lalu `PersonhoodRegistry.attest`. Tier dihitung hanya dari atestasi yang sudah on-chain (`tx_hash` terisi).
- Human Passport: `GET {HUMAN_PASSPORT_API_URL}/v2/stamps/{scorer_id}/score/{address}` dengan header `X-API-Key`. Tidak ada nullifier; anti-Sybil berasal dari dedup stamp Passport, jadi nullifier = scorer + wallet.
- Self: `@selfxyz/core` (`SelfBackendVerifier`, verifikasi lewat hub Self di Celo) + `@selfxyz/common` (`SelfAppBuilder`, `getUniversalLink`). Disclosure selalu kosong; jangan pernah membaca/menyimpan field paspor dari `discloseOutput` selain `nullifier`.
- Menambah provider baru (mis. World ID) butuh nilai baru di enum DB `personhood_provider` dan di `PersonhoodRegistry.Provider` (kontrak tidak upgradeable, jadi perlu deploy registry baru).
- Mobile: test dengan `jest-expo` + `@testing-library/react-native` (`pnpm -F @seenit/mobile test`).
- Mobile (`apps/mobile`): expo-router (`src/app`), screens in `src/screens` take their dependencies as props so they can be tested without native modules. Native mocks live in `jest.setup.ts`.
- The capture gate in mobile (`src/lib/capture-gate.ts`) mirrors the server checks (`checkCapture`, `CAPTURE_RULES`). Change both together.
- Uploads go through `UploadQueue` (`src/lib/upload-queue.ts`): it always requests a fresh upload URL and the server validates the GPS at capture time. `CAPTURE_MAX_AGE_MINUTES` (default 6 hours) sets how long an offline capture stays valid.
