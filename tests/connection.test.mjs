import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvitation, gameUrl } from '../site/connection.mjs';

test('each invitation selects its own host without a shared default', () => {
  const first = parseInvitation('https://xxrochetxx.github.io/peak-online/#server=https%3A%2F%2Fhost-one.trycloudflare.com&room=ABC234');
  const second = parseInvitation('https://xxrochetxx.github.io/peak-online/#server=https%3A%2F%2Fhost-two.trycloudflare.com&room=ABC234');
  assert.equal(first.server, 'https://host-one.trycloudflare.com');
  assert.equal(second.server, 'https://host-two.trycloudflare.com');
  assert.equal(first.room, 'ABC234');
  assert.notEqual(first.server, second.server);
});
test('direct server invitations and manually entered room codes work', () => {
  assert.deepEqual(parseInvitation('https://my-host.example/host.html#room=DEF789'), {server:'https://my-host.example',room:'DEF789'});
  assert.deepEqual(parseInvitation('https://my-host.example/', 'abc234'), {server:'https://my-host.example',room:'ABC234'});
});
test('bad addresses, embedded credentials and invalid codes cannot load a game frame', () => {
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,test', 'https://user:secret@host.example', 'http://192.168.0.1', 'https://page.example/#server=javascript%3Aalert(1)']) {
    assert.throws(() => parseInvitation(url));
  }
  for (const room of ['ABCDE', 'ABC1234', 'ABCO01', '<img>']) assert.throws(() => parseInvitation('https://host.example', room));
});
test('HTTP is only accepted for loopback preview, not from a published HTTPS page', () => {
  assert.throws(() => parseInvitation('http://127.0.0.1:8778'));
  assert.equal(parseInvitation('http://127.0.0.1:8778', '', true).server, 'http://127.0.0.1:8778');
  assert.throws(() => parseInvitation('http://192.168.0.2:8778', '', true));
});
test('game entry preserves host and room and passes a clean return launcher', () => {
  const url = gameUrl({server:'https://my-host.example',room:'ABC234'}, 'https://pages.example/peak-online/?ignored=1#server=anything');
  assert.equal(url.origin, 'https://my-host.example');
  assert.equal(url.pathname, '/host.html');
  assert.equal(url.hash, '#room=ABC234');
  assert.equal(url.searchParams.get('launcher'), 'https://pages.example/peak-online/');
});
