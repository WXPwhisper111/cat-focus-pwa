export function mockDialogs() {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); },
  });
}
