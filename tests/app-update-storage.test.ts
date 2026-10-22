// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { createAppUpdate } from '../src/app-update';
import { getActive, getRecords, getWallet, openDatabase, settle, startStopwatch, togglePause } from '../src/storage';
it('reads the latest shared database before refreshing and leaves rewards and records untouched', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const first = await openDatabase(), second = await openDatabase();
  const worker = Object.assign(new EventTarget(), { state: 'activated' });
  const registration = Object.assign(new EventTarget(), { active: worker, installing: null, waiting: null, update: async () => {} });
  const container = Object.assign(new EventTarget(), { controller: worker, register: async () => registration });
  const reload = vi.fn();
  const update = createAppUpdate({ enabled: true, container: container as unknown as ServiceWorkerContainer, entry: 'https://test/assets/a.js', hasActiveSession: async () => !!await getActive(first), canReload: () => true, reload,
    send: async () => ({ ok: true, version: 'b', entry: 'https://test/assets/b.js', media: { total: 0, cached: 0 } }),
  });
  await update.start(); await startStopwatch(second, 'builtin-english', 1000); await togglePause(second, 1100);
  const active = await getActive(first), wallet = await getWallet(first), records = await getRecords(first);
  await update.apply(); expect(reload).not.toHaveBeenCalled(); expect(await getActive(first)).toEqual(active); expect(await getWallet(first)).toEqual(wallet); expect(await getRecords(first)).toEqual(records);
  await settle(second, 'discard', 1200, active!.id); await update.apply(); expect(reload).toHaveBeenCalledOnce();
  update.destroy(); first.close(); second.close(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
