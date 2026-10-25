import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { captureSnapshot, canonicalJson, snapshotSummary, verifySnapshot } from '../src/data-protection/snapshot';
import { assertSafeActivation, assertSharedPurchaseAvailable, validateOwnership } from '../src/data-protection/policy';
import { request, startStopwatch, transact } from '../src/storage';
import { protectionFixture } from './data-protection-fixture';

let db: IDBDatabase;
beforeEach(async () => { vi.stubGlobal('indexedDB', new IDBFactory()); db = await protectionFixture('snapshot-spec'); });
afterEach(() => { db?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('captures every store and necessary business state without altering source data', async () => {
  const a = await captureSnapshot(db), b = await captureSnapshot(db);
  expect(a.contentHash).toBe(b.contentHash); expect((await verifySnapshot(JSON.parse(JSON.stringify(a)))).data).toEqual(a.data);
  expect(Object.keys(a.data)).toEqual(Array.from(db.objectStoreNames));
  expect(snapshotSummary(a)).toMatchObject({ records: 1, tasks: 1, cats: 3, furniture: 5, checkins: 14, active: false });
  const settings = Object.fromEntries(a.data.settings.map(row => [row.key, row.value]));
  expect(settings).toMatchObject({ roomLocations: { 'orange-white': 'bed-0' }, timerMode: 'stopwatch', backupPreferences: { enabled: false } });
  expect(settings.pendingCompletions).toHaveLength(1);
  expect(a.data.coinReceipts).toHaveLength(1);
  expect(settings['catExpansion-v2']).toMatchObject({ claimed: { catId: 'cat-04' } });
});

it('preserves active-session bytes in a snapshot but refuses activating such a migration', async () => {
  const active = await startStopwatch(db, 'builtin-english', 2_000_000);
  const snapshot = await captureSnapshot(db);
  expect(snapshot.data.active[0].value).toEqual(active);
  expect(() => assertSafeActivation({ phase: 'verified', sourceMatches: true, targetMatches: true, pointerUnchanged: true, hasActiveSession: true })).toThrow('活动专注');
});

it('rejects corrupt checksums, broken economic links and unknown settings without repairing data', async () => {
  const snapshot = await captureSnapshot(db), corrupt = structuredClone(snapshot);
  corrupt.data.focusTasks[0].value = { ...(corrupt.data.focusTasks[0].value as object), title: '被改过的标题' };
  await expect(verifySnapshot(corrupt)).rejects.toThrow('校验失败');
  await transact(db, ['wallet'], 'readwrite', async tx => {
    const wallet = await request<Record<string, number>>(tx.objectStore('wallet').get('only'));
    wallet.balance++; tx.objectStore('wallet').put(wallet, 'only');
  });
  await expect(captureSnapshot(db)).rejects.toThrow('钱包');
  expect((await request<Record<string, number>>(db.transaction('wallet').objectStore('wallet').get('only'))).balance).not.toBe(snapshotSummary(snapshot).balance);
});

it('refuses unknown fields rather than omitting them in a purported full backup', async () => {
  await transact(db, ['settings'], 'readwrite', async tx => { tx.objectStore('settings').put('do-not-copy', 'unknown-key'); });
  await expect(captureSnapshot(db)).rejects.toThrow('未知 settings');
  expect(() => canonicalJson({ unsupported: undefined })).toThrow('不支持');
  expect(() => canonicalJson(new Date())).toThrow('不支持');
  expect(() => canonicalJson(new Array(1))).toThrow('稀疏数组');
  expect(() => canonicalJson(-0)).toThrow('不支持');
});

it.each([
  { phase: 'copied' as const, sourceMatches: true, targetMatches: true, pointerUnchanged: true, hasActiveSession: false },
  { phase: 'verified' as const, sourceMatches: false, targetMatches: true, pointerUnchanged: true, hasActiveSession: false },
  { phase: 'verified' as const, sourceMatches: true, targetMatches: false, pointerUnchanged: true, hasActiveSession: false },
  { phase: 'verified' as const, sourceMatches: true, targetMatches: true, pointerUnchanged: false, hasActiveSession: false },
])('fails closed for unsafe activation: $phase / $sourceMatches / $targetMatches / $pointerUnchanged', input => {
  expect(() => assertSafeActivation(input)).toThrow();
});

it('requires explicit ownership/economic baseline/backup and keeps shared purchases disabled', () => {
  expect(() => validateOwnership({} as never, 'owner', 'hash')).toThrow('明确确认');
  expect(() => assertSharedPurchaseAvailable(false)).toThrow('联网');
  expect(() => assertSharedPurchaseAvailable(true)).toThrow('尚未接入');
});
