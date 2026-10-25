import {
  addFocusTask, changeFocusTask, completeSummaryTask, getFocusTaskState, getFocusTasks, selectFocusTask,
} from './focus-task-storage';

// Keep the storage contracts (including optional clocks and optimistic versions)
// without duplicating their types or changing their transaction ownership.
type WithoutDatabase<T> = T extends (db: IDBDatabase, ...args: infer Args) => infer Result
  ? (...args: Args) => Result : never;

export interface FocusTaskRepository {
  list: WithoutDatabase<typeof getFocusTasks>;
  add: WithoutDatabase<typeof addFocusTask>;
  change: WithoutDatabase<typeof changeFocusTask>;
  getState: WithoutDatabase<typeof getFocusTaskState>;
  select: WithoutDatabase<typeof selectFocusTask>;
  completeSummary: WithoutDatabase<typeof completeSummaryTask>;
}

// First slice only. Other domains continue to use the existing storage APIs.
export interface LocalRepository {
  readonly focusTasks: FocusTaskRepository;
}

// The caller owns opening/closing db. Creating an adapter performs no I/O.
export function createLocalRepository(db: IDBDatabase): LocalRepository {
  return {
    focusTasks: {
      list: () => getFocusTasks(db),
      add: (...args) => addFocusTask(db, ...args),
      change: (...args) => changeFocusTask(db, ...args),
      getState: () => getFocusTaskState(db),
      select: (...args) => selectFocusTask(db, ...args),
      completeSummary: (...args) => completeSummaryTask(db, ...args),
    },
  };
}
