// Loaded after host.js. Retain the working game connection, sharing the Pages entry instead.
document.addEventListener('DOMContentLoaded', () => {
  const raw = new URLSearchParams(location.search).get('launcher');
  if (!raw) return;
  let launcher;
  try {
    launcher = new URL(raw);
    const local = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(launcher.hostname);
    if (launcher.protocol !== 'https:' && !(local && launcher.protocol === 'http:')) return;
    if (launcher.username || launcher.password) return;
    launcher.hash = ''; launcher.search = '';
  } catch { return; }
  const button = document.getElementById('host-copy');
  if (!button) return;
  button.onclick = async () => {
    const code = document.getElementById('host-room-code').textContent.trim();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return;
    const invite = new URL(launcher.href);
    invite.hash = new URLSearchParams({ server: location.origin, room: code }).toString();
    const notice = document.getElementById('host-notice');
    try {
      await navigator.clipboard.writeText(invite.href);
      document.getElementById('host-copy-fallback').hidden = true;
      notice.textContent = 'Enlace copiado. Incluye tu host y el codigo de sala.';
    } catch {
      document.getElementById('host-copy-fallback').hidden = false;
      const input = document.getElementById('host-copy-text');
      input.value = invite.href; input.focus(); input.select();
      notice.textContent = 'Copia el enlace seleccionado para invitar a tus amigos.';
    }
  };
});
