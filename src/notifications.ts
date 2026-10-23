export async function requestOptionalNotification(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!globalThis.isSecureContext || !('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission() === 'granted' ? 'granted' : 'denied';
  } catch { return 'denied'; }
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('通知服务响应超时')), 5000); })]); }
  finally { clearTimeout(timer); }
}
export type NotificationResult = 'sent' | 'denied' | 'unsupported' | 'failed';
export async function notifyCompletion(sessionId = 'test'): Promise<NotificationResult> {
  if (!globalThis.isSecureContext || !('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'granted') return 'denied';
  const options = { body: '猫咪陪你完成了一次专注。', tag: `focus-${sessionId}`, data: { url: './' } };
  try {
    const registration = await bounded(Promise.resolve(navigator.serviceWorker?.getRegistration()));
    if (registration?.active && registration.showNotification) {
      await bounded(registration.showNotification('专注完成', options)); return 'sent';
    }
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) return 'unsupported';
    new Notification('专注完成', options); return 'sent';
  } catch { return 'failed'; }
}
