import { createDb, type Database } from "@seenit/db";

import { type RegistryGateway, ViemRegistryGateway } from "../chain/registry-gateway";
import { ViemEscrowGateway } from "../chain/viem-gateway";
import type { EscrowGateway } from "../chain/types";
import { type AppConfig, parseEnv, toAppConfig } from "../config";
import { createLogger, type Logger } from "../logger";
import { createPersonhoodProviders, type PersonhoodProviders } from "../personhood";
import { R2Storage } from "../storage/r2";
import type { MediaStorage } from "../storage/types";

/** Everything a route needs. Built once from env; tests swap in fakes with setServices(). */
export interface Services {
  db: Database;
  chain: EscrowGateway;
  storage: MediaStorage;
  /** PersonhoodRegistry writer; null when no attester key is configured. */
  registry: RegistryGateway | null;
  /** Enabled personhood providers (empty when the registry is not configured). */
  personhood: PersonhoodProviders;
  logger: Logger;
  config: AppConfig;
  now: () => Date;
}

let current: Services | undefined;

export function getServices(): Services {
  if (!current) current = createServicesFromEnv();
  return current;
}

export function setServices(services: Services | undefined): void {
  current = services;
}

function createServicesFromEnv(): Services {
  const env = parseEnv();
  const config = toAppConfig(env);
  const registry = env.ATTESTER_PRIVATE_KEY
    ? new ViemRegistryGateway({
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        registryAddress: config.registryAddress,
        attesterPrivateKey: env.ATTESTER_PRIVATE_KEY as `0x${string}`,
      })
    : null;
  return {
    db: createDb(env.DATABASE_URL),
    chain: new ViemEscrowGateway({
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      escrowAddress: config.escrowAddress,
      tokenAddress: config.tokenAddress,
      operatorPrivateKey: env.OPERATOR_PRIVATE_KEY as `0x${string}`,
    }),
    storage: new R2Storage({
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      bucket: env.R2_BUCKET,
    }),
    registry,
    personhood: registry
      ? createPersonhoodProviders({
          humanPassport:
            env.HUMAN_PASSPORT_API_KEY && env.HUMAN_PASSPORT_SCORER_ID
              ? {
                  apiUrl: env.HUMAN_PASSPORT_API_URL,
                  apiKey: env.HUMAN_PASSPORT_API_KEY,
                  scorerId: env.HUMAN_PASSPORT_SCORER_ID,
                  minScore: env.HUMAN_PASSPORT_MIN_SCORE,
                  ttlDays: env.HUMAN_PASSPORT_TTL_DAYS,
                }
              : undefined,
          self:
            env.SELF_SCOPE && env.SELF_ENDPOINT
              ? {
                  appName: env.SELF_APP_NAME,
                  scope: env.SELF_SCOPE,
                  endpoint: env.SELF_ENDPOINT,
                  mockPassport: env.SELF_MOCK_PASSPORT,
                  deeplinkCallback: env.SELF_DEEPLINK_CALLBACK,
                  ttlDays: env.SELF_TTL_DAYS,
                }
              : undefined,
        })
      : new Map(),
    logger: createLogger(config.logLevel),
    config,
    now: () => new Date(),
  };
}
