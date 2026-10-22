// Keep failed attempts separate: a dropped stream must never duplicate game bytes.
export async function downloadFile(urls, {
  expectedBytes, onBytes = () => {}, onRetry = () => {},
  fetchFile = globalThis.fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  const name = new URL(urls[0]).pathname.split('/').pop();
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = urls[Math.min(attempt === 2 ? 1 : 0, urls.length - 1)];
    const chunks = [];
    let received = 0, reader;
    try {
      const response = await fetchFile(url);
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status + ' (' + new URL(url).hostname + ')');
        error.noRetry = [401, 403, 429].includes(response.status);
        await response.body?.cancel();
        throw error;
      }
      if ((response.headers.get('content-type') || '').includes('text/html')) {
        await response.body?.cancel();
        const error = new Error('El servidor devolvió una página HTML en lugar del archivo.');
        error.noRetry = true;
        throw error;
      }
      const accept = chunk => {
        chunks.push(chunk);
        received += chunk.byteLength;
        onBytes(chunk.byteLength);
      };
      if (response.body?.getReader) {
        reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accept(value);
        }
      } else accept(await response.arrayBuffer());
      if (expectedBytes !== undefined && received !== expectedBytes) {
        throw new Error('Descarga incompleta: ' + received + ' de ' + expectedBytes + ' bytes.');
      }
      return new Blob(chunks);
    } catch (error) {
      lastError = error;
      if (reader) { try { await reader.cancel(); } catch { /* The stream already failed. */ } }
      if (received) onBytes(-received);
      if (error.noRetry || attempt === 2) break;
      onRetry(name, attempt + 2);
      await wait(750 * (attempt + 1));
    } finally { reader?.releaseLock(); }
  }
  throw new Error('No se pudo descargar ' + name + ': ' + (lastError?.message || lastError));
}
