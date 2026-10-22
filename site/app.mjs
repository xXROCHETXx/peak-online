import { parseInvitation, gameUrl } from './connection.mjs';
const el = id => document.getElementById(id);
const allowLocal = location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
let activeUrl = null;
function showError(message) {
  el('join-error').textContent = message;
  el('invitation').setAttribute('aria-invalid', 'true');
  el('destination').hidden = true;
}
function connection() { return parseInvitation(el('invitation').value, el('room').value, allowLocal); }
function preview() {
  el('join-error').textContent = ''; el('invitation').removeAttribute('aria-invalid');
  try {
    const target = connection();
    el('destination').textContent = 'Host: ' + new URL(target.server).host + (target.room ? ' · Sala ' + target.room : '');
    el('destination').hidden = false;
  } catch { el('destination').hidden = true; }
}
if (new URLSearchParams(location.hash.slice(1)).has('server')) {
  el('invitation').value = location.href;
  try { el('room').value = parseInvitation(location.href, '', allowLocal).room; preview(); }
  catch (error) { showError(error.message); }
}
el('invitation').addEventListener('input', () => {
  // A newly pasted invitation supplies its own room code.
  el('room').value = ''; preview();
});
el('room').addEventListener('input', () => { el('room').value = el('room').value.toUpperCase(); preview(); });
el('join-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const target = connection(); activeUrl = gameUrl(target, location.href);
    const frame = document.createElement('iframe');
    frame.title = 'PEAK · ' + new URL(target.server).host;
    frame.allow = 'microphone; fullscreen; autoplay; clipboard-write';
    frame.allowFullscreen = true; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.src = activeUrl.href;
    frame.addEventListener('load', () => {
      // iframe load also fires for HTTP error pages; do not claim that the server is ready.
      el('frame-note').hidden = true;
    });
    el('frame-container').replaceChildren(frame);
    el('game-host').textContent = new URL(target.server).host + (target.room ? ' · ' + target.room : '');
    el('frame-note').hidden = false;
    el('launcher').hidden = true; el('game').hidden = false;
  } catch (error) { showError(error.message); el('invitation').focus(); }
});
el('return').addEventListener('click', () => {
  if (!confirm('¿Salir de la partida y volver al inicio?')) return;
  el('frame-container').replaceChildren(); activeUrl = null;
  el('game').hidden = true; el('launcher').hidden = false;
});
el('open-direct').addEventListener('click', () => {
  if (activeUrl) window.open(activeUrl.href, '_blank', 'noopener');
});
