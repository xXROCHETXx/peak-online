# PEAK en el navegador

Este repositorio publica el cliente web de PEAK. La entrada abre el juego directamente, sin una página de instalación.

Enlace de la versión web: https://rawcdn.githack.com/xXROCHETXx/peak-online/web-v3/site/index.html

Este enlace sirve los archivos estáticos del repositorio mediante el CDN de rawgit.hack. El servicio puede mostrar una confirmación inicial antes de abrir el HTML. No requiere instalar el iniciador ni iniciar sesión para cargar el cliente web.

URL prevista de GitHub Pages: https://xxrochetxx.github.io/peak-online/

## Publicación

La carpeta `site/` contiene el HTML, JavaScript, estilos y WebAssembly que usa el navegador. El workflow publica únicamente esa carpeta. Los HTML se sirven desde rawgit.hack y los scripts, estilos y cliente modificado desde jsDelivr, fijados a la etiqueta `web-v2`. Así se evita depender de las respuestas 403 observadas al solicitar scripts al alojamiento del HTML. Los datos originales y los niveles se cargan desde el CDN del port original, fijados a la revisión `f1924c4fcd0099172f50f8d2a5273fda12fa1444`. El cliente modificado está comprimido; la página lo descomprime antes de iniciar Unity.

El cargador comprueba que los scripts se hayan inicializado antes de descargar los datos, reintenta descargas interrumpidas sin duplicar bytes y dispone de una fuente alternativa de la misma revisión para los datos originales. Los errores indican el archivo que falla. Las respuestas de acceso denegado o límite de peticiones detienen los reintentos.

La entrada `web-v3` descarga cuatro fragmentos en paralelo y carga el código y framework al mismo tiempo. Los scripts del puente se descargan juntos y se ejecutan en orden. El descargador está incluido en el HTML para evitar una petición adicional al iniciar. Los archivos completos se guardan en Cache Storage cuando el navegador lo permite; una recarga reutiliza lo ya guardado. Si no hay almacenamiento disponible, continúa la carga desde la red. La primera carga suma unos 261 MB y aún necesita iniciar Unity. Los archivos del cliente que no cambiaron conservan sus URL de `web-v2` para aprovechar su caché existente.

Se sigue el esquema de [los ports de Dasher](https://github.com/dashiellbenton/ports/blob/main/.github/workflows/static.yml) y de [PEAK en wasm.rip](https://github.com/wasmdotrip/wasm.rip/blob/main/files/peak/PEAK.html): una web estática y archivos del juego en un CDN.

**Estado de GitHub Pages:** GitHub rechazó el despliegue por un bloqueo de facturación de la cuenta. La URL de Pages todavía no se ha publicado. [Mensaje del despliegue](https://github.com/xXROCHETXx/peak-online/actions/runs/39722120348). GitHub Pages está incluido en GitHub Free para repositorios públicos; ese mensaje es un bloqueo de la cuenta, no un requisito de contratar alojamiento. El enlace del CDN funciona de forma independiente del despliegue de Pages.

Después de resolverlo, abre Actions → Publicar PEAK en GitHub Pages → Run workflow. En Settings → Pages debe estar seleccionada la fuente GitHub Actions.

## Partidas con amigos

El enlace de la página carga el cliente web aunque no haya una sala elegida. Las invitaciones que incluyen `#server=…&room=…` abren directamente la partida de ese host, con el código y la voz de nuestra adaptación. También se puede pegar el enlace de una partida en el panel del juego.

La simulación de la partida y el servidor de salas siguen dependiendo del host de cada grupo. Servir el HTML en Pages no ejecuta ese servidor. Crear salas y voz enteramente desde el navegador requeriría adaptar el transporte; esta publicación no afirma haber implementado ese cambio.

## Créditos y validación

Port original de Dasher. PEAK de Aggro Crab & Landfall. Archivos originales desde `wasmdotrip/Peak-Port`.

Se verificaron rutas, invitaciones, compresión e integridad del WASM modificado. Ese binario conserva las mejoras de movimiento y voz probadas en dos instancias locales. La nueva entrada estática aún requiere una carga completa en un navegador y una partida entre dos equipos.
