// Keep failed attempts separate: a dropped stream must never duplicate game bytes.
let cacheWritesDisabled = false;
export async function downloadFile(urls, {
  expectedBytes, onBytes = () => {}, onRetry = () => {},
  fetchFile = globalThis.fetch,
  cacheName, cacheStorage = globalThis.caches, signal,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  signal?.throwIfAborted();
  const name = new URL(urls[0]).pathname.split('/').pop();
  let cache;
  if (cacheName && cacheStorage) {
    try {
      cache = await cacheStorage.open(cacheName);
      const saved = await cache.match(urls[0]);
      if (saved) {
        const blob = await saved.blob();
        signal?.throwIfAborted();
        if (saved.ok && expectedBytes !== undefined && blob.size === expectedBytes) {
          onBytes(blob.size);
          return blob;
        }
        await cache.delete(urls[0]);
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      cache = null; // Private browsing and disabled storage still support network loading.
    }
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = urls[Math.min(attempt === 2 ? 1 : 0, urls.length - 1)];
    const chunks = [];
    let received = 0, reader;
    try {
      signal?.throwIfAborted();
      const response = await fetchFile(url, { signal });
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
      const blob = new Blob(chunks);
      if (cache && !cacheWritesDisabled && expectedBytes !== undefined) {
        try { await cache.put(urls[0], new Response(blob)); }
        catch { cacheWritesDisabled = true; } // A full disk must not prevent playing.
      }
      return blob;
    } catch (error) {
      lastError = error;
      if (reader) { try { await reader.cancel(); } catch { /* The stream already failed. */ } }
      if (received) onBytes(-received);
      if (signal?.aborted) throw error;
      if (error.noRetry || attempt === 2) break;
      onRetry(name, attempt + 2);
      await wait(750 * (attempt + 1));
    } finally { reader?.releaseLock(); }
  }
  throw new Error('No se pudo descargar ' + name + ': ' + (lastError?.message || lastError));
}

// Bound simultaneous downloads and keep the original part order for Unity.
export async function mapConcurrent(items, task, concurrency = 4, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const results = new Array(items.length);
  let next = 0, failure;
  async function worker() {
    while (!controller.signal.aborted && next < items.length) {
      const index = next++;
      try { results[index] = await task(items[index], index, controller.signal); }
      catch (error) { failure ??= error; controller.abort(error); }
    }
  }
  try { await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker)); }
  finally { signal?.removeEventListener('abort', abort); }
  if (failure) throw failure;
  signal?.throwIfAborted();
  return results;
}
