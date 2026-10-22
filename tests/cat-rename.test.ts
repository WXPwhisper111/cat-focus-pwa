// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { openCatRename } from '../src/cat-rename';
import { catDefinitions } from '../src/cat-definition';
import { mockDialogs } from './dialog-mocks';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it('validates and safely renders names, reports save failures and prevents duplicate saves', async () => {
  mockDialogs(); const save = vi.fn().mockRejectedValueOnce(Error('存储失败')).mockResolvedValueOnce(undefined);
  const dialog = openCatRename(catDefinitions[0], save), input = dialog.querySelector('input')!;
  input.value = ' '.repeat(3); dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); expect(save).not.toHaveBeenCalled();
  input.value = '<b>小布</b>'; dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(dialog.querySelector('[role=alert]')!.textContent).toBe('存储失败'));
  expect(dialog.querySelector('b')).toBeNull();
  dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(dialog.isConnected).toBe(false)); expect(save).toHaveBeenCalledTimes(2);
});
