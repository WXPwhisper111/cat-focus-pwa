// @vitest-environment jsdom
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps the timer and navigation available when the task store cannot be read', async () => {
  mockDialogs(); vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', class { onmessage=null; postMessage(){} close(){} });
  vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never);
  const original = IDBObjectStore.prototype.getAll;
  vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function(this:IDBObjectStore, ...args:Parameters<IDBObjectStore['getAll']>){
    if (this.name === 'focusTasks') throw Error('任务存储不可用');
    return original.apply(this, args);
  });
  document.body.innerHTML='<div id="app"></div>'; await import('../src/main');
  await vi.waitFor(() => expect(document.querySelector('#start')).not.toBeNull());
  expect(document.body.textContent).toContain('无法读取专注清单：任务存储不可用');
  expect(document.querySelector('#app')!.textContent).toContain('统计');
  document.querySelector<HTMLButtonElement>('#welcome-close')?.click();
  document.querySelector<HTMLButtonElement>('#start')!.click();
  await vi.waitFor(() => expect(document.querySelector('#pause')).not.toBeNull());
});
