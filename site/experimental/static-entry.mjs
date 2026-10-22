import { parseInvitation } from '../connection.mjs';
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('host-mode').textContent = 'PEAK EN EL NAVEGADOR';
  document.getElementById('host-mode-note').textContent = 'El juego carga desde la web. Para jugar con amigos, abre el enlace de su partida.';
  const form = document.createElement('form');
  form.id = 'static-host-invite';
  form.innerHTML = '<label class="host-field" for="static-invite">Enlace de una partida</label><input id="static-invite" type="url" inputmode="url" placeholder="https://…" autocomplete="off" spellcheck="false" required><button type="submit" class="primary">Entrar al host</button><p id="static-invite-error" class="host-error" role="alert"></p>';
  document.getElementById('host-form').before(form);
  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      const allowLocal = location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
      const target = parseInvitation(document.getElementById('static-invite').value, '', allowLocal);
      const page = new URL('./', location.href);
      const fields = { server: target.server };
      if (target.room) fields.room = target.room;
      page.hash = new URLSearchParams(fields).toString();
      window.parent.location.assign(page.href);
    } catch (error) { document.getElementById('static-invite-error').textContent = error.message; }
  });
});
