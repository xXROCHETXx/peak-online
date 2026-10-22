/* Browser-hosted rooms. PeerJS provides rendezvous; game/voice packets use WebRTC. */
(function (root) {
  'use strict';
  const PREFIX = 'peak-online-p2p1-';
  const MAGIC = 'peak-p2p1';
  // Send complete SDP descriptions. Trickle-candidate frames caused the public
  // service to close the signalling socket in the live integration check.
  function completeDescriptions(peer) {
    if (!peer.socket?.send || !peer.getConnection) return;
    const send = peer.socket.send.bind(peer.socket);
    peer.socket.send = async message => {
      if (message.type === 'CANDIDATE') return;
      if (message.type === 'OFFER' || message.type === 'ANSWER') {
        const pc = peer.getConnection(message.dst, message.payload.connectionId)?.peerConnection;
        if (!pc) return;
        if (pc.iceGatheringState !== 'complete') await new Promise(resolve => {
          const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed); peer.off('close', done); resolve(); };
          const changed = () => { if (pc.iceGatheringState === 'complete') done(); };
          const timer = setTimeout(done, 5000);
          pc.addEventListener('icegatheringstatechange', changed); peer.on('close', done);
        });
        if (peer.destroyed || pc.signalingState === 'closed' || !pc.localDescription) return;
        message = { ...message, payload: { ...message.payload, sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } };
      }
      send(message);
    };
  }
  const encode = (kind, id = 0, payload = new Uint8Array()) => {
    const b = new Uint8Array(5 + payload.byteLength);
    b[0] = kind; new DataView(b.buffer).setUint32(1, id, true); b.set(payload, 5); return b.buffer;
  };
  class GameSocket extends EventTarget {
    constructor(transport, url, protocol) {
      super(); Object.assign(this, { transport, url, protocol, binaryType: 'arraybuffer', readyState: 0, id: ++transport.nextSocket });
      transport.sockets.set(this.id, this);
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        if (!transport.ready) { this.finish(1006, 'Room connection is closed'); return; }
        this.readyState = 1; transport.send(encode(0, this.id));
        if (this.readyState === 1) this.dispatchEvent(new Event('open'));
      });
    }
    send(data) {
      if (this.readyState !== 1) throw new Error('Game connection is not open');
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      this.transport.send(encode(1, this.id, bytes));
    }
    close(code = 1000) {
      if (this.readyState === 3) return;
      if (this.transport.ready) this.transport.send(encode(2, this.id));
      this.finish(code, '');
    }
    deliver(bytes) {
      if (this.readyState !== 1) return;
      const event = new Event('message'); event.data = bytes.slice().buffer; this.dispatchEvent(event);
    }
    finish(code, reason) {
      if (this.readyState === 3) return;
      this.readyState = 3; this.transport.sockets.delete(this.id);
      const event = new Event('close'); Object.assign(event, { code, reason }); this.dispatchEvent(event);
    }
  }
  class BrowserTransport {
    constructor({ PeerClass = root.Peer, Photon = root.PeakPhoton, requireWebRTC = true } = {}) {
      Object.assign(this, { PeerClass, Photon, requireWebRTC, sockets: new Map(), guests: new Map(), localPeers: new Map(), nextSocket: 0, generation: 0, ready: false });
    }
    setRoom(kind, code, nickname) { this.intent = { kind, code, nickname }; }
    async prepare(signal) {
      if (!this.intent) throw new Error('Choose Create room or enter a room code.');
      if (this.requireWebRTC && !root.RTCPeerConnection) throw new Error('This browser does not support WebRTC rooms. Try a recent Chrome or Edge.');
      if (!this.PeerClass || !this.Photon) throw new Error('Room scripts did not load. Reload PEAK.');
      this.close();
      const generation = this.generation, intent = this.intent;
      this.isHost = intent.kind === 'create';
      this.broker = this.isHost ? new this.Photon.RoomBroker({ address: location.host + '/relay/game' }) : null;
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
          if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
          if (error) { this.close(); reject(error); }
          else { this.ready = true; resolve(); }
        };
        const abort = () => finish(new Error('Connection cancelled.'));
        const timer = setTimeout(() => finish(new Error('Could not reach the room. Check the code and keep the host tab open. Some networks require a TURN relay.')), 30000);
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        const options = { debug: 1, secure: true };
        const peerId = this.isHost ? PREFIX + intent.code : 'peak-player-' + crypto.randomUUID();
        const peer = this.peer = new this.PeerClass(peerId, options);
        completeDescriptions(peer);
        peer.on('error', error => {
          const message = error.type === 'unavailable-id' ? 'That room code is taken. Click Create room again.'
            : error.type === 'peer-unavailable' ? 'Room not found. Check the code and ask the host to keep their tab open.'
            : 'Room connection failed: ' + (error.message || error.type || error);
          if (!settled) finish(new Error(message)); else console.warn('[PEAK rooms]', message);
        });
        peer.on('disconnected', () => {
          if (generation === this.generation && !peer.destroyed) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => { if (!peer.destroyed && peer.disconnected) peer.reconnect(); }, 1500);
          }
        });
        peer.on('connection', connection => {
          if (this.isHost && generation === this.generation) this.accept(connection);
          else connection.close();
        });
        peer.on('open', () => {
          if (generation !== this.generation) return;
          // Signalling can reconnect while the existing data channel stays open.
          if (settled) return;
          if (this.isHost) { finish(); return; }
          const connection = this.connection = peer.connect(PREFIX + intent.code, {
            serialization: 'binary', reliable: true, metadata: { protocol: MAGIC }
          });
          connection.on('data', data => {
            if (generation !== this.generation) return;
            const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
            if (bytes[0] === 3) { finish(new Error(new TextDecoder().decode(bytes.subarray(5)))); return; }
            if (bytes[0] === 4) { finish(); return; }
            this.deliver(bytes);
          });
          connection.on('error', error => finish(new Error('Could not connect to the host: ' + error.message)));
          connection.on('close', () => {
            if (generation !== this.generation) return;
            if (!settled) finish(new Error('The host closed the connection.'));
            else this.close('The host left the room.');
          });
        });
      });
    }
    accept(connection) {
      const generation = this.generation, owner = connection.peer, logical = new Map();
      connection.on('open', () => {
        if (generation !== this.generation) { connection.close(); return; }
        if (connection.metadata?.protocol !== MAGIC || this.guests.size >= 3 || this.guests.has(owner)) {
          connection.send(encode(3, 0, new TextEncoder().encode('The room is full or the client version differs.')));
          setTimeout(() => connection.close(), 200); return;
        }
        this.guests.set(owner, connection); connection.send(encode(4));
      });
      connection.on('data', data => {
        if (generation !== this.generation || this.guests.get(owner) !== connection) return;
        try { this.route(owner, logical, new Uint8Array(data), bytes => {
          // A slow guest must not interrupt delivery to the rest of the room.
          try { this.sendConnection(connection, bytes.buffer); }
          catch (error) { console.warn('[PEAK rooms]', error.message); }
        }); }
        catch (error) { console.warn('[PEAK rooms]', error.message); connection.close(); }
      });
      connection.on('close', () => {
        if (generation !== this.generation) return;
        this.broker?.closeOwner(owner); if (this.guests.get(owner) === connection) this.guests.delete(owner);
      });
      connection.on('error', error => { console.warn('[PEAK rooms]', error.message); connection.close(); });
    }
    route(owner, logical, bytes, send) {
      if (bytes.byteLength < 5 || bytes.byteLength > 2097157) throw new Error('Invalid room packet');
      const id = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true);
      if (bytes[0] === 0) {
        if (logical.has(id)) throw new Error('Duplicate game socket');
        const peer = this.broker.open(owner, payload => send(new Uint8Array(encode(1, id, payload)))); logical.set(id, peer);
      } else if (bytes[0] === 1) {
        const peer = logical.get(id); if (!peer) throw new Error('Unknown game socket');
        this.broker.receive(peer, bytes.subarray(5));
      } else if (bytes[0] === 2) { this.broker.close(logical.get(id)); logical.delete(id); }
      else throw new Error('Unknown room command');
    }
    sendConnection(connection, frame) {
      if (!connection.open || connection.bufferSize > 512 || (connection.dataChannel?.bufferedAmount || 0) > 8388608) {
        connection.close(); throw new Error('Game connection is too slow.');
      }
      connection.send(frame);
    }
    send(frame) {
      if (!this.ready) throw new Error('Room is not connected');
      if (this.isHost) {
        try { this.route(this.peer.id, this.localPeers, new Uint8Array(frame), bytes => queueMicrotask(() => this.deliver(bytes))); }
        catch (error) { console.error('[PEAK rooms]', error); this.close(error.message); }
      } else this.sendConnection(this.connection, frame);
    }
    deliver(bytes) {
      if (bytes.byteLength < 5) return;
      const id = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true);
      if (bytes[0] === 1) this.sockets.get(id)?.deliver(bytes.subarray(5));
      else if (bytes[0] === 2) this.sockets.get(id)?.finish(1006, 'Game connection closed');
    }
    socket(url, protocol) { return new GameSocket(this, url, protocol); }
    close(reason = 'Room closed') {
      this.generation++; this.ready = false; clearTimeout(this.reconnectTimer);
      for (const socket of [...this.sockets.values()]) socket.finish(1006, reason);
      this.peer?.destroy(); this.peer = null; this.connection = null;
      this.guests.clear(); this.localPeers.clear(); this.broker = null;
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = { BrowserTransport, GameSocket, encode };
  else root.peakBrowserTransport = new BrowserTransport();
})(typeof window === 'object' ? window : globalThis);
