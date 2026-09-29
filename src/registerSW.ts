export function registerServiceWorker(): void {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg: ServiceWorkerRegistration) => {
          console.log('SW registered:', reg.scope);
        })
        .catch((err: Error) => {
          console.warn('SW registration failed:', err);
        });
    });
  }
}