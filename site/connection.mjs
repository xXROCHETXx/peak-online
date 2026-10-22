export const roomPattern = /^[A-HJ-NP-Z2-9]{6}$/;
export function normalizeRoom(value = '') {
  const room = value.trim().toUpperCase();
  if (room && !roomPattern.test(room)) throw new Error('Room codes have 6 letters and numbers, without I, O, 0 or 1.');
  return room;
}
export function parseInvitation(value, room = '', allowLocal = false) {
  let candidate;
  try { candidate = new URL(value.trim()); } catch { throw new Error('Paste the full invite link from the host.'); }
  if (!['http:', 'https:'].includes(candidate.protocol)) throw new Error('The link must start with https://.');
  const fields = new URLSearchParams(candidate.hash.slice(1));
  let server;
  try { server = fields.has('server') ? new URL(fields.get('server')) : candidate; }
  catch { throw new Error('The invite does not contain a valid host address.'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname);
  if (server.protocol !== 'https:' && !(allowLocal && local && server.protocol === 'http:')) {
    throw new Error('The host must share an HTTPS link for the game and microphone.');
  }
  if (server.username || server.password) throw new Error('Use an address without a username or password.');
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
