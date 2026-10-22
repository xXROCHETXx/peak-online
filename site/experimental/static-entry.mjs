document.addEventListener('DOMContentLoaded', () => {
  const el = id => document.getElementById(id);
  el('host-mode').textContent = 'PRIVATE ROOMS';
  el('host-mode-note').textContent = 'Create a room and share its six-character code. Keep the host tab open while playing.';
  el('host-create').textContent = 'Create room';
  el('host-join').textContent = 'Join room';
  const randomize = document.createElement('button');
  randomize.id = 'host-randomize-name'; randomize.type = 'button'; randomize.className = 'host-secondary';
  randomize.textContent = 'Randomize name'; randomize.setAttribute('aria-label', 'Generate another player name');
  el('host-nickname').after(randomize);
  randomize.onclick = () => { if (!el('host-nickname').disabled) { el('host-nickname').value = window.PeakNames.generate(); el('host-nickname').focus(); } };
  el('host-copy').onclick = async () => {
    const room = el('host-room-code').textContent.trim();
    if (!window.PeakRooms.validCode(room)) return;
    const page = new URL('./index.html', location.href);
    page.hash = new URLSearchParams({ room }).toString();
    try { await navigator.clipboard.writeText(page.href); el('host-copy-fallback').hidden = true; el('host-notice').textContent = 'Invite link copied.'; }
    catch {
      el('host-copy-fallback').hidden = false; el('host-copy-text').value = page.href; el('host-copy-text').focus(); el('host-copy-text').select();
      el('host-notice').textContent = 'Copy the selected invite link.';
    }
  };
});
window.addEventListener('pagehide', () => window.peakBrowserTransport?.close());
