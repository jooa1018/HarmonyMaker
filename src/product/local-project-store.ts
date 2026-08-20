import type { HarmonyProject } from "../domain/project";
import { importHarmonyProject, exportHarmonyProject } from "./project-transfer";

export const LOCAL_PROJECT_DATABASE_VERSION = 1;
const DATABASE_NAME = "harmonymaker-v0";
const STORE_NAME = "projects";

export interface LocalProjectRecord { readonly projectId: string; readonly updatedAt: string; readonly project: HarmonyProject }
export interface LocalProjectStore {
  save(record: LocalProjectRecord): Promise<void>;
  saveIfCurrent(record: LocalProjectRecord, expectedUpdatedAt: string, isStillCurrent?: () => boolean): Promise<boolean>;
  load(projectId: string): Promise<LocalProjectRecord | undefined>;
  list(): Promise<readonly Pick<LocalProjectRecord, "projectId" | "updatedAt">[]>;
  delete(projectId: string): Promise<void>;
  deleteIfCurrent(projectId: string, expectedUpdatedAt: string, isStillCurrent?: () => boolean): Promise<boolean>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_FAILED")); });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error("INDEXEDDB_FAILED")); transaction.onabort = () => reject(transaction.error ?? new Error("INDEXEDDB_ABORTED")); });
}

interface StoredProjectRecord { readonly projectId: string; readonly updatedAt: string; readonly encoded: string }

export class IndexedDbProjectStore implements LocalProjectStore {
  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}

  private async database(): Promise<IDBDatabase> {
    if (!this.factory) throw new RangeError("LOCAL_STORAGE_UNAVAILABLE");
    const request = this.factory.open(DATABASE_NAME, LOCAL_PROJECT_DATABASE_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "projectId" }); };
    return requestResult(request);
  }
  async save(record: LocalProjectRecord): Promise<void> {
    const encoded = await exportHarmonyProject(record.project);
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ projectId: record.projectId, updatedAt: record.updatedAt, encoded });
      await transactionDone(transaction);
    } finally { database.close(); }
  }
  async saveIfCurrent(record: LocalProjectRecord, expectedUpdatedAt: string, isStillCurrent: () => boolean = () => true): Promise<boolean> {
    const encoded = await exportHarmonyProject(record.project);
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const current = await requestResult(store.get(record.projectId)) as StoredProjectRecord | undefined;
      if (!current || current.updatedAt !== expectedUpdatedAt || !isStillCurrent()) {
        await transactionDone(transaction);
        return false;
      }
      store.put({ projectId: record.projectId, updatedAt: record.updatedAt, encoded });
      await transactionDone(transaction);
      return true;
    } finally { database.close(); }
  }
  async load(projectId: string): Promise<LocalProjectRecord | undefined> {
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const raw = await requestResult(transaction.objectStore(STORE_NAME).get(projectId)) as StoredProjectRecord | undefined;
      await transactionDone(transaction);
      if (!raw) return undefined;
      return { projectId: raw.projectId, updatedAt: raw.updatedAt, project: await importHarmonyProject(raw.encoded) };
    } finally { database.close(); }
  }
  async list(): Promise<readonly Pick<LocalProjectRecord, "projectId" | "updatedAt">[]> {
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const rows = await requestResult(transaction.objectStore(STORE_NAME).getAll()) as Array<{ projectId: string; updatedAt: string }>;
      await transactionDone(transaction);
      return rows.map(({ projectId, updatedAt }) => ({ projectId, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.projectId.localeCompare(b.projectId));
    } finally { database.close(); }
  }
  async delete(projectId: string): Promise<void> {
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(projectId);
      await transactionDone(transaction);
    } finally { database.close(); }
  }
  async deleteIfCurrent(projectId: string, expectedUpdatedAt: string, isStillCurrent: () => boolean = () => true): Promise<boolean> {
    const database = await this.database();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const current = await requestResult(store.get(projectId)) as StoredProjectRecord | undefined;
      if (!current || current.updatedAt !== expectedUpdatedAt || !isStillCurrent()) {
        await transactionDone(transaction);
        return false;
      }
      store.delete(projectId);
      await transactionDone(transaction);
      return true;
    } finally { database.close(); }
  }
}

/** Explicit test adapter; production UI constructs IndexedDbProjectStore. */
export class MemoryLocalProjectStore implements LocalProjectStore {
  private readonly records = new Map<string, { readonly updatedAt: string; readonly encoded: string }>();
  async save(record: LocalProjectRecord): Promise<void> { this.records.set(record.projectId, { updatedAt: record.updatedAt, encoded: await exportHarmonyProject(record.project) }); }
  async saveIfCurrent(record: LocalProjectRecord, expectedUpdatedAt: string, isStillCurrent: () => boolean = () => true): Promise<boolean> {
    const encoded = await exportHarmonyProject(record.project);
    const current = this.records.get(record.projectId);
    if (!current || current.updatedAt !== expectedUpdatedAt || !isStillCurrent()) return false;
    this.records.set(record.projectId, { updatedAt: record.updatedAt, encoded });
    return true;
  }
  async load(projectId: string): Promise<LocalProjectRecord | undefined> { const record = this.records.get(projectId); return record ? { projectId, updatedAt: record.updatedAt, project: await importHarmonyProject(record.encoded) } : undefined; }
  async list() { return [...this.records.entries()].map(([projectId, record]) => ({ projectId, updatedAt: record.updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async delete(projectId: string): Promise<void> { this.records.delete(projectId); }
  async deleteIfCurrent(projectId: string, expectedUpdatedAt: string, isStillCurrent: () => boolean = () => true): Promise<boolean> {
    const current = this.records.get(projectId);
    if (!current || current.updatedAt !== expectedUpdatedAt || !isStillCurrent()) return false;
    this.records.delete(projectId);
    return true;
  }
}
