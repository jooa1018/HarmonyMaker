import type { HarmonyProject } from "../domain/project";
import { importHarmonyProject, exportHarmonyProject } from "./project-transfer";

export const LOCAL_PROJECT_DATABASE_VERSION = 1;
const DATABASE_NAME = "harmonymaker-v0";
const STORE_NAME = "projects";

export interface LocalProjectRecord { readonly projectId: string; readonly updatedAt: string; readonly project: HarmonyProject }
export interface LocalProjectStore {
  save(record: LocalProjectRecord): Promise<void>;
  load(projectId: string): Promise<LocalProjectRecord | undefined>;
  list(): Promise<readonly Pick<LocalProjectRecord, "projectId" | "updatedAt">[]>;
  delete(projectId: string): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_FAILED")); });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error("INDEXEDDB_FAILED")); transaction.onabort = () => reject(transaction.error ?? new Error("INDEXEDDB_ABORTED")); });
}

export class IndexedDbProjectStore implements LocalProjectStore {
  private async database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") throw new RangeError("LOCAL_STORAGE_UNAVAILABLE");
    const request = indexedDB.open(DATABASE_NAME, LOCAL_PROJECT_DATABASE_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "projectId" }); };
    return requestResult(request);
  }
  async save(record: LocalProjectRecord): Promise<void> {
    const encoded = await exportHarmonyProject(record.project);
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ projectId: record.projectId, updatedAt: record.updatedAt, encoded });
    await transactionDone(transaction); database.close();
  }
  async load(projectId: string): Promise<LocalProjectRecord | undefined> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const raw = await requestResult(transaction.objectStore(STORE_NAME).get(projectId)) as { projectId: string; updatedAt: string; encoded: string } | undefined;
    await transactionDone(transaction); database.close();
    if (!raw) return undefined;
    return { projectId: raw.projectId, updatedAt: raw.updatedAt, project: await importHarmonyProject(raw.encoded) };
  }
  async list(): Promise<readonly Pick<LocalProjectRecord, "projectId" | "updatedAt">[]> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const rows = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as Array<{ projectId: string; updatedAt: string }>;
    await transactionDone(transaction); database.close();
    return rows.map(({ projectId, updatedAt }) => ({ projectId, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.projectId.localeCompare(b.projectId));
  }
  async delete(projectId: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(projectId);
    await transactionDone(transaction); database.close();
  }
}

/** Explicit test adapter; production UI constructs IndexedDbProjectStore. */
export class MemoryLocalProjectStore implements LocalProjectStore {
  private readonly records = new Map<string, { readonly updatedAt: string; readonly encoded: string }>();
  async save(record: LocalProjectRecord): Promise<void> { this.records.set(record.projectId, { updatedAt: record.updatedAt, encoded: await exportHarmonyProject(record.project) }); }
  async load(projectId: string): Promise<LocalProjectRecord | undefined> { const record = this.records.get(projectId); return record ? { projectId, updatedAt: record.updatedAt, project: await importHarmonyProject(record.encoded) } : undefined; }
  async list() { return [...this.records.entries()].map(([projectId, record]) => ({ projectId, updatedAt: record.updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async delete(projectId: string): Promise<void> { this.records.delete(projectId); }
}
