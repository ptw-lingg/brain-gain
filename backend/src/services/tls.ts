// TLS certificate management: load/generate the active cert, validate uploads, expose non-secret
// metadata, and hot-swap the running HTTPS server's secure context when the cert changes.
//
// The private key and certificate PEM live ONLY under data/tls/ — never in settings.json and never
// returned by any API. Only the metadata in `certMeta()` is surfaced to clients.

import { promises as fs } from 'fs';
import path from 'path';
import crypto, { X509Certificate } from 'crypto';
import tls from 'tls';
import https from 'https';
import selfsigned from 'selfsigned';
import type { TlsSettings } from '../types';
import { dataDir } from './fileStore';

// Defaults to backend/src/data/tls; honors DATA_DIR (via fileStore.dataDir()) so an isolated test data
// dir gets its own auto-generated cert instead of sharing the committed dev certificate.
const TLS_DIR = path.join(dataDir(), 'tls');
const KEY_PATH = path.join(TLS_DIR, 'key.pem');
const CERT_PATH = path.join(TLS_DIR, 'cert.pem');
const CHAIN_PATH = path.join(TLS_DIR, 'chain.pem');
const SOURCE_PATH = path.join(TLS_DIR, 'source'); // 'self-signed' | 'uploaded'

export interface TlsCredentials {
  key: string;
  cert: string;
  ca?: string;
}

/** Thrown on invalid/mismatched certificate input → mapped to HTTP 400 by the route. */
export class TlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TlsError';
  }
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(TLS_DIR, { recursive: true });
}

async function readIfExists(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function readSource(): Promise<'self-signed' | 'uploaded'> {
  const s = (await readIfExists(SOURCE_PATH))?.trim();
  return s === 'uploaded' ? 'uploaded' : 'self-signed';
}

/** Load existing credentials, or generate + persist a self-signed cert on first run. */
export async function ensureCredentials(): Promise<TlsCredentials> {
  await ensureDir();
  const key = await readIfExists(KEY_PATH);
  const cert = await readIfExists(CERT_PATH);
  if (key && cert) {
    return { key, cert, ca: await readIfExists(CHAIN_PATH) };
  }
  return generateSelfSigned();
}

/** Generate a self-signed cert, persist it as the active credentials, and return them. */
export async function generateSelfSigned(): Promise<TlsCredentials> {
  await ensureDir();
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keySize: 2048,
    algorithm: 'sha256', // validity defaults to 1 year (bootstrap/dev cert)
  });
  await fs.writeFile(KEY_PATH, pems.private, 'utf-8');
  await fs.writeFile(CERT_PATH, pems.cert, 'utf-8');
  await fs.rm(CHAIN_PATH, { force: true });
  await fs.writeFile(SOURCE_PATH, 'self-signed', 'utf-8');
  return { key: pems.private, cert: pems.cert };
}

/** Non-secret display metadata derived from a certificate PEM. */
export async function certMeta(certPem: string, source?: 'self-signed' | 'uploaded'): Promise<TlsSettings> {
  const x = new X509Certificate(certPem);
  return {
    source: source ?? (await readSource()),
    subject: x.subject,
    issuer: x.issuer,
    validFrom: new Date(x.validFrom).toISOString(),
    validTo: new Date(x.validTo).toISOString(),
    fingerprint: x.fingerprint256,
    updatedAt: new Date().toISOString(),
  };
}

/** Metadata for the currently-active certificate (or null if none exists yet). */
export async function currentCertMeta(): Promise<TlsSettings | null> {
  const cert = await readIfExists(CERT_PATH);
  return cert ? certMeta(cert) : null;
}

/** Validate that cert + key are well-formed PEM and that the key matches the cert. Throws TlsError. */
export function validateCredentials(creds: TlsCredentials): void {
  try {
    tls.createSecureContext({ key: creds.key, cert: creds.cert, ca: creds.ca });
  } catch {
    throw new TlsError('Certificate or key is not valid PEM.');
  }
  let certPub: string;
  let keyPub: string;
  try {
    certPub = new X509Certificate(creds.cert).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    throw new TlsError('Could not read the certificate.');
  }
  try {
    keyPub = crypto.createPublicKey(creds.key).export({ type: 'spki', format: 'der' }).toString('base64');
  } catch {
    throw new TlsError('Could not read the private key.');
  }
  if (certPub !== keyPub) throw new TlsError('The private key does not match the certificate.');
}

/** Validate + persist uploaded credentials as the active cert; returns the creds + display metadata. */
export async function storeUploadedCredentials(
  creds: TlsCredentials,
): Promise<{ creds: TlsCredentials; meta: TlsSettings }> {
  validateCredentials(creds);
  await ensureDir();
  await fs.writeFile(KEY_PATH, creds.key, 'utf-8');
  await fs.writeFile(CERT_PATH, creds.cert, 'utf-8');
  if (creds.ca) await fs.writeFile(CHAIN_PATH, creds.ca, 'utf-8');
  else await fs.rm(CHAIN_PATH, { force: true });
  await fs.writeFile(SOURCE_PATH, 'uploaded', 'utf-8');
  return { creds, meta: await certMeta(creds.cert, 'uploaded') };
}

// --- live HTTPS server hot-swap ---
// A LIST, not a single slot: the app listener and the SCORM content listener share one
// certificate, and an uploaded cert must re-key both — a swap that reaches only one of them would
// leave the content origin serving the old cert until restart.
const httpsServers: https.Server[] = [];

export function registerHttpsServer(server: https.Server): void {
  httpsServers.push(server);
}

/** Swap every running server's certificate (affects new TLS connections; no restart needed). */
export function applyCredentials(creds: TlsCredentials): void {
  for (const server of httpsServers) {
    server.setSecureContext({ key: creds.key, cert: creds.cert, ca: creds.ca });
  }
}
