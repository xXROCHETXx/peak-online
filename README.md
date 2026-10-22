# PEAK · un host por grupo

La página de GitHub Pages es un lanzador estático. **No contiene la dirección de un servidor de partidas compartido.** Cada host descarga el iniciador, ejecuta su servidor en su propio PC y comparte una invitación para su grupo. Hasta cuatro jugadores por sala; los invitados solo necesitan un navegador compatible.

**Estado de publicación:** el [repositorio](https://github.com/xXROCHETXx/peak-online) y el [iniciador para Windows](https://github.com/xXROCHETXx/peak-online/releases/latest) están publicados. El despliegue de GitHub Pages fue rechazado por GitHub porque la cuenta tiene un bloqueo de facturación; no llegó a ejecutarse. Mientras la página principal no responda, el iniciador abre directamente la partida en el enlace HTTPS de su propio host. Puedes jugar por ese enlace sin esperar a Pages.

## Crear una partida (Windows x64)

1. Descarga `PEAK-host-Windows.zip` desde Releases y extrae el ZIP completo.
2. Abre `Crear partida.cmd`. El primer inicio descarga el conector oficial `cloudflared` y verifica su SHA256. No instala servicios ni modifica el router o el firewall.
3. Espera el enlace y ábrelo. Si aparece el lanzador, pulsa **Abrir PEAK**. Si la página principal está caída, el iniciador abre el juego directamente. Espera el menú y usa **Host Game · Crear partida**.
4. Dentro de PEAK, pulsa **Copiar enlace**. Comparte ese enlace con tus amigos: incluye la dirección de tu host y el código de sala.
5. Mantén el iniciador abierto mientras juegan. Pulsa **Q** en esa ventana para detener el túnel y el servidor.

Cada iniciador tiene su servidor dedicado en `127.0.0.1:8778` y obtiene un nombre HTTPS temporal. Si ese puerto está ocupado, avisa; no publica otro servicio que ya esté funcionando. Para elegir otro puerto: `powershell -NoProfile -ExecutionPolicy Bypass -File .\iniciar-online.ps1 -Puerto 8779`.

El enlace cambia al reiniciar. Los enlaces antiguos dejan de funcionar al cerrar el túnel. Usa **Q** en el iniciador para detener ambos procesos. Cualquiera que reciba el enlace del host podrá acceder a ese servidor mientras esté abierto; no hay directorio público de partidas. La página principal por sí sola no conecta a ningún PC.

## Entrar como invitado

Abre la invitación que te envió el host y pulsa **Abrir PEAK**. Cuando cargue, pulsa **Entrar a partida**. También puedes pegar la invitación en la página principal. El código de seis caracteres identifica la sala dentro del servidor elegido: por sí solo no encuentra PCs por Internet.

El micrófono se activa dentro de PEAK y requiere permiso del navegador. El modo inicial sigue siendo **Controles de PEAK** y el perfil **Menor retardo**. Puedes escuchar a otros sin habilitar tu propio micrófono. Si el navegador bloquea micrófono, sonido o pantalla completa dentro del iframe, usa **Abrir aparte** y concede el permiso a la dirección del host. Se recomienda un navegador Chromium de escritorio con AudioWorklet y WebCodecs Opus.

## Qué se aloja dónde

- **GitHub Pages:** `site/`, la página ligera de entrada. No ejecuta el servidor y no incorpora una dirección predeterminada para Roman ni para ningún otro host.
- **PC de cada host:** servidor de salas y voz, puentes del navegador y el WASM adaptado. Solo se publica la carpeta `www/`; código fuente, runtime y logs quedan fuera.
- **CDN original del port:** datos originales, loader, StreamingAssets y LevelBundles, fijados a la revisión `f1924c4fcd0099172f50f8d2a5273fda12fa1444`.
- **Cloudflare Quick Tunnel:** transporte HTTPS/WSS temporal entre el grupo y su host. No exige cuenta. Es un servicio de prueba sin garantía de disponibilidad, puede añadir latencia y su dirección cambia al reiniciar. No es una conexión directa P2P. Una alternativa posterior es WebRTC con señalización e ICE/TURN; no forma parte de esta versión.

Se sigue la estructura del [wrapper PEAK de wasm.rip](https://github.com/wasmdotrip/wasm.rip/blob/main/files/peak/PEAK.html), que carga un launcher en un iframe y deja los archivos del juego en un CDN. Aquí el destino del iframe lo elige cada grupo y se delegan los permisos de micrófono y audio.

## Desarrollo y publicación

El repositorio se prepara para `xXROCHETXx/peak-online`. El workflow `.github/workflows/pages.yml` publica únicamente `site/` al hacer push a `main`. En Settings → Pages, la fuente debe ser **GitHub Actions**. El iniciador se distribuye como archivo de Release, fuera del historial Git y de Pages.

Para finalizar Pages, el propietario debe resolver el bloqueo que GitHub muestra en la configuración de facturación de su cuenta. Después puede volver a ejecutar el workflow **Publicar PEAK en GitHub Pages**. No hace falta volver a subir el iniciador para que use Pages cuando esta vuelva a responder.

Para crear el ZIP desde la copia local verificada (Python 3.9 o superior):

```powershell
python scripts/package_host.py --game-root RUTA-A-peak-local
```

El resultado queda en `artifacts/`, que está excluido de Git. El empaquetador preserva el juego local y crea otra entrada que carga los archivos originales desde el CDN. Incluye el código fuente y la licencia del servidor GPL-3.0, su runtime y el código del parche de voz. No incorpora los más de 1 GB de datos originales del juego.

Para comprobar enlaces y permisos de publicación:

```powershell
node --test tests/connection.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python -m http.server 8780 --bind 127.0.0.1 --directory site
```

Después de autenticar GitHub CLI con tu cuenta, publica un repositorio nuevo y el ZIP. No subas la carpeta completa de trabajo, los logs ni ninguna credencial. Los comandos concretos están en `PUBLICAR.md`.

## Estado y créditos

Salas, desplazamiento en ambos sentidos y voz se probaron con dos instancias locales de PEAK. El iniciador también pasó una comprobación real de HTTPS y del inicio del protocolo de PEAK por WSS a través de un túnel público temporal; al terminar cerró ambos procesos. Se corrigió la espera inicial de DNS. Esto aún requiere una partida real entre dos equipos. El cooperativo completo, los objetos, agarres y transiciones entre islas siguen en validación.

Puedes repetir solo la comprobación de conexión con `powershell -NoProfile -ExecutionPolicy Bypass -File .\iniciar-online.ps1 -Comprobar`. Abre un túnel temporal, prueba HTTPS y WSS y lo cierra; no inicia una partida persistente.

Port original de **Dasher**; PEAK de **Aggro Crab & Landfall**. Servidor adaptado de [Segually/photon-server](https://github.com/Segually/photon-server), revisión `1e7cf407ad835a95d7e91e8a005bcc7df46732a4`, GPL-3.0: fuente y licencia en `host-server/` dentro del iniciador. Conector HTTPS oficial de [Cloudflare](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
