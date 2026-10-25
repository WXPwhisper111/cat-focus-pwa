import { createLocalRepository, type FocusTaskRepository } from '../local-repository';
import { DB_VERSION, request, transact } from '../storage';
import { accountUid, assertSafeActivation, validateOwnership, type MigrationPhase, type OwnershipDecision } from './policy';
import { assertSchema, captureSnapshot, snapshotSummary, STORE_KEYS, STORE_NAMES, verifySnapshot, type FullSnapshot } from './snapshot';

export const PROTECTION_DATABASE = 'cat-focus-local-protection-v1';
export const GUEST_DATABASE = 'cat-focus-pwa';
type AccountPointer = { uid: string; revision: number; databaseName: string | null; migrationId: string | null };
type MigrationJob = {
  id: string; uid: string; snapshotId: string; targetDatabase: string; phase: MigrationPhase;
  previous: AccountPointer; liveSource: boolean; decision?: OwnershipDecision;
  sourceDatabase: string; claimSource: boolean;
};
export type MigrationPreview = {
  id: string; ownerUid: string; phase: MigrationPhase; snapshotHash: string; checksum: string;
  targetDatabase: string; replacesExisting: boolean; summary: ReturnType<typeof snapshotSummary>;
};

// A lease revokes old repositories, transactions, pending opens and late results.
class Lease {
  private databases = new Set<IDBDatabase>();
  private transactions = new Set<IDBTransaction>();
  private expired = false;
  constructor(readonly uid: string, readonly generation: number, private valid: () => boolean) {}
  assert() { if (this.expired || !this.valid()) throw Error('账号上下文已失效，请重新打开'); }
  bind(db: IDBDatabase): IDBDatabase {
    try { this.assert(); } catch (error) { db.close(); throw error; }
    this.databases.add(db);
    db.onversionchange = () => db.close();
    return new Proxy(db, {
      get: (target, key) => {
        if (key === 'transaction') return (...args: Parameters<IDBDatabase['transaction']>) => {
          this.assert();
          const tx = target.transaction(...args);
          this.transactions.add(tx);
          const finished = () => this.transactions.delete(tx);
          tx.addEventListener('complete', finished, { once: true }); tx.addEventListener('abort', finished, { once: true });
          return tx;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  close() {
    this.expired = true;
    for (const tx of this.transactions) { try { tx.abort(); } catch { /* Already committed. */ } }
    this.transactions.clear(); this.databases.forEach(db => db.close()); this.databases.clear();
  }
}

function openMetadata(lease: Lease): Promise<IDBDatabase> {
  lease.assert();
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = (error: unknown) => { failed = true; reject(error); };
    const req = indexedDB.open(PROTECTION_DATABASE, 1);
    req.onupgradeneeded = () => {
      try {
        lease.assert();
        req.result.createObjectStore('accounts', { keyPath: 'uid' });
        req.result.createObjectStore('jobs', { keyPath: 'id' }).createIndex('uid', 'uid');
        req.result.createObjectStore('snapshots', { keyPath: 'id' });
        req.result.createObjectStore('guestClaims', { keyPath: 'sourceDatabase' });
      } catch (error) { req.transaction!.abort(); fail(error); }
    };
    req.onerror = () => fail(req.error ?? Error('迁移日志打开失败'));
    req.onblocked = () => fail(Error('请关闭其他迁移测试页后重试'));
    req.onsuccess = () => {
      if (failed) { req.result.close(); return; }
      try { resolve(lease.bind(req.result)); } catch (error) { fail(error); }
    };
  });
}

// No schema upgrades or content initializers on a source/existing account database.
function openExisting(name: string, lease: Lease): Promise<IDBDatabase> {
  lease.assert();
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = (error: unknown) => { failed = true; reject(error); };
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => { req.transaction!.abort(); fail(Error('源存档不存在，未创建空库代替')); };
    req.onerror = () => fail(req.error ?? Error('现有存档打开失败'));
    req.onblocked = () => fail(Error('存档打开被其他页面阻止'));
    req.onsuccess = () => {
      if (failed) { req.result.close(); return; }
      try { const db = lease.bind(req.result); assertSchema(db); resolve(db); } catch (error) { req.result.close(); fail(error); }
    };
  });
}

function openShadow(job: MigrationJob, lease: Lease): Promise<IDBDatabase> {
  lease.assert();
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = (error: unknown) => { failed = true; reject(error); };
    const req = indexedDB.open(job.targetDatabase, DB_VERSION);
    req.onupgradeneeded = event => {
      try {
        lease.assert();
        if (event.oldVersion !== 0) throw Error('影子库版本冲突，未升级或覆盖');
        for (const name of STORE_NAMES) req.result.createObjectStore(name, STORE_KEYS[name] ? { keyPath: STORE_KEYS[name]! } : undefined);
      } catch (error) { req.transaction!.abort(); fail(error); }
    };
    req.onerror = () => fail(req.error ?? Error('影子副本创建失败'));
    req.onblocked = () => fail(Error('影子副本创建被阻止'));
    req.onsuccess = () => {
      if (failed) { req.result.close(); return; }
      try { const db = lease.bind(req.result); assertSchema(db); resolve(db); } catch (error) { req.result.close(); fail(error); }
    };
  });
}
const samePointer = (a: AccountPointer, b: AccountPointer) => a.uid === b.uid && a.revision === b.revision && a.databaseName === b.databaseName && a.migrationId === b.migrationId;
function assertOwnedDatabase(name: string, uid: string) {
  const suffix = name.slice(-36);
  if (name !== `cat-focus-pwa-user-${uid}-shadow-${suffix}` || !/^[0-9a-f-]{36}$/.test(suffix)) throw Error('数据库不属于当前账号');
}

