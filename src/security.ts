import { normalizeUrl } from './model.ts';

export function isPublicWebUrl(input: string): boolean {
  let url: URL;
  try { url = new URL(normalizeUrl(input)); } catch { return false; }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.port && !['80', '443'].includes(url.port)) return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')) return false;
  if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.0\.|192\.88\.99\.|198\.(1[89])\.|198\.51\.100\.|203\.0\.113\.)/.test(host)) return false;
  if (host === '::1' || host === '::' || host.startsWith('::ffff:') || (host.includes(':') && /^(?:fe[89ab]|f[cdf])/i.test(host))) return false;
  if (/^\d+$/.test(host) || /^0x[\da-f]+$/i.test(host)) return false;
  return host.includes('.') || host.includes(':');
}

export function safeFaviconBytes(bytes: ArrayBuffer, contentType: string, maxBytes = 160_000): { bytes: ArrayBuffer; extension: string } | null {
  if (bytes.byteLength < 8 || bytes.byteLength > maxBytes) return null;
  const data = new Uint8Array(bytes);
  const type = contentType.split(';')[0].trim().toLowerCase();
  const starts = (...prefix: number[]) => prefix.every((value, index) => data[index] === value);
  const chars = (offset: number, length: number) => String.fromCharCode(...data.slice(offset, offset + length));
  const formats = [
    { extension: 'png', types: ['image/png'], valid: starts(137,80,78,71,13,10,26,10) },
    { extension: 'jpg', types: ['image/jpeg'], valid: starts(255,216,255) },
    { extension: 'gif', types: ['image/gif'], valid: ['GIF87a','GIF89a'].includes(chars(0,6)) },
    { extension: 'ico', types: ['image/x-icon','image/vnd.microsoft.icon','image/ico'], valid: starts(0,0,1,0) && (data[4] || data[5]) },
    { extension: 'webp', types: ['image/webp'], valid: chars(0,4) === 'RIFF' && chars(8,4) === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(chars(12,4)) },
  ];
  const match = formats.find(format => format.valid && (!type || type === 'application/octet-stream' || format.types.includes(type)));
  if (match) return { bytes, extension: match.extension };
  return null;
}

export function sameOrigin(candidate: string, origin: string): boolean {
  try { const a = new URL(candidate); const b = new URL(origin); return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port; } catch { return false; }
}
