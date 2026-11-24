import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  decryptBlob,
  encryptBlob,
  fileAad,
  importKey,
  indexAad,
  parseManifest,
  proofInput,
  renewInput,
} from '../src/format.js';

const rawKey = () => crypto.getRandomValues(new Uint8Array(32));
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

describe('encryptBlob / decryptBlob', () => {
  it('round-trips text and binary data', async () => {
    const key = await importKey(rawKey(), ['encrypt', 'decrypt']);
    const aad = fileAad('k1', 'assets/app.js');
    const blob = await encryptBlob(key, bytes('console.log("hi")'), aad);
    expect(text(await decryptBlob(key, blob, aad))).toBe('console.log("hi")');

    const binary = crypto.getRandomValues(new Uint8Array(65_536));
    const out = new Uint8Array(await decryptBlob(key, await encryptBlob(key, binary, aad), aad));
    expect(out).toEqual(binary);
  });

  it('round-trips an empty file', async () => {
    const key = await importKey(rawKey(), ['encrypt', 'decrypt']);
    const blob = await encryptBlob(key, new Uint8Array(0), fileAad('k', 'empty.txt'));
    expect((await decryptBlob(key, blob, fileAad('k', 'empty.txt'))).byteLength).toBe(0);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', async () => {
    const key = await importKey(rawKey(), ['encrypt', 'decrypt']);
    const blob = await encryptBlob(key, bytes('x'), indexAad('k'));
    expect(text(await decryptBlob(key, blob.buffer, indexAad('k')))).toBe('x');
  });

  it('writes the magic and a fresh IV per blob, and no plaintext', async () => {
    const key = await importKey(rawKey(), ['encrypt', 'decrypt']);
    const aad = fileAad('k', 'a');
    const plain = bytes('MARKER-MARKER-MARKER');
    const a = await encryptBlob(key, plain, aad);
    const b = await encryptBlob(key, plain, aad);
    expect(text(a.slice(0, 4).buffer)).toBe('GCE1');
    expect(a.slice(4, 16)).not.toEqual(b.slice(4, 16));
    expect(a).not.toEqual(b);
    expect(a.byteLength).toBe(4 + 12 + plain.byteLength + 16);
    expect(Buffer.from(a).includes('MARKER')).toBe(false);
  });

  it('rejects the wrong key', async () => {
    const key = await importKey(rawKey(), ['encrypt', 'decrypt']);
    const other = await importKey(rawKey(), ['decrypt']);
    const blob = await encryptBlob(key, bytes('secret'), fileAad('k', 'a'));
    await expect(decryptBlob(other, blob, fileAad('k', 'a'))).rejects.toThrow();
  });

  it('rejects a blob served under another path or build', async () => {
    const key = await importKey(rawKey(), ['encrypt', 'decrypt']);
    const blob = await encryptBlob(key, bytes('secret'), fileAad('k1', 'a.js'));
    await expect(decryptBlob(key, blob, fileAad('k1', 'b.js'))).rejects.toThrow();
    await expect(decryptBlob(key, blob, fileAad('k2', 'a.js'))).rejects.toThrow();
    await expect(decryptBlob(key, blob, indexAad('k1'))).rejects.toThrow();
  });

  it('rejects tampered, truncated and foreign data', async () => {
    const key = await importKey(rawKey(), ['encrypt', 'decrypt']);
    const aad = fileAad('k', 'a');
    const blob = await encryptBlob(key, bytes('secret'), aad);
    for (const i of [4, 16, blob.length - 1]) {
      const bad = blob.slice();
      bad[i]! ^= 1;
      await expect(decryptBlob(key, bad, aad)).rejects.toThrow();
    }
    await expect(decryptBlob(key, blob.slice(0, 20), aad)).rejects.toThrow('not an encrypted blob');
    await expect(decryptBlob(key, bytes('<!doctype html><html>plain page</html>'), aad)).rejects.toThrow(
      'not an encrypted blob',
    );
  });

  it('imports keys as non-extractable and insists on 32 bytes', async () => {
    const key = await importKey(rawKey(), ['decrypt']);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    expect(() => importKey(new Uint8Array(16), ['decrypt'])).toThrow('32 bytes');
  });
});

describe('base64url', () => {
  it('round-trips and uses the URL-safe alphabet without padding', () => {
    const data = new Uint8Array([251, 255, 254, 0, 1]);
    const encoded = b64urlEncode(data);
    expect(encoded).toBe('-__-AAE');
    expect(b64urlDecode(encoded)).toEqual(data);
  });
  it('rejects other characters', () => {
    expect(() => b64urlDecode('ab+/')).toThrow();
    expect(() => b64urlDecode('ab=')).toThrow();
  });
});

describe('parseManifest', () => {
  const good = {
    v: 1,
    projectId: 'p',
    keyId: 'k',
    service: 'https://gate.example',
    index: 'gatecrypt/0123456789abcdef0123456789abcdef.bin',
  };
  it('accepts a valid manifest and drops unknown fields', () => {
    expect(parseManifest({ ...good, extra: 1 })).toEqual(good);
  });
  it.each([
    null,
    'x',
    { ...good, v: 2 },
    { ...good, keyId: 5 },
    { ...good, service: 'javascript:alert(1)' },
    { ...good, service: 'https://gate.example/path' },
    { ...good, index: '../secrets.bin' },
    { ...good, index: 'https://evil.example/x.bin' },
    { ...good, index: 'gatecrypt/../../x.bin' },
  ])('rejects %j', (bad) => {
    expect(() => parseManifest(bad)).toThrow('invalid manifest');
  });
});

describe('what a browser signs', () => {
  it('for a token and for a newer build, as PROTOCOL.md writes them, never the same text', () => {
    expect(text(proofInput('G', 'C').buffer)).toBe('gatecrypt/v1/token\nG\nC');
    expect(text(renewInput('G', 'C', 'K').buffer)).toBe('gatecrypt/v1/renew\nG\nC\nK');
    expect(text(renewInput('G', 'C', 'K').buffer)).not.toBe(text(renewInput('G', 'C', 'L').buffer));
  });
});
