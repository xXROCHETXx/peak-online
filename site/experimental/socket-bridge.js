(() => {
  'use strict';
  const connections = new Map();
  let allowRemote = false;
  let sameOrigin = false;
  let primaryClient = null;
  const log = value => console.log('[PhotonBrowserBridge] ' + value);
  const readString = (module, ptr) => {
    if (!ptr) return '';
    const length = module.HEAPU32[(ptr + 8) >>> 2];
    if (length > 16384) throw new Error('Invalid managed string');
    return String.fromCharCode(...module.HEAPU16.subarray((ptr + 12) >>> 1, ((ptr + 12) >>> 1) + length));
  };
  const pointer = (module, address) => module.HEAPU32[address >>> 2];
  const managedString = (module, value) => {
    const result = module.asm.__indirect_function_table.get(121359)(value.length, 0);
    for (let i = 0; i < value.length; i++) module.HEAPU16[((result + 12) >>> 1) + i] = value.charCodeAt(i);
    return result;
  };
  const setState = (module, self, state) => { module.HEAPU32[(self + 20) >>> 2] = state; };
  window.peakSocketBridge = {
    configure(options) {
      allowRemote = options.allowRemote === true; sameOrigin = options.sameOrigin === true;
      primaryClient = null;
    },
    abortAll() {
      for (const [self, entry] of connections) {
        entry.closing = true;
        entry.socket.close(1000);
        setState(entry.module, self, 0);
      }
      connections.clear();
    },
    connect(module, self) {
      try {
        if (connections.has(self)) return 0;
        const server = readString(module, pointer(module, self + 28));
        if (!allowRemote && !['127.0.0.1', 'localhost', '::1'].includes(server)) throw new Error('Configura primero tu aplicación Photon para usar un servidor remoto.');
        const port = pointer(module, self + 36);
        const scheme = module.HEAPU8[self + 12] === 5 ? 'wss' : 'ws';
        const path = readString(module, pointer(module, self + 48));
        const baseUrl = scheme + '://' + (server.includes(':') ? '[' + server + ']' : server) + ':' + port + (path && path !== '/' ? (path.startsWith('/') ? path : '/' + path) : '');
        const table = module.asm.__indirect_function_table;
        const peer = pointer(module, self + 8);
        const client = pointer(module, peer + 8);
        if (sameOrigin && primaryClient === null) primaryClient = client;
        if (sameOrigin) table.get(38289)(pointer(module, peer + 8), 120000, 0);
        let url = readString(module, table.get(38217)(peer, managedString(module, baseUrl), pointer(module, peer + 112), pointer(module, peer + 104), 0));
        if (sameOrigin) {
          const address = new URL(url);
          address.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
          address.host = location.host;
          if (!address.pathname.startsWith('/relay/')) address.pathname = '/relay/master';
          url = address.href;
        }
        const protocol = readString(module, table.get(38126)(self, 0));
        const socket = new WebSocket(url, protocol || 'GpBinaryV18');
        socket.binaryType = 'arraybuffer';
        const entry = { socket, module, closing: false, opened: false, received: 0, sent: 0 };
        connections.set(self, entry);
        log('Socket del navegador creado: ' + url.replace(/[?].*$/, '?…') + '; protocolo ' + protocol);
        socket.addEventListener('open', () => {
          if (entry.closing || connections.get(self) !== entry) return;
          entry.opened = true;
          setState(module, self, 2);
          log('WebSocket abierto; notificando al peer de Photon.');
          try { module.asm.PeakProbe_PeerOnConnect(pointer(module, self + 8), 0); }
          catch (error) { log('Error en OnConnect: ' + error); }
        });
        socket.addEventListener('message', event => {
          if (entry.closing || connections.get(self) !== entry || !(event.data instanceof ArrayBuffer)) return;
          try {
            const bytes = new Uint8Array(event.data);
            module.asm.PeakProbe_MetadataInit(10434004);
            const array = module.asm.PeakProbe_NewArray(pointer(module, 10434004), bytes.length);
            if (!array || pointer(module, array + 12) !== bytes.length) throw new Error('No se pudo crear el buffer administrado.');
            module.HEAPU8.set(bytes, array + 16);
            module.asm.PeakProbe_Receive(self, array, bytes.length, 0, 0);
            window.peakVoiceBridge?.onSocketPacket?.(module, client);
            // The unencrypted operation-response header is fixed in both codecs.
            // Read only the room result; the native SDK still consumes the full packet.
            if (sameOrigin && client === primaryClient && bytes.length >= 5 && bytes[0] === 0xf3 && bytes[1] === 3 && [226, 227].includes(bytes[2])) {
              const returnCode = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(3, protocol === 'GpBinaryV18');
              if (returnCode !== 0) queueMicrotask(() => window.dispatchEvent(new CustomEvent('peak-room-rejected', { detail: { returnCode } })));
            }
            entry.received++;
            if (entry.received <= 3 || entry.received % 200 === 0)
              log('Paquete recibido y entregado a Photon: ' + bytes.length + ' bytes; total=' + entry.received);
          } catch (error) { log('Error de recepción: ' + error); }
        });
        socket.addEventListener('error', () => log('Error del WebSocket del navegador.'));
        socket.addEventListener('close', event => {
          if (connections.get(self) === entry) {
            connections.delete(self);
            setState(module, self, 0);
          }
          log('WebSocket cerrado (' + event.code + '); enviados=' + entry.sent + ', recibidos=' + entry.received);
          if (!entry.closing) {
            try { module.asm.PeakProbe_SocketError(self, entry.opened ? 1026 : 1023, 0); }
            catch (error) { log('Error al notificar desconexión: ' + error); }
          }
        });
        return 1;
      } catch (error) {
        setState(module, self, 0);
        log('No se pudo conectar: ' + error);
        return 0;
      }
    },
    close(module, self) {
      const entry = connections.get(self);
      if (entry) {
        entry.closing = true;
        entry.socket.close(1000);
        connections.delete(self);
      }
      setState(module, self, 0);
      return 1;
    },
    send(module, self, buffer, length) {
      const entry = connections.get(self);
      if (!entry || entry.socket.readyState !== WebSocket.OPEN) return 1;
      try {
        entry.socket.send(module.HEAPU8.slice(buffer, buffer + length));
        entry.sent++;
        if (entry.sent <= 3) log('Paquete Photon enviado: ' + length + ' bytes.');
        return 0;
      } catch (error) {
        log('Error de envío: ' + error);
        return 3;
      }
    }
  };
})();