export function createDataContextManager(options: { guestDatabase?: string } = {}) {
  // The optional source name is only for disposable test fixtures. Production does not use this manager yet.
  const guestDatabase = options.guestDatabase ?? GUEST_DATABASE;
  if (guestDatabase.startsWith('cat-focus-pwa-user-') || guestDatabase === PROTECTION_DATABASE) throw Error('账号库或迁移日志不能冒充访客源');
  let identity: string | null = null, generation = 0;
  const leases = new Set<Lease>();
  function revoke() { generation++; leases.forEach(lease => lease.close()); leases.clear(); }
  async function run<T>(operation: (lease: Lease, meta: IDBDatabase) => Promise<T>, binding?: { uid: string; generation: number }): Promise<T> {
    const uid = identity, epoch = generation;
    if (!uid || binding && (binding.uid !== uid || binding.generation !== epoch)) throw Error('账号上下文已失效，请先登录当前账号');
    const lease = new Lease(uid, epoch, () => identity === uid && generation === epoch);
    leases.add(lease);
    try { const result = await operation(lease, await openMetadata(lease)); lease.assert(); return result; }
    finally { lease.close(); leases.delete(lease); }
  }
  async function pointer(meta: IDBDatabase, uid: string): Promise<AccountPointer> {
    return transact(meta, ['accounts'], 'readonly', async tx => {
      const saved = await request<AccountPointer | undefined>(tx.objectStore('accounts').get(uid));
      if (saved && (saved.uid !== uid || !Number.isSafeInteger(saved.revision) || saved.revision < 0)) throw Error('账号指针损坏');
      if (saved?.databaseName) assertOwnedDatabase(saved.databaseName, uid);
      return saved ?? { uid, revision: 0, databaseName: null, migrationId: null };
    });
  }
  async function jobAndSnapshot(meta: IDBDatabase, lease: Lease, id: string) {
    return transact(meta, ['jobs', 'snapshots', 'guestClaims'], 'readonly', async tx => {
      const job = await request<MigrationJob | undefined>(tx.objectStore('jobs').get(id));
      if (!job || job.uid !== lease.uid) throw Error('当前账号没有此迁移记录');
      assertOwnedDatabase(job.targetDatabase, lease.uid);
      if (job.claimSource) {
        const claim = await request<{ uid: string } | undefined>(tx.objectStore('guestClaims').get(job.sourceDatabase));
        if (claim && claim.uid !== lease.uid) throw Error('访客源存档已归属其他账号，禁止访问');
      }
      const raw = await request<FullSnapshot | undefined>(tx.objectStore('snapshots').get(job.snapshotId));
      return { job, raw };
    });
  }
  function preview(job: MigrationJob, snapshot: FullSnapshot): MigrationPreview {
    return { id: job.id, ownerUid: job.uid, phase: job.phase, snapshotHash: snapshot.contentHash, checksum: snapshot.checksum,
      targetDatabase: job.targetDatabase, replacesExisting: !!job.previous.databaseName, summary: snapshotSummary(snapshot) };
  }
  async function prepare(lease: Lease, meta: IDBDatabase, snapshot: FullSnapshot, liveSource: boolean) {
    if (snapshot.ownerUid !== null && snapshot.ownerUid !== lease.uid) throw Error('快照属于其他账号，禁止恢复');
    if (snapshotSummary(snapshot).active) throw Error('请先结束活动专注，再迁移');
    if (snapshot.ownerUid === null) await checkGuestClaim(meta, lease, snapshot.sourceDatabase);
    const previous = await pointer(meta, lease.uid), id = crypto.randomUUID();
    const job: MigrationJob = { id, uid: lease.uid, snapshotId: snapshot.id, phase: 'prepared', previous, liveSource,
      sourceDatabase: snapshot.sourceDatabase, claimSource: snapshot.ownerUid === null,
      targetDatabase: `cat-focus-pwa-user-${lease.uid}-shadow-${id}` };
    lease.assert();
    await transact(meta, ['jobs', 'snapshots'], 'readwrite', async tx => {
      // Every preparation gets a separate snapshot id; a duplicate file's id must not overwrite an archive.
      const saved = await request<FullSnapshot | undefined>(tx.objectStore('snapshots').get(snapshot.id));
      if (saved && saved.checksum !== snapshot.checksum) throw Error('快照 ID 内容冲突');
      if (!saved) tx.objectStore('snapshots').add(snapshot);
      tx.objectStore('jobs').add(job);
    });
    return preview(job, snapshot);
  }
  async function updateJob(meta: IDBDatabase, lease: Lease, id: string, change: (current: MigrationJob) => MigrationJob) {
    await transact(meta, ['jobs'], 'readwrite', async tx => {
      const store = tx.objectStore('jobs'), current = await request<MigrationJob>(store.get(id));
      if (!current || current.uid !== lease.uid) throw Error('迁移记录已失效');
      store.put(change(current));
    });
  }
  async function checkLiveSource(job: MigrationJob, snapshot: FullSnapshot, lease: Lease) {
    if (!job.liveSource) return;
    const current = await captureSnapshot(await openExisting(snapshot.sourceDatabase, lease));
    if (current.contentHash !== snapshot.contentHash) throw Error('源数据已变化，请重新预览；原存档未修改');
  }
  async function checkGuestClaim(meta: IDBDatabase, lease: Lease, name: string) {
    await transact(meta, ['guestClaims'], 'readonly', async tx => {
      const claim = await request<{ uid: string } | undefined>(tx.objectStore('guestClaims').get(name));
      if (claim && claim.uid !== lease.uid) throw Error('访客源存档已归属其他账号，禁止访问');
    });
  }
  async function copyAndVerify(job: MigrationJob, snapshot: FullSnapshot, lease: Lease, meta: IDBDatabase) {
    const target = await openShadow(job, lease);
    const counts = await transact(target, STORE_NAMES, 'readonly', async tx => Promise.all(STORE_NAMES.map(name => request(tx.objectStore(name).count()))));
    if (counts.every(count => count === 0)) {
      // An interrupted failed copy leaves only this job's empty shadow schema. Never clear or overwrite rows.
      await transact(target, STORE_NAMES, 'readwrite', async tx => {
        for (const name of STORE_NAMES) for (const row of snapshot.data[name]) {
          const store = tx.objectStore(name);
          if (STORE_KEYS[name]) store.add(structuredClone(row.value)); else store.add(structuredClone(row.value), row.key);
        }
      });
    }
    await updateJob(meta, lease, job.id, current => {
      if (current.phase !== 'prepared' && current.phase !== 'copied' && current.phase !== 'verified') throw Error('迁移状态已变化');
      return { ...current, phase: 'copied' };
    });
    const copied = await captureSnapshot(target, lease.uid);
    if (copied.contentHash !== snapshot.contentHash) throw Error('影子副本与快照冲突，禁止覆盖或切换');
    await updateJob(meta, lease, job.id, current => {
      if (current.phase !== 'copied') throw Error('迁移状态已变化');
      return { ...current, phase: 'verified' };
    });
    return copied;
  }

  return {
    // Auth notifications only revoke memory state. They never read the guest store or assign ownership.
    setIdentity(uid: string | null) {
      const next = uid === null ? null : accountUid(uid);
      if (next !== identity) { revoke(); identity = next; }
    },
    destroy() { revoke(); identity = null; },
    currentUid() { return identity; },
    async status() { return run(async (lease, meta) => pointer(meta, lease.uid)); },
    async prepareGuestMigration(allowLocalRead: boolean) {
      if (allowLocalRead !== true) throw Error('读取访客存档预览也需要明确操作');
      return run(async (lease, meta) => {
        await checkGuestClaim(meta, lease, guestDatabase);
        return prepare(lease, meta, await captureSnapshot(await openExisting(guestDatabase, lease)), true);
      });
    },
    async prepareRecovery(raw: unknown) {
      // Validate before opening/creating any account data database. No automatic normalization or replay.
      return run(async (lease, meta) => prepare(lease, meta, await verifySnapshot(raw), false));
    },
    async migrations() {
      return run(async (lease, meta) => transact(meta, ['jobs'], 'readonly', async tx => {
        const jobs = await request<MigrationJob[]>(tx.objectStore('jobs').index('uid').getAll(lease.uid));
        return jobs.map(job => ({ id: job.id, phase: job.phase }));
      }));
    },
    async migration(id: string) {
      return run(async (lease, meta) => { const { job, raw } = await jobAndSnapshot(meta, lease, id); return preview(job, await verifySnapshot(raw)); });
    },
    async exportMigrationSnapshot(id: string) {
      return run(async (lease, meta) => { const { raw } = await jobAndSnapshot(meta, lease, id); return verifySnapshot(raw); });
    },
    async exportArchivedBranch(id: string) {
      return run(async (lease, meta) => {
        const { job } = await jobAndSnapshot(meta, lease, id);
        return captureSnapshot(await openExisting(job.targetDatabase, lease), lease.uid);
      });
    },
    async confirmAndActivate(id: string, decision: OwnershipDecision) {
      const expectedIdentity = identity, expectedGeneration = generation;
      const result = await run(async (lease, meta) => {
        const { job, raw } = await jobAndSnapshot(meta, lease, id), snapshot = await verifySnapshot(raw);
        validateOwnership(decision, lease.uid, snapshot.contentHash);
        const current = await pointer(meta, lease.uid);
        if (job.phase === 'active' && current.migrationId === id) return current;
        if (job.phase === 'active' || job.phase === 'rolled-back') throw Error('此迁移已结束，禁止旧请求重新激活');
        if (!samePointer(current, job.previous)) throw Error('账号数据上下文已变化，禁止覆盖');
        if (current.databaseName && decision.existingAccount !== 'keep-existing-as-archive') throw Error('账号已有独立钱包，请保留现有存档；若恢复需明确选择新分支并归档旧分支');
        await checkLiveSource(job, snapshot, lease);
        await updateJob(meta, lease, id, saved => ({ ...saved, decision: structuredClone(decision) }));
        const copied = await copyAndVerify(job, snapshot, lease, meta);
        await checkLiveSource(job, snapshot, lease);
        lease.assert();
        return transact(meta, ['accounts', 'jobs', 'guestClaims'], 'readwrite', async tx => {
          const accounts = tx.objectStore('accounts'), jobs = tx.objectStore('jobs');
          const latest = await request<AccountPointer | undefined>(accounts.get(lease.uid)) ?? { uid: lease.uid, revision: 0, databaseName: null, migrationId: null };
          const saved = await request<MigrationJob>(jobs.get(id));
          if (job.claimSource) {
            const claims = tx.objectStore('guestClaims');
            const claim = await request<{ uid: string } | undefined>(claims.get(job.sourceDatabase));
            if (claim && claim.uid !== lease.uid) throw Error('访客源存档已归属其他账号，未切换');
            if (!claim) claims.add({ sourceDatabase: job.sourceDatabase, uid: lease.uid, migrationId: id });
          }
          assertSafeActivation({ phase: saved.phase, sourceMatches: true, targetMatches: copied.contentHash === snapshot.contentHash,
            pointerUnchanged: samePointer(latest, job.previous), hasActiveSession: snapshotSummary(snapshot).active });
          const next: AccountPointer = { uid: lease.uid, revision: latest.revision + 1, databaseName: job.targetDatabase, migrationId: id };
          accounts.put(next); jobs.put({ ...saved, phase: 'active' } satisfies MigrationJob);
          return next;
        });
      });
      if (identity !== expectedIdentity || generation !== expectedGeneration) throw Error('账号上下文已变化，旧迁移结果未应用');
      revoke();
      return result;
    },
    async readAccountSnapshot() {
      return run(async (lease, meta) => {
        const saved = await pointer(meta, lease.uid);
        if (!saved.databaseName) throw Error('尚未确认此账号的数据归属');
        const snapshot = await captureSnapshot(await openExisting(saved.databaseName, lease), lease.uid);
        if (!samePointer(saved, await pointer(meta, lease.uid))) throw Error('数据上下文已变化，请重新读取');
        return snapshot;
      });
    },
    async taskRepository(): Promise<FocusTaskRepository> {
      const binding = await run(async (lease, meta) => {
        const saved = await pointer(meta, lease.uid);
        if (!saved.databaseName) throw Error('尚未确认此账号的数据归属');
        return { uid: lease.uid, generation: lease.generation, pointer: saved };
      });
      const call = <T>(operation: (repository: FocusTaskRepository) => Promise<T>): Promise<T> => run<T>(async (lease, meta): Promise<T> => {
        if (!samePointer(binding.pointer, await pointer(meta, lease.uid))) throw Error('数据上下文已变化，请重新打开');
        const db = await openExisting(binding.pointer.databaseName!, lease), repository = createLocalRepository(db).focusTasks;
        const result = await operation(repository);
        if (!samePointer(binding.pointer, await pointer(meta, lease.uid))) throw Error('数据上下文已变化，旧结果未应用');
        return result;
      }, binding);
      const repository: FocusTaskRepository = {
        list: () => call(tasks => tasks.list()), add: (...args) => call(tasks => tasks.add(...args)),
        change: (...args) => call(tasks => tasks.change(...args)), getState: () => call(tasks => tasks.getState()),
        select: (...args) => call(tasks => tasks.select(...args)), completeSummary: (...args) => call(tasks => tasks.completeSummary(...args)),
      };
      return repository;
    },
    async rollback(id: string) {
      const expectedIdentity = identity, expectedGeneration = generation;
      const result = await run(async (lease, meta) => {
        const { job } = await jobAndSnapshot(meta, lease, id), current = await pointer(meta, lease.uid);
        if (job.phase === 'rolled-back') return current;
        if (job.phase !== 'active' || current.migrationId !== id) throw Error('只能回滚当前已验证的迁移');
        const currentSnapshot = await captureSnapshot(await openExisting(current.databaseName!, lease), lease.uid);
        if (snapshotSummary(currentSnapshot).active) throw Error('请先结束活动专注，再回滚');
        if (job.previous.databaseName) {
          assertOwnedDatabase(job.previous.databaseName, lease.uid);
          await captureSnapshot(await openExisting(job.previous.databaseName, lease), lease.uid);
        }
        return transact(meta, ['accounts', 'jobs'], 'readwrite', async tx => {
          const latest = await request<AccountPointer>(tx.objectStore('accounts').get(lease.uid));
          if (!samePointer(latest, current)) throw Error('账号数据上下文已变化，未回滚');
          const next = { ...job.previous, revision: current.revision + 1 };
          tx.objectStore('accounts').put(next); tx.objectStore('jobs').put({ ...job, phase: 'rolled-back' } satisfies MigrationJob);
          return next;
        });
      });
      if (identity !== expectedIdentity || generation !== expectedGeneration) throw Error('账号上下文已变化，旧回滚结果未应用');
      revoke(); return result;
    },
  };
}
export type DataContextManager = ReturnType<typeof createDataContextManager>;
