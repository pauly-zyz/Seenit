import { createDb, type Database } from "@seenit/db";

import { ViemEscrowGateway } from "../chain/viem-gateway";
import type { EscrowGateway } from "../chain/types";
import { type AppConfig, parseEnv, toAppConfig } from "../config";
import { createLogger, type Logger } from "../logger";
import { R2Storage } from "../storage/r2";
import type { MediaStorage } from "../storage/types";

/** Everything a route needs. Built once from env; tests swap in fakes with setServices(). */
export interface Services {
  db: Database;
  chain: EscrowGateway;
  storage: MediaStorage;
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
    logger: createLogger(config.logLevel),
    config,
    now: () => new Date(),
  };
}
