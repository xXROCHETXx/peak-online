import { parseInvitation, gameUrl } from './connection.mjs';
const frame = document.getElementById('peak-game');
const status = document.getElementById('boot-status');
const error = document.getElementById('entry-error');
const allowLocal = location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
try {
  const fields = new URLSearchParams(location.hash.slice(1));
  const target = fields.has('server')
    ? gameUrl(parseInvitation(location.href, '', allowLocal), new URL('./index.html', location.href))
    : new URL('./game.html', location.href);
  frame.addEventListener('load', () => { status.hidden = true; });
  frame.src = target.href;
} catch (failure) {
  status.hidden = true; frame.hidden = true; error.hidden = false;
  document.getElementById('entry-message').textContent = failure.message;
}
