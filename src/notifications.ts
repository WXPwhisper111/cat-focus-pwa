export async function requestOptionalNotification(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!isSecureContext || !('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission() === 'granted' ? 'granted' : 'denied';
  } catch { return 'denied'; }
}

export function notifyCompletion() {
  if (document.visibilityState !== 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification('专注完成', { body: '猫咪陪你完成了一次专注。' }); } catch { /* In-page notice remains. */ }
}
