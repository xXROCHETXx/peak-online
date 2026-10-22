/* SPDX-License-Identifier: GPL-3.0-only
 * Browser adaptation of Segually/photon-server (1e7cf407), including the local
 * PEAK room/voice fixes. See THIRD-PARTY.md and licenses/photon-server.txt.
 * Only the host tab runs this broker; packet data is preserved byte for byte.
 */
(function (root) {
  'use strict';
  class Atom {
    constructor(type, value, raw) { Object.assign(this, { type, value, raw }); }
  }
  const unwrap = value => value instanceof Atom ? value.value : value;
  const byte = value => new Atom(3, value);
  const ints = value => new Atom(0x49, value);
  const map = value => unwrap(value) instanceof Map ? unwrap(value) : new Map();
  const get = (table, key, fallback = null) => {
    for (const [k, value] of table) if (unwrap(k) === key) return value;
    return fallback;
  };
  function put(table, key, value) {
    for (const k of table.keys()) if (unwrap(k) === unwrap(key)) { table.delete(k); break; }
    table.set(key, value);
  }
  const number = value => Number(unwrap(value) ?? 0);
  const text = value => String(unwrap(value) ?? '');
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  class Reader {
    constructor(bytes) { this.b = bytes; this.p = 0; this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
    take(n) {
      if (!Number.isSafeInteger(n) || n < 0 || this.p + n > this.b.length) throw new Error('Truncated Photon packet');
      const result = this.b.subarray(this.p, this.p + n); this.p += n; return result;
    }
    u8() { return this.take(1)[0]; }
    uint() {
      let result = 0n;
      for (let shift = 0n; shift < 70n; shift += 7n) {
        const b = this.u8(); result |= BigInt(b & 127) << shift;
        if (!(b & 128)) return result;
      }
      throw new Error('Invalid Photon integer');
    }
    count() { const n = Number(this.uint()); if (n > 2000000) throw new Error('Oversized Photon value'); return n; }
    zig(long = false) { const n = this.uint(), value = (n >> 1n) ^ -(n & 1n); return long ? value : Number(value); }
    fixed(method, size) { this.take(size); return this.view[method](this.p - size, true); }
    string() { return decoder.decode(this.take(this.count())); }
    value(depth = 0, fixedType) {
      if (depth > 40) throw new Error('Photon nesting limit');
      const start = this.p, type = fixedType ?? this.u8();
      let value;
      const list = callback => Array.from({ length: this.count() }, callback);
      if (type >= 128 && type < 229) { this.take(this.count()); value = null; }
      else switch (type) {
        case 8: value = null; break;
        case 2: value = !!this.u8(); break;
        case 27: value = false; break;
        case 28: value = true; break;
        case 3: value = this.u8(); break;
        case 34: case 29: case 30: case 31: case 32: case 33: value = 0; break;
        case 4: value = this.fixed('getInt16', 2); break;
        case 5: value = this.fixed('getFloat32', 4); break;
        case 6: value = this.fixed('getFloat64', 8); break;
        case 7: value = this.string(); break;
        case 9: value = this.zig(); break;
        case 10: value = this.zig(true); break;
        case 11: case 15: value = this.u8(); break;
        case 12: case 16: value = -this.u8(); break;
        case 13: case 17: value = this.fixed('getUint16', 2); break;
        case 14: case 18: value = -this.fixed('getUint16', 2); break;
        case 19: this.u8(); value = this.take(this.count()); break;
        case 0x43: value = this.take(this.count()); break;
        case 0x15: {
          value = new Map();
          for (let i = this.count(); i > 0; i--) value.set(this.value(depth + 1), this.value(depth + 1));
          break;
        }
        case 0x14: {
          const kt = this.u8(), vt = this.u8(); value = new Map();
          for (let i = this.count(); i > 0; i--) value.set(this.value(depth + 1, kt || undefined), this.value(depth + 1, vt || undefined));
          break;
        }
        case 0x17: value = list(() => this.value(depth + 1)); break;
        case 0x49: value = list(() => this.zig()); break;
        case 0x4a: value = list(() => this.zig(true)); break;
        case 0x47: value = list(() => this.string()); break;
        case 0x44: value = list(() => this.fixed('getInt16', 2)); break;
        case 0x45: value = list(() => this.fixed('getFloat32', 4)); break;
        case 0x46: value = list(() => this.fixed('getFloat64', 8)); break;
        case 0x42: {
          const n = this.count(), bits = this.take(Math.ceil(n / 8));
          value = Array.from({ length: n }, (_, i) => !!(bits[i >> 3] & (1 << (i & 7)))); break;
        }
        default: throw new Error('Unsupported Photon type 0x' + type.toString(16));
      }
      return new Atom(type, value, fixedType === undefined ? this.b.subarray(start, this.p) : undefined);
    }
  }
  class Writer {
    constructor() { this.parts = []; }
    bytes(bytes) { this.parts.push(bytes); }
    u8(...bytes) { this.bytes(Uint8Array.from(bytes)); }
    uint(value) {
      let n = BigInt(value);
      while (n >= 128n) { this.u8(Number(n & 127n) | 128); n >>= 7n; }
      this.u8(Number(n));
    }
    zig(value) { const n = BigInt(value); this.uint(n >= 0n ? n * 2n : -n * 2n - 1n); }
    string(value) { const b = encoder.encode(value); this.uint(b.length); this.bytes(b); }
    value(input) {
      if (input instanceof Atom && input.raw) { this.bytes(input.raw); return; }
      const v = unwrap(input), t = input instanceof Atom ? input.type : null;
      if (t === 3) { this.u8(3, v); return; }
      if (t === 0x49) { this.u8(0x49); this.uint(v.length); for (const n of v) this.zig(n); return; }
      if (v === null || v === undefined) this.u8(8);
      else if (typeof v === 'boolean') this.u8(v ? 28 : 27);
      else if (typeof v === 'string') { this.u8(7); this.string(v); }
      else if (typeof v === 'bigint' || Number.isInteger(v)) { this.u8(typeof v === 'bigint' ? 10 : 9); this.zig(v); }
      else if (typeof v === 'number') {
        const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.u8(6); this.bytes(b);
      } else if (v instanceof Uint8Array) { this.u8(0x43); this.uint(v.length); this.bytes(v); }
      else if (v instanceof Map) {
        this.u8(0x15); this.uint(v.size);
        for (const [key, value] of v) { this.value(key); this.value(value); }
      } else if (Array.isArray(v)) { this.u8(0x17); this.uint(v.length); for (const value of v) this.value(value); }
      else throw new Error('Unsupported outgoing Photon value');
    }
    result() {
      const result = new Uint8Array(this.parts.reduce((n, b) => n + b.length, 0));
      let offset = 0; for (const b of this.parts) { result.set(b, offset); offset += b.length; } return result;
    }
  }
  function packet(type, code, params = new Map(), returnCode = 0, debug = null) {
    const w = new Writer(); w.u8(243, type, code);
    if (type === 3 || type === 7) { w.u8(returnCode & 255, (returnCode >> 8) & 255); w.value(debug); }
    w.u8(params.size); for (const [key, value] of params) { w.u8(key); w.value(value); } return w.result();
  }
  function parse(bytes) {
    const r = new Reader(bytes);
    if (r.u8() !== 243) throw new Error('Invalid Photon message');
    const type = r.u8(); if (type & 128) throw new Error('Unexpected application encryption over WebRTC');
    const code = r.u8(), params = new Map(); let returnCode = 0;
    if (type === 3 || type === 7) { returnCode = r.fixed('getInt16', 2); r.value(); }
    for (let i = r.u8(); i > 0; i--) params.set(r.u8(), r.value());
    if (r.p !== bytes.length) throw new Error('Trailing Photon bytes');
    return { type, code, params, returnCode };
  }
  const params = (...entries) => new Map(entries);
  class RoomBroker {
    constructor({ address = 'localhost:443/relay/game', randomId = () => crypto.randomUUID() } = {}) {
      this.address = address; this.randomId = randomId; this.sessions = new Map(); this.rooms = new Map(); this.peers = new Set();
    }
    open(owner, send) {
      if ([...this.peers].filter(p => p.owner === owner).length >= 16) throw new Error('Too many game connections');
      const peer = { owner, send, userId: owner, room: null, actor: 0, game: false, closed: false };
      this.peers.add(peer); send(Uint8Array.of(243, 1, 0)); return peer;
    }
    receive(peer, bytes) {
      if (peer.closed || !this.peers.has(peer)) return;
      if (!(bytes instanceof Uint8Array) || bytes.length > 2097152) throw new Error('Invalid or oversized game packet');
      if (bytes[0] === 240 && bytes.length === 5) {
        const pong = new Uint8Array(9); pong[0] = 240;
        new DataView(pong.buffer).setUint32(1, Date.now() >>> 0); pong.set(bytes.subarray(1), 5); peer.send(pong); return;
      }
      if (bytes[0] === 243 && bytes[1] === 0) { peer.send(Uint8Array.of(243, 1, 0)); return; }
      const message = parse(bytes), p = message.params, code = message.code;
      const response = (ret = 0, fields = new Map(), debug = null) => peer.send(packet(3, code, fields, ret, debug));
      if (message.type === 6) {
        if (code !== 1) throw new Error('WebRTC game transport requires the WSS Photon mode');
        const fields = params([2, Date.now() | 0]); if (p.has(1)) fields.set(1, p.get(1));
        peer.send(packet(7, 1, fields)); return;
      }
      if (message.type !== 2) return;
      if (code === 230) {
        const token = text(p.get(221)), session = this.sessions.get(token);
        if (session && session.owner !== peer.owner) { response(32755, new Map(), 'Invalid session'); return; }
        if (session?.pending) { Object.assign(peer, { token, userId: session.userId, game: true, pending: session.pending, create: session.create }); }
        else {
          peer.token = this.randomId(); peer.userId = text(p.get(225)) || peer.owner;
          this.sessions.set(peer.token, { owner: peer.owner, userId: peer.userId });
        }
        peer.authenticated = true; response(0, params([221, peer.token], [225, peer.userId])); return;
      }
      if (!peer.authenticated) { response(32755, new Map(), 'Authenticate first'); return; }
      if (code === 229) { response(); peer.send(packet(4, 230, params([222, new Map()]))); return; }
      if (code === 228 || code === 248) { response(); return; }
      if (code === 227 || code === 226) {
        const name = text(p.get(255)) || peer.pending;
        const create = code === 227 || number(p.get(215)) === 1 || peer.create;
        if (!name || name.length > 128) { response(32758); return; }
        if (!peer.game) {
          Object.assign(this.sessions.get(peer.token), { pending: name, create });
          response(0, params([230, this.address], [221, peer.token], [255, name])); return;
        }
        let room = this.rooms.get(name);
        if (room && code === 227) { response(32766); return; }
        if (!room && !create) { response(32758); return; }
        if (!room) {
          if (this.rooms.size >= 4) { response(32760); return; }
          const props = new Map(map(p.get(248))), requested = number(get(props, 255));
          if (requested > 4) { response(32762); return; }
          const flags = number(p.get(191)) | (unwrap(p.get(239)) === true ? 8 : 0);
          room = { name, props, flags, max: requested > 0 ? requested : 4, next: 1, members: new Map(), cache: [], cacheBytes: 0, cleanup: p.has(191) ? !!(flags & 2) : true };
          put(props, byte(255), room.max); put(props, byte(253), unwrap(get(props, 253)) !== false); put(props, byte(254), unwrap(get(props, 254)) !== false);
          this.rooms.set(name, room);
        }
        if (unwrap(get(room.props, 253)) === false) { response(32764); return; }
        if (room.members.size >= room.max) { response(32765); return; }
        if (peer.room) this.leave(peer);
        peer.room = room; peer.actor = room.next++; peer.props = new Map(map(p.get(249))); room.members.set(peer.actor, peer);
        const actors = [...room.members.keys()], master = Math.min(...actors), allPlayers = new Map();
        for (const [id, member] of room.members) allPlayers.set(id, this.playerProps(room, member));
        const props = new Map(room.props); put(props, byte(248), master);
        response(0, params([254, peer.actor], [252, ints(actors)], [249, allPlayers], [248, props], [191, room.flags]));
        const joined = params([254, peer.actor], [252, ints(actors)], [249, this.playerProps(room, peer)]);
        if (!(room.flags & 4)) peer.send(packet(4, 255, joined));
        for (const event of room.cache) peer.send(packet(4, event.code, params([245, event.data], [254, event.sender])));
        this.broadcast(room, 255, joined, peer.actor); return;
      }
      const room = peer.room;
      if (code === 254) { response(); this.leave(peer); return; }
      if (!room) { response(32758); return; }
      if (code === 253) {
        const eventCode = number(p.get(244)), data = p.get(245), caching = number(p.get(247)), group = number(p.get(246));
        if (caching === 4 || caching === 5) {
          const size = data?.raw?.length || 0;
          if (room.cache.length >= 4096 || room.cacheBytes + size > 33554432) throw new Error('Room event cache limit');
          room.cache.push({ code: eventCode, data, sender: peer.actor, global: caching === 5, size }); room.cacheBytes += size;
        }
        if (caching === 6 || caching === 7) {
          const filter = map(data);
          room.cache = room.cache.filter(event => caching === 7 ? room.members.has(event.sender) || event.global
            : event.code !== eventCode || [...filter].some(([key, value]) => unwrap(get(map(event.data), unwrap(key))) !== unwrap(value)));
          room.cacheBytes = room.cache.reduce((n, e) => n + e.size, 0); return;
        }
        const fields = params([245, data], [254, peer.actor]);
        const explicit = unwrap(p.get(252));
        const targets = Array.isArray(explicit) ? explicit.map(number) : group === 2 ? [Math.min(...room.members.keys())] : [...room.members.keys()].filter(id => group === 1 || id !== peer.actor);
        for (const id of targets) room.members.get(id)?.send(packet(4, eventCode, fields));
        return;
      }
      if (code === 252) {
        const changed = map(p.get(251)), target = number(p.get(254)), member = room.members.get(target);
        const destination = target ? member?.props : room.props;
        if (!destination) { response(32758); return; }
        for (const [key, value] of changed) put(destination, key, value);
        response(); this.broadcast(room, 253, params([251, p.get(251)], [253, target], [254, peer.actor])); return;
      }
      if (code === 251) { response(0, params([248, room.props])); return; }
      response();
    }
    playerProps(room, peer) {
      const props = new Map(peer.props);
      for (const key of props.keys()) if (unwrap(key) === 253) props.delete(key);
      if (room.flags & 8) put(props, byte(253), peer.userId);
      return props;
    }
    broadcast(room, code, fields, except = 0) { for (const [id, peer] of room.members) if (id !== except) peer.send(packet(4, code, fields)); }
    leave(peer) {
      const room = peer.room; if (!room) return;
      const oldMaster = Math.min(...room.members.keys()), actor = peer.actor;
      room.members.delete(actor); peer.room = null; peer.actor = 0;
      if (room.cleanup) room.cache = room.cache.filter(e => e.sender !== actor || e.global);
      room.cacheBytes = room.cache.reduce((n, e) => n + e.size, 0);
      const fields = params([254, actor], [252, ints([...room.members.keys()])], [233, false]);
      if (room.members.size) {
        const master = Math.min(...room.members.keys()); if (master !== oldMaster) fields.set(203, master);
        this.broadcast(room, 254, fields);
      } else this.rooms.delete(room.name);
    }
    close(peer) {
      if (!peer || peer.closed) return;
      peer.closed = true; this.leave(peer); this.peers.delete(peer);
      if (peer.game || !this.sessions.get(peer.token)?.pending) this.sessions.delete(peer.token);
    }
    closeOwner(owner) {
      for (const peer of [...this.peers]) if (peer.owner === owner) this.close(peer);
      for (const [token, session] of this.sessions) if (session.owner === owner) this.sessions.delete(token);
    }
  }
  const api = { Atom, unwrap, byte, ints, get, map, packet, parse, RoomBroker };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PeakPhoton = api;
})(typeof window === 'object' ? window : globalThis);
