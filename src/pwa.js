// App-Modus: Service Worker für die Offline-Nutzung registrieren (nur im statischen Build eingebunden).
// Ohne Service Worker (z. B. privater Modus) bleibt die App normal nutzbar, nur eben nicht offline.
// Nach einem Update übernimmt der neue Service Worker sofort; die offene Seite bietet dann das Neuladen an,
// statt mitten in einer Lektion selbst neu zu laden.
// In der Desktop-App (src-tauri) liegt ohnehin alles auf dem Gerät – dort kein Service Worker, der Updates aufhalten könnte.
const desktop = location.protocol === 'tauri:' || location.hostname === 'tauri.localhost';
if ('serviceWorker' in navigator && !desktop) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || document.getElementById('update-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'update-banner';
    bar.className = 'update-banner';
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.textContent = 'Eine neue Version von Wortweg ist da.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-primary btn-small';
    button.textContent = 'Neu laden';
    button.addEventListener('click', () => location.reload());
    bar.append(text, button);
    document.body.append(bar);
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
