import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkProject, normalizeServiceUrl, registerKey } from '../src/register.js';
import { VERSION } from '../src/version.js';
import { fakeService, type FakeService } from './helpers.js';

let service: FakeService;
beforeEach(async () => {
  service = await fakeService();
});
afterEach(() => service.close());

const register = (extra = {}) =>
  registerKey({
    serviceUrl: service.url,
    projectId: 'my project',
    deployToken: 'gcd_token',
    keyId: 'kid',
    key: 'rawkey',
    retryDelayMs: 1,
    ...extra,
  });

describe('registerKey', () => {
  it('posts the key with the deploy token as bearer, says which version it is, and returns what it is told', async () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(await register()).toEqual({ name: 'Fixture', origins: ['https://fixture.example'] });
    expect(service.requests).toEqual([
      {
        method: 'POST',
        path: '/v1/projects/my%20project/keys',
        authorization: 'Bearer gcd_token',
        userAgent: `gatecrypt/${VERSION}`,
        body: { keyId: 'kid', key: 'rawkey', version: VERSION },
      },
    ]);
  });

  it('copes with a service that says nothing about the project', async () => {
    service.project = {};
    expect(await register()).toEqual({ name: undefined, origins: undefined });
  });

  it('points at the service address and version when the endpoint is missing', async () => {
    service.statuses = [404];
    await expect(register()).rejects.toThrow(/answered 404 .*this version of gatecrypt/);
    expect(service.requests).toHaveLength(1);
  });

  it('explains a rejected token and does not retry it', async () => {
    service.statuses = [401];
    await expect(register()).rejects.toThrow(/answered 401 \(test_error\)\. Check the deploy token/);
    expect(service.requests).toHaveLength(1);
  });

  it('retries server errors, then succeeds', async () => {
    service.statuses = [500, 503];
    await register();
    expect(service.requests).toHaveLength(3);
  });

  it('gives up after the configured attempts', async () => {
    service.statuses = [500, 500, 500];
    await expect(register()).rejects.toThrow('answered 500');
    expect(service.requests).toHaveLength(3);
  });

  it('reports an unreachable service', async () => {
    await service.close();
    await expect(register({ attempts: 1 })).rejects.toThrow('could not reach');
  });
});

describe('checkProject', () => {
  it('asks without registering anything', async () => {
    const project = await checkProject({ serviceUrl: service.url, projectId: 'p1', deployToken: 'gcd_token' });
    expect(project).toEqual({ name: 'Fixture', origins: ['https://fixture.example'] });
    expect(service.requests).toMatchObject([{ method: 'GET', path: '/v1/projects/p1/check', authorization: 'Bearer gcd_token' }]);
    expect(service.requests[0]!.body).toBeUndefined();
  });

  it('explains a token that does not work', async () => {
    service.statuses = [401];
    await expect(checkProject({ serviceUrl: service.url, projectId: 'p1', deployToken: 'bad' })).rejects.toThrow(
      /could not check the project: .* answered 401 .*Check the deploy token/,
    );
  });
});

describe('normalizeServiceUrl', () => {
  it('reduces to an origin', () => {
    expect(normalizeServiceUrl('https://gate.example.com/')).toBe('https://gate.example.com');
    expect(normalizeServiceUrl('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServiceUrl('http://127.0.0.1:8787/')).toBe('http://127.0.0.1:8787');
  });
  it.each(['gate.example.com', 'http://gate.example.com', 'https://gate.example.com/api', 'https://x.example/?a=1'])(
    'rejects %s',
    (url) => {
      expect(() => normalizeServiceUrl(url)).toThrow('serviceUrl');
    },
  );
});
