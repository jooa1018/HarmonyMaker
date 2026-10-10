import "server-only";

import { Pool } from "pg";

import { CleanupService } from "../cleanup/cleanup-service";
import { verifyMigrations } from "../persistence/migrations";
import { PostgresGovernanceStore } from "../persistence/postgres-store";
import { ShareStoreService } from "../share/share-store";
import { QuotaAndIdempotencyService } from "../security/quota";
import { AnonymousSessionService } from "../security/session";
import { developmentMemoryPersistenceEnabled, loadPersistenceSecrets, loadProductionSubstrateConfig } from "./config";

export interface ProductionServices {
  readonly sessions: AnonymousSessionService;
  readonly quota: QuotaAndIdempotencyService;
  readonly shares: ShareStoreService;
  readonly cleanup: CleanupService;
}

let servicesPromise: Promise<ProductionServices> | undefined;

/** PostgreSQL by default; explicit development-only memory mode never falls back on failure. */
export function getProductionServices(): Promise<ProductionServices> {
  const memory = developmentMemoryPersistenceEnabled();
  if (!servicesPromise) servicesPromise = (async () => {
    if (memory) {
      const secrets = loadPersistenceSecrets();
      const { MemoryGovernanceStore } = await import("../persistence/memory-store.test-adapter");
      const store = new MemoryGovernanceStore();
      return {
        sessions: new AnonymousSessionService(store, secrets.sessionTokenHmacKey, secrets.csrfHmacKey, false),
        quota: new QuotaAndIdempotencyService(store, secrets.quotaIpHmacKey),
        shares: new ShareStoreService(store, secrets.shareEncryptionKey, secrets.shareTokenHmacKey, secrets.ownerDeleteHmacKey, secrets.internalOperationsKey),
        cleanup: new CleanupService(store),
      };
    }
    const config = loadProductionSubstrateConfig();
    const pool = new Pool({ connectionString: config.database.connectionString, max: 10 });
    try { await verifyMigrations(pool); }
    catch (error) { await pool.end().catch(() => undefined); throw error; }
    const store = new PostgresGovernanceStore(pool);
    return {
      sessions: new AnonymousSessionService(store, config.secrets.sessionTokenHmacKey, config.secrets.csrfHmacKey, process.env.NODE_ENV === "production"),
      quota: new QuotaAndIdempotencyService(store, config.secrets.quotaIpHmacKey),
      shares: new ShareStoreService(store, config.secrets.shareEncryptionKey, config.secrets.shareTokenHmacKey, config.secrets.ownerDeleteHmacKey, config.secrets.internalOperationsKey),
      cleanup: new CleanupService(store),
    };
  })().catch((error) => { servicesPromise = undefined; throw error; });
  return servicesPromise;
}
