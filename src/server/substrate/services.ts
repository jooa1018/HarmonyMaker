import "server-only";

import { S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

import { CleanupService } from "../cleanup/cleanup-service";
import { applyMigrations } from "../persistence/migrations";
import { PostgresGovernanceStore } from "../persistence/postgres-store";
import { ShareStoreService } from "../share/share-store";
import { QuotaAndIdempotencyService } from "../security/quota";
import { AnonymousSessionService } from "../security/session";
import { S3OwnedObjectStore } from "../storage/s3-owned-object-store";
import { loadProductionSubstrateConfig } from "./config";

export interface ProductionServices {
  readonly sessions: AnonymousSessionService;
  readonly quota: QuotaAndIdempotencyService;
  readonly shares: ShareStoreService;
  readonly objects: S3OwnedObjectStore;
  readonly cleanup: CleanupService;
}

let servicesPromise: Promise<ProductionServices> | undefined;

/** The only production composition root. It deliberately has no test-adapter fallback. */
export function getProductionServices(): Promise<ProductionServices> {
  if (!servicesPromise) servicesPromise = (async () => {
    const config = loadProductionSubstrateConfig();
    const pool = new Pool({ connectionString: config.database.connectionString, max: 10 });
    await applyMigrations(pool);
    const store = new PostgresGovernanceStore(pool);
    const s3 = new S3Client({
      endpoint: config.objectStore.endpoint, region: config.objectStore.region,
      credentials: { accessKeyId: config.objectStore.accessKeyId, secretAccessKey: config.objectStore.secretAccessKey },
      forcePathStyle: true,
    });
    const objects = new S3OwnedObjectStore(s3, config.objectStore.bucket, store);
    return {
      sessions: new AnonymousSessionService(store, config.secrets.sessionTokenHmacKey, config.secrets.csrfHmacKey, process.env.NODE_ENV === "production"),
      quota: new QuotaAndIdempotencyService(store, config.secrets.quotaIpHmacKey),
      shares: new ShareStoreService(store, config.secrets.shareEncryptionKey, config.secrets.shareTokenHmacKey, config.secrets.ownerDeleteHmacKey, config.secrets.internalOperationsKey),
      objects,
      cleanup: new CleanupService(store, objects),
    };
  })().catch((error) => { servicesPromise = undefined; throw error; });
  return servicesPromise;
}
