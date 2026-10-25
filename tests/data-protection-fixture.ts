import { addFocusTask, selectFocusTask } from '../src/focus-task-storage';
import { adoptInitialCat, checkinToday, claimExpansionCat, openDatabase, purchaseProduct, renameCat, saveRoomLocations, selectTimerMode, settle, startStopwatch, transact } from '../src/storage';

export async function protectionFixture(name: string) {
  const db = await openDatabase(name);
  await adoptInitialCat(db, 'orange-white');
  const task = await addFocusTask(db, '受保护的任务', 1000);
  await selectFocusTask(db, task.id);
  await startStopwatch(db, 'builtin-english', 2000); await settle(db, 'early', 1_802_000);
  for (let day = 1; day <= 14; day++) await checkinToday(db, new Date(2026, 0, day, 12).getTime());
  await purchaseProduct(db, 'cat-cat-02', 1_900_000); await purchaseProduct(db, 'advanced-bed', 1_900_001);
  // Simulate a pre-expansion user's legitimate entitlement, in a disposable database only.
  await transact(db, ['settings'], 'readwrite', async tx => {
    tx.objectStore('settings').put({ version: 1, eligible: true, claimed: null }, 'catExpansion-v2');
    tx.objectStore('settings').put({ firstAt: 1000, lastExportAt: 2000, enabled: false }, 'backupPreferences');
  });
  await claimExpansionCat(db, 'cat-04', 1_900_002);
  await renameCat(db, 'orange-white', '小橘');
  await saveRoomLocations(db, { 'orange-white': 'bed-0' });
  await selectTimerMode(db, 'stopwatch');
  await selectFocusTask(db, task.id);
  return db;
}
