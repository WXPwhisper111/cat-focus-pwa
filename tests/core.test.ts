import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dueAt, endDate, localIso, makeRecord, mondayOf, parseBackup, progress, secondsIn, weeksInMonth, type ActiveSession, type FocusRecord } from '../src/domain';
import { DB_VERSION, exportBackup, getActive, getRecords, importBackup, openDatabase, settle, startSession, togglePause } from '../src/storage';
import { requestOptionalNotification } from '../src/notifications';

let db: IDBDatabase;
beforeEach(async () => { vi.stubEnv('TZ', 'Asia/Shanghai'); db = await openDatabase(`test-${crypto.randomUUID()}`); });
const backup = (records: FocusRecord[]) => JSON.stringify({ format: 'cat-focus-pwa', version: 1, records });
const at = (iso: string) => Date.parse(iso);

describe('timer and persistence', () => {
  it('pauses without counting idle time and resumes after reopening storage', async () => {
    const start = at('2026-10-19T10:00:00+08:00');
    await startSession(db, 'builtin-english', 25, start);
    await togglePause(db, start + 30_000);
    expect((await getActive(db))!.accumulatedMs).toBe(30_000);
    await togglePause(db, start + 3_630_000);
    db.close();
    db = await openDatabase(db.name);
    const active = (await getActive(db))!;
    expect(dueAt(active)).toBe(start + 3_630_000 + 1_470_000);
    expect(await settle(db, 'due', dueAt(active)! - 1)).toEqual({ record: null, created: false });
    expect((await settle(db, 'due', dueAt(active)! + 20_000)).record?.durationSeconds).toBe(1500);
  });

  it('settles once across concurrent tabs and uses the calculated due time', async () => {
    const start = at('2026-10-19T23:59:30+08:00');
    await startSession(db, 'builtin-computer', 1, start);
    const other = await openDatabase(db.name);
    const [a, b] = await Promise.all([settle(db, 'due', start + 86_400_000), settle(other, 'due', start + 86_400_000)]);
    expect(Number(a.created) + Number(b.created)).toBe(1);
    expect(await getRecords(db)).toHaveLength(1);
    expect(endDate((await getRecords(db))[0])).toBe('2026-10-20');
    expect((await getRecords(db))[0].endedAt).toBe(localIso(start + 60_000));
    other.close();
  });

  it('saves early time for rewards, while discard leaves no record', async () => {
    const start = at('2026-10-19T10:00:00+08:00');
    await startSession(db, 'builtin-english', 25, start);
    expect((await settle(db, 'early', start + 30_000)).record?.durationSeconds).toBe(30);
    await startSession(db, 'builtin-computer', 25, start + 31_000);
    await settle(db, 'early', start + 61_000);
    expect(progress(await getRecords(db)).experience).toBe(1);
    await startSession(db, 'builtin-english', 25, start + 62_000);
    await settle(db, 'discard', start + 122_000);
    expect(await getRecords(db)).toHaveLength(2);
  });

  it('does not discard a session that already reached its target', async () => {
    const start = at('2026-10-19T10:00:00+08:00');
    await startSession(db, 'builtin-english', 1, start);
    expect((await settle(db, 'discard', start + 61_000)).record?.completed).toBe(true);
  });
});

describe('calendar and backups', () => {
  it('starts weeks Monday, clips month edge weeks, and uses the end date', () => {
    expect(mondayOf(new Date(2026, 9, 25)).getDate()).toBe(19);
    const weeks = weeksInMonth(2026, 10);
    expect(weeks[0]).toEqual({ start: '2026-10-01', end: '2026-10-04' });
    expect(weeks.at(-1)).toEqual({ start: '2026-10-26', end: '2026-10-31' });
    const start = at('2026-10-31T23:59:30+08:00');
    const session: ActiveSession = { mode: 'countdown', id: 'test-session-1', categoryId: 'builtin-english', category: '英语', targetMinutes: 1, startedAt: start, accumulatedMs: 0, status: 'running', runSinceMs: start };
    const record = makeRecord(session, start + 90_000, true)!;
    expect(endDate(record)).toBe('2026-11-01');
    expect(secondsIn([record], '2026-10-01', '2026-10-31')).toBe(0);
  });

  it('imports duplicates idempotently and rejects conflicting or invalid backups atomically', async () => {
    const start = at('2026-10-19T10:00:00+08:00');
    await startSession(db, 'builtin-english', 1, start);
    await settle(db, 'due', start + 60_000);
    const record = (await getRecords(db))[0];
    expect(await importBackup(db, backup([record]))).toEqual({ added: 0, skipped: 1 });
    const conflict = { ...record, category: '计算机' as const };
    const another = { ...record, id: 'another-record-1' };
    await expect(importBackup(db, backup([another, conflict]))).rejects.toThrow('冲突');
    expect(await getRecords(db)).toHaveLength(1);
    await expect(importBackup(db, backup([{ ...record, durationSeconds: -1 }]))).rejects.toThrow('无效');
    await expect(importBackup(db, backup([record, conflict]))).rejects.toThrow('冲突');
    expect(parseBackup(await exportBackup(db)).records).toHaveLength(1);
  });

  it('exposes a versioned IndexedDB schema and backup format', async () => {
    expect(DB_VERSION).toBe(6);
    expect(Array.from(db.objectStoreNames)).toEqual(['active', 'categories', 'coinReceipts', 'focusTasks', 'records', 'settings', 'wallet', 'walletTransactions']);
    expect(JSON.parse(await exportBackup(db)).version).toBe(10);
  });

  it('upgrades a version 1 database without losing its records', async () => {
    const name = `old-${crypto.randomUUID()}`;
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('active'); req.result.createObjectStore('records', { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    old.close();
    const upgraded = await openDatabase(name);
    expect(upgraded.version).toBe(6);
    expect(Array.from(upgraded.objectStoreNames)).toEqual(['active', 'categories', 'coinReceipts', 'focusTasks', 'records', 'settings', 'wallet', 'walletTransactions']);
    upgraded.close();
  });

  it('keeps notification permission optional when denied', async () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('window', { Notification: { requestPermission: vi.fn().mockResolvedValue('denied') } });
    vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('denied') });
    expect(await requestOptionalNotification()).toBe('denied');
    const start = at('2026-10-19T10:00:00+08:00');
    await startSession(db, 'builtin-english', 1, start);
    expect((await settle(db, 'due', start + 60_000)).created).toBe(true);
    vi.unstubAllGlobals();
  });
});

