// Content-Type per file extension for serving package entries. Everything unknown is
// application/octet-stream + the nosniff header the content server always sets — a wrong type here
// breaks playback (Chrome refuses nosniffed scripts/styles with the wrong type), so the common
// authoring-tool output types are all listed.

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  xhtml: 'application/xhtml+xml',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml',
  xsd: 'application/xml',
  dtd: 'application/xml-dtd',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  vtt: 'text/vtt',
  srt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  cur: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  pdf: 'application/pdf',
  swf: 'application/x-shockwave-flash', // dead tech, but old packages still carry the files
  wasm: 'application/wasm',
  map: 'application/json',
  zip: 'application/zip',
};

export function contentTypeFor(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}
