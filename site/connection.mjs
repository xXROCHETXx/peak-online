export const roomPattern = /^[A-HJ-NP-Z2-9]{6}$/;
export function normalizeRoom(value = '') {
  const room = value.trim().toUpperCase();
  if (room && !roomPattern.test(room)) throw new Error('El código tiene 6 letras o números, sin I, O, 0 ni 1.');
  return room;
}
export function parseInvitation(value, room = '', allowLocal = false) {
  let candidate;
  try { candidate = new URL(value.trim()); } catch { throw new Error('Pega el enlace completo que te compartió el host.'); }
  if (!['http:', 'https:'].includes(candidate.protocol)) throw new Error('El enlace debe empezar por https://.');
  const fields = new URLSearchParams(candidate.hash.slice(1));
  let server;
  try { server = fields.has('server') ? new URL(fields.get('server')) : candidate; }
  catch { throw new Error('La invitación no contiene una dirección de host válida.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname);
  if (server.protocol !== 'https:' && !(allowLocal && local && server.protocol === 'http:')) {
    throw new Error('El host debe compartir su enlace HTTPS para que funcionen el juego y el micrófono.');
  }
  if (server.username || server.password) throw new Error('Usa una dirección sin usuario ni contraseña.');
  const selectedRoom = normalizeRoom(room || fields.get('room') || '');
  return { server: server.origin, room: selectedRoom };
}
export function gameUrl(connection, launcher) {
  const url = new URL('/host.html', connection.server);
  const parent = new URL(launcher); parent.hash = ''; parent.search = '';
  url.searchParams.set('launcher', parent.href);
  if (connection.room) url.hash = new URLSearchParams({ room: connection.room }).toString();
  return url;
}
