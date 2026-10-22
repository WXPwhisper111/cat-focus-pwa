// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createFocusEnding, focusDuration } from '../src/focus-ending';
import type { ActiveSession, FocusRecord } from '../src/domain';
import { mockDialogs } from './dialog-mocks';

it('keeps failed operations retryable and acknowledges queued summaries without losing the next one', async () => {
  mockDialogs();
  document.body.innerHTML = '<button id="early">提前结束</button><button id="start">开始</button>';
  const active: ActiveSession = { mode: 'countdown', targetMinutes: 1, id: 'ending-test-session', categoryId: 'builtin-english',
    category: '<阅读>', startedAt: 0, accumulatedMs: 30_000, status: 'paused', runSinceMs: null };
  const record: FocusRecord = { mode: 'countdown', targetMinutes: 1, id: active.id, categoryId: active.categoryId,
    category: active.category, startedAt: '2026-10-19T10:00:00.000+08:00', endedAt: '2026-10-19T10:00:30.000+08:00', completed: false, durationSeconds: 30 };
  const first = { record, earned: 1, settledAt: 1 };
  const second = { record: { ...record, id: 'ending-test-second', category: '数学' }, earned: 0, settledAt: 2 };
  const onConfirm = vi.fn().mockRejectedValueOnce(Error('空间不足')).mockImplementationOnce(async () => { ui.update(undefined, [first, second], 1); });
  const onAck = vi.fn().mockRejectedValueOnce(Error('暂时不可用'))
    .mockImplementationOnce(async () => { ui.update(undefined, [second], 2); })
    .mockImplementationOnce(async () => { ui.update(undefined, [], 3); });
  const ui = createFocusEnding(onConfirm, onAck);
  const confirmation = document.querySelector<HTMLDialogElement>('.end-confirmation')!;
  const summary = document.querySelector<HTMLDialogElement>('.completion-summary')!;
  const confirm = document.querySelector<HTMLButtonElement>('#end-confirm')!;
  const done = document.querySelector<HTMLButtonElement>('#summary-done')!;
  ui.confirm('early', active, 1);
  expect(document.querySelector('#end-category')!.textContent).toBe('<阅读>');
  expect(document.querySelector('阅读')).toBeNull();
  confirm.click(); confirm.click();
  await vi.waitFor(() => expect(confirm.disabled).toBe(false));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(confirmation.open).toBe(true);
  expect(confirmation.querySelector('.ending-error')!.textContent).toContain('空间不足');
  confirm.click();
  await vi.waitFor(() => expect(summary.open).toBe(true));
  expect(document.querySelector('#summary-reward-note')!.textContent).toContain('此前累计');
  const escape = new Event('cancel', { cancelable: true }); summary.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(done.disabled).toBe(false));
  expect(summary.open).toBe(true);
  expect(summary.querySelector('.ending-error')!.textContent).toContain('暂时不可用');
  done.click();
  await vi.waitFor(() => expect(document.querySelector('#summary-category')!.textContent).toBe('数学'));
  expect(summary.open).toBe(true);
  done.click();
  await vi.waitFor(() => expect(summary.open).toBe(false));
  expect(onAck.mock.calls.map(call => call[0])).toEqual([first.record.id, first.record.id, second.record.id]);
  expect(focusDuration(.25)).toBe('不足 1 秒');
  expect(focusDuration(3661)).toBe('1 小时 1 分钟 1 秒');
  ui.destroy();
});
