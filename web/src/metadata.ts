import { marketMetadata } from "./domain";
const cache = new Map<string, Promise<ReturnType<typeof marketMetadata>>>();
export function metadataUrl(uri: string): string | undefined {
  if (uri.startsWith("ipfs://"))
    uri = "https://ipfs.io/ipfs/" + uri.slice(7).replace(/^ipfs\//, "");
  try {
    const url = new URL(uri);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      /^(localhost|127\.|0\.|\[|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
export function loadMetadata(
  uri: string,
): Promise<ReturnType<typeof marketMetadata>> {
  const inline = marketMetadata(uri);
  const url = metadataUrl(uri);
  if (!url || inline.title) return Promise.resolve(inline);
  if (!cache.has(url)) {
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(
      url,
      (async () => {
        try {
          const response = await fetch(url, {
            credentials: "omit",
            referrerPolicy: "no-referrer",
            signal: AbortSignal.timeout(4000),
            headers: { Accept: "application/json" },
          });
          if (!response.ok || !response.body) return inline;
          const reader = response.body.getReader(),
            chunks: Uint8Array[] = [];
          let bytes = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 65536) {
              await reader.cancel();
              return inline;
            }
            chunks.push(value);
          }
          const data = new Uint8Array(bytes);
          let offset = 0;
          for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.byteLength;
          }
          const raw = new TextDecoder().decode(data);
          JSON.parse(raw); // Linked metadata must be JSON; never treat an HTML error page as a title.
          return marketMetadata(raw);
        } catch {
          return inline;
        }
      })(),
    );
  }
  return cache.get(url)!;
}
