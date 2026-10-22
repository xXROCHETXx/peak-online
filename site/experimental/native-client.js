/* Function indices belong only to the pinned PEAK 1.62.a build; see HOST-TECNICO.md. */
(() => {
  'use strict';
  window.createPeakNativeClient = (instance, roomsOnly) => {
    const module = instance.Module;
    const call = (index, ...args) => module.asm.__indirect_function_table.get(index)(...args);
    const pointer = address => module.HEAPU32[address >>> 2];
    const write = (address, value) => { module.HEAPU32[address >>> 2] = value; };
    const string = value => {
      const text = String(value), address = call(121359, text.length, 0);
      for (let i = 0; i < text.length; i++) module.HEAPU16[((address + 12) >>> 1) + i] = text.charCodeAt(i);
      return address;
    };
    const read = address => address ? String.fromCharCode(...module.HEAPU16.subarray((address + 12) >>> 1, ((address + 12) >>> 1) + pointer(address + 8))) : '';
    const client = {
      needsReload: false,
      launchesGame: !roomsOnly,
      repairMenu() {
        const gameObject = call(70405, string('Button_PlayWithFriends'), 0);
        if (!gameObject) return 'Host Game no se encontró en la escena activa.';
        call(5399, gameObject, 0, 0);
        return 'Host Game original sustituido por el botón del panel web.';
      },
      connect(nickname) {
        if (call(39597, 0)) call(39598, 0, 0);
        if (call(39584, 0)) return;
        const settings = call(39577, 0), config = pointer(settings + 12);
        write(config + 8, string('00000000-0000-0000-0000-000000000000'));
        write(config + 24, string('peak-selfhost-1'));
        write(config + 32, string('')); write(config + 36, string(''));
        write(config + 40, string(location.hostname)); write(config + 48, string(''));
        write(config + 44, Number(location.port) || (location.protocol === 'https:' ? 443 : 80));
        module.HEAPU8[config + 28] = 0;
        module.HEAPU8[config + 52] = location.protocol === 'https:' ? 5 : 4;
        module.HEAPU8[config + 53] = 0; write(config + 56, 0); module.HEAPU8[config + 61] = 5;
        module.HEAPU8[settings + 25] = 1; module.HEAPU8[settings + 26] = 0;
        call(63996, 1, 0);
        call(39589, 0, 0); call(39575, string('peak-selfhost-1'), 0);
        call(39600, 1, 0); call(39594, string(nickname), 0);
        window.peakSocketBridge.configure({ allowRemote: true, sameOrigin: true });
        if (!call(39646, config, 0, 0)) throw new Error('PEAK rechazó la conexión.');
      },
      requestRoom(kind, code) {
        if (roomsOnly) {
          const accepted = kind === 'create' ? call(39664, string(code), 0, 0, 0, 0) : call(39666, string(code), 0, 0);
          if (!accepted) throw new Error('No se pudo enviar la solicitud de sala.');
        } else {
          const method = kind === 'create' ? 10515056 : 10515064;
          module.asm.PeakProbe_MetadataInit(10537496);
          module.asm.PeakProbe_MetadataInit(method);
          const service = call(9295, pointer(10537496));
          const nextState = call(240063, pointer(service + 8), 1, pointer(method));
          if (!nextState) throw new Error('El estado de conexión de PEAK no está inicializado.');
          write(nextState + 16, string(code));
          if (kind === 'join') write(nextState + 20, string(''));
          client.needsReload = true;
          call(71980, string('Airport'), 0);
        }
      },
      snapshot() {
        const offline = !!call(39597, 0), inRoom = !!call(39612, 0) && !offline;
        const room = inRoom ? call(39591, 0) : 0;
        return {
          connected: !!call(39584, 0) && !offline,
          ready: !!call(39585, 0) && !offline,
          disconnected: call(39586, 0) === 14,
          inRoom,
          room: room ? { code: read(call(39320, room, 0)), count: call(39330, room, 0), isHost: !!call(9007, 0) } : null
        };
      },
      disconnect() { call(39650, 0); },
      abort() { window.peakSocketBridge.abortAll(); }
    };
    return client;
  };
})();
