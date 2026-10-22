import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { progress } from '../src/domain';
import { acknowledgeCompletion, getWallet, exportBackup, getActive, getPendingCompletions, getRecords, importBackup, openDatabase, settle, startSession, startStopwatch } from '../src/storage';

let db: IDBDatabase;
const start = Date.parse('2026-10-19T10:00:00+08:00');
const category = 'builtin-english';
beforeEach(async () => { db = await openDatabase(`ending-${crypto.randomUUID()}`); });
afterEach(() => { vi.restoreAllMocks(); db.close(); });

describe('completion summaries and rewards', () => {
  it('records the actual newly earned minutes, including fractions carried across sessions', async () => {
    await startStopwatch(db, category, start);
    const first = await settle(db, 'early', start + 30_000);
    expect(first.earned).toBe(0);
    await startStopwatch(db, category, start + 31_000);
    const second = await settle(db, 'early', start + 61_000);
    expect(second.earned).toBe(1);
    const pending = await getPendingCompletions(db);
    expect(pending.map(item => item.earned)).toEqual([0, 1]);
    expect(progress(await getRecords(db)).experience).toBe(1);
    await acknowledgeCompletion(db, first.record!.id);
    expect((await getPendingCompletions(db)).map(item => item.record.id)).toEqual([second.record!.id]);
    expect(progress(await getRecords(db)).experience).toBe(1);
  });

  it('persists unacknowledged summaries and never reopens them after acknowledgement', async () => {
    await startSession(db, category, 1, start);
    const result = await settle(db, 'due', start + 86_400_000);
    const name = db.name;
    db.close(); db = await openDatabase(name);
    const [summary] = await getPendingCompletions(db);
    expect(summary).toMatchObject({ earned: 1, record: { id: result.record!.id, durationSeconds: 60, completed: true } });
    expect(Date.parse(summary.record.endedAt)).toBe(start + 60_000);
    await acknowledgeCompletion(db, summary.record.id);
    db.close(); db = await openDatabase(name);
    expect(await getPendingCompletions(db)).toEqual([]);
    expect(await getRecords(db)).toHaveLength(1);
  });

  it('creates only one summary and reward across concurrent pages', async () => {
    await startSession(db, category, 2, start);
    const other = await openDatabase(db.name);
    const results = await Promise.all([settle(db, 'due', start + 120_000), settle(other, 'early', start + 120_000)]);
    expect(results.filter(item => item.created)).toHaveLength(1);
    expect(results.reduce((sum, item) => sum + (item.earned || 0), 0)).toBe(2);
    const [summary] = await getPendingCompletions(db);
    expect(await getPendingCompletions(db)).toHaveLength(1);
    await Promise.all([acknowledgeCompletion(db, summary.record.id), acknowledgeCompletion(other, summary.record.id)]);
    expect(await getPendingCompletions(db)).toHaveLength(0);
    expect((await getWallet(db)).state.balance).toBe(0);
    other.close();
  });

  it('does not create a completion summary for discard or a zero-duration save', async () => {
    await startStopwatch(db, category, start);
    await settle(db, 'discard', start + 60_000);
    await startStopwatch(db, category, start + 60_000);
    await settle(db, 'early', start + 60_000);
    expect(await getPendingCompletions(db)).toEqual([]);
    expect(await getRecords(db)).toEqual([]);
    expect(await getActive(db)).toBeUndefined();
  });

  it('keeps summaries local when exporting and importing completed records', async () => {
    await startStopwatch(db, category, start);
    await settle(db, 'early', start + 60_000);
    const raw = await exportBackup(db);
    expect(JSON.parse(raw)).not.toHaveProperty('pendingCompletions');
    const target = await openDatabase(`target-${crypto.randomUUID()}`);
    await importBackup(target, raw);
    expect(await getPendingCompletions(target)).toEqual([]);
    expect(await getPendingCompletions(db)).toHaveLength(1);
    target.close();
  });

  it('rolls back the record and keeps the active session when summary persistence fails', async () => {
    await startStopwatch(db, category, start);
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'settings' && key === 'pendingCompletions') throw new DOMException('空间不足', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    await expect(settle(db, 'early', start + 60_000)).rejects.toThrow('空间不足');
    spy.mockRestore();
    expect(await getActive(db)).toBeDefined();
    expect(await getRecords(db)).toEqual([]);
    expect(await getPendingCompletions(db)).toEqual([]);
    expect((await settle(db, 'early', start + 60_000)).earned).toBe(1);
  });

  it('does not issue another summary when an identical record already exists', async () => {
    const active = await startStopwatch(db, category, start);
    const saved = await settle(db, 'early', start + 60_000);
    await acknowledgeCompletion(db, saved.record!.id);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('active', 'readwrite');
      tx.objectStore('active').put(active, 'only');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    const repeated = await settle(db, 'early', start + 60_000);
    expect(repeated.created).toBe(false);
    expect(repeated.earned).toBeUndefined();
    expect(await getPendingCompletions(db)).toEqual([]);
    expect(progress(await getRecords(db)).experience).toBe(1);
  });
});
