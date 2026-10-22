# PEAK en el navegador

Este repositorio publica el cliente web de PEAK. La entrada abre el juego directamente, sin una página de instalación.

URL prevista de GitHub Pages: https://xxrochetxx.github.io/peak-online/

## Publicación

La carpeta `site/` contiene el HTML, JavaScript, estilos y WebAssembly que usa el navegador. El workflow publica únicamente esa carpeta. Los datos originales y los niveles se cargan desde el CDN del port original, fijados a la revisión `f1924c4fcd0099172f50f8d2a5273fda12fa1444`. El cliente modificado está comprimido; la página lo descomprime antes de iniciar Unity.

Se sigue el esquema de [los ports de Dasher](https://github.com/dashiellbenton/ports/blob/main/.github/workflows/static.yml) y de [PEAK en wasm.rip](https://github.com/wasmdotrip/wasm.rip/blob/main/files/peak/PEAK.html): una web estática y archivos del juego en un CDN.

**Estado:** GitHub rechazó el despliegue por un bloqueo de facturación de la cuenta. La URL todavía no se ha publicado. [Mensaje del despliegue](https://github.com/xXROCHETXx/peak-online/actions/runs/39722120348). GitHub Pages está incluido en GitHub Free para repositorios públicos; ese mensaje es un bloqueo de la cuenta, no un requisito de contratar alojamiento.

Después de resolverlo, abre Actions → Publicar PEAK en GitHub Pages → Run workflow. En Settings → Pages debe estar seleccionada la fuente GitHub Actions.

## Partidas con amigos

El enlace de la página carga el cliente web aunque no haya una sala elegida. Las invitaciones que incluyen `#server=…&room=…` abren directamente la partida de ese host, con el código y la voz de nuestra adaptación. También se puede pegar el enlace de una partida en el panel del juego.

La simulación de la partida y el servidor de salas siguen dependiendo del host de cada grupo. Servir el HTML en Pages no ejecuta ese servidor. Crear salas y voz enteramente desde el navegador requeriría adaptar el transporte; esta publicación no afirma haber implementado ese cambio.

## Créditos y validación

Port original de Dasher. PEAK de Aggro Crab & Landfall. Archivos originales desde `wasmdotrip/Peak-Port`.

Se verificaron rutas, invitaciones, compresión e integridad del WASM modificado. Ese binario conserva las mejoras de movimiento y voz probadas en dos instancias locales. La nueva entrada estática aún requiere una carga completa en un navegador y una partida entre dos equipos.