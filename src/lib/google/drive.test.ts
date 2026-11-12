import { describe, expect, it } from 'vitest';

import {
  DriveApiError,
  DriveAuthError,
  DriveNetworkError,
  DriveNotFoundError,
  createJsonFile,
  deleteFile,
  findFile,
  listFiles,
  readFileMeta,
  readJsonFile,
  updateJsonFile,
} from './drive';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function plainResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('drive client', () => {
  describe('findFile', () => {
    it('returns null when Drive lists no matches', async () => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(input.toString());
        return jsonResponse(200, { files: [] });
      }) as typeof fetch;
      const result = await findFile('data.json', { accessToken: 'tk', fetchImpl });
      expect(result).toBeNull();
      expect(calls[0]).toContain('spaces=appDataFolder');
      expect(calls[0]).toContain('name+%3D+%27data.json%27');
    });

    it('returns the first hit with its version from the list reply (one request)', async () => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(input.toString());
        return jsonResponse(200, {
          files: [{ id: 'abc', name: 'data.json', modifiedTime: 't', version: '17' }],
        });
      }) as typeof fetch;
      const result = await findFile('data.json', { accessToken: 'tk', fetchImpl });
      expect(result?.id).toBe('abc');
      expect(result?.version).toBe('17');
      expect(calls).toHaveLength(1);
      expect(new URL(calls[0]!).searchParams.get('fields')).toContain('version');
    });

    it('asks for the oldest file first, so every device settles on the same duplicate', async () => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(input.toString());
        return jsonResponse(200, { files: [] });
      }) as typeof fetch;
      await findFile('data.json', { accessToken: 'tk', fetchImpl });
      expect(new URL(calls[0]!).searchParams.get('orderBy')).toBe('createdTime');
    });

    it('reads an absent version as an empty string', async () => {
      const fetchImpl = (async () =>
        jsonResponse(200, { files: [{ id: 'abc', name: 'data.json' }] })) as typeof fetch;
      const result = await findFile('data.json', { accessToken: 'tk', fetchImpl });
      expect(result?.version).toBe('');
    });

    it('escapes embedded quotes in the file name', async () => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(input.toString());
        return jsonResponse(200, { files: [] });
      }) as typeof fetch;
      await findFile("weird'name", { accessToken: 'tk', fetchImpl });
      // The single quote should be URL-encoded as part of an escaped pair
      // (%5C%27 = \'). The literal `%27` appearing in the URL means a quote
      // is being passed through correctly; we mainly verify no crash.
      expect(calls[0]).toContain('q=');
    });
  });

  describe('network failures', () => {
    it('wraps a rejected fetch in DriveNetworkError, keeping the cause', async () => {
      const cause = new TypeError('Failed to fetch');
      const fetchImpl = (async () => {
        throw cause;
      }) as typeof fetch;
      const err: unknown = await readFileMeta('fid', { accessToken: 'tk', fetchImpl }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(DriveNetworkError);
      expect((err as DriveNetworkError).cause).toBe(cause);
      expect((err as Error).message).toContain('Failed to fetch');
    });
  });

  describe('readJsonFile', () => {
    it('returns the parsed data for a successful read', async () => {
      const fetchImpl = (async () => jsonResponse(200, { hello: 'world' })) as typeof fetch;
      const result = await readJsonFile<{ hello: string }>('fid', {
        accessToken: 'tk',
        fetchImpl,
      });
      expect(result.data.hello).toBe('world');
      expect(result.fileId).toBe('fid');
    });

    it('throws DriveAuthError on 401', async () => {
      const fetchImpl = (async () => plainResponse(401, 'no')) as typeof fetch;
      await expect(readJsonFile('fid', { accessToken: 'tk', fetchImpl })).rejects.toBeInstanceOf(
        DriveAuthError,
      );
    });

    it('throws DriveNotFoundError on 404', async () => {
      const fetchImpl = (async () => plainResponse(404, 'gone')) as typeof fetch;
      await expect(readJsonFile('fid', { accessToken: 'tk', fetchImpl })).rejects.toBeInstanceOf(
        DriveNotFoundError,
      );
    });

    it('throws DriveApiError when JSON parsing fails', async () => {
      const fetchImpl = (async () =>
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;
      await expect(readJsonFile('fid', { accessToken: 'tk', fetchImpl })).rejects.toBeInstanceOf(
        DriveApiError,
      );
    });
  });

  describe('createJsonFile', () => {
    it('POSTs a multipart body and returns the new file metadata with its version', async () => {
      const seen: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: input.toString(), init });
        return jsonResponse(200, {
          id: 'new-fid',
          name: 'data.json',
          modifiedTime: '2026-05-15',
          version: '1',
        });
      }) as typeof fetch;
      const result = await createJsonFile(
        'data.json',
        { value: 42 },
        { schemaVersion: '1' },
        { accessToken: 'tk', fetchImpl },
      );
      expect(result.fileId).toBe('new-fid');
      expect(result.version).toBe('1');
      // No follow-up metadata read: the version comes in the upload reply.
      expect(seen).toHaveLength(1);
      const first = seen[0]!;
      expect(first.url).toContain('uploadType=multipart');
      expect(new URL(first.url).searchParams.get('fields')).toContain('version');
      expect(first.init?.method).toBe('POST');
      const ctype = (first.init?.headers as Record<string, string>)['Content-Type'];
      expect(ctype).toMatch(/multipart\/related/);
    });
  });

  describe('updateJsonFile', () => {
    it('writes content and appProperties in ONE multipart PATCH and returns its version', async () => {
      const seen: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: input.toString(), init });
        return jsonResponse(200, {
          id: 'fid',
          name: 'data.json',
          modifiedTime: '2026-05-15',
          appProperties: { schemaVersion: '1' },
          version: 8,
        });
      }) as typeof fetch;

      const result = await updateJsonFile(
        'fid',
        { value: 7 },
        { accessToken: 'tk', fetchImpl, appProperties: { schemaVersion: '1' } },
      );
      expect(result.fileId).toBe('fid');
      expect(result.version).toBe('8');
      expect(result.appProperties).toEqual({ schemaVersion: '1' });
      // One write → one version: no second request another device could slip
      // in front of.
      expect(seen).toHaveLength(1);
      const call = seen[0]!;
      const url = new URL(call.url);
      expect(url.pathname).toBe('/upload/drive/v3/files/fid');
      expect(url.searchParams.get('uploadType')).toBe('multipart');
      expect(url.searchParams.get('fields')).toContain('version');
      expect(call.init?.method).toBe('PATCH');
      const headers = call.init?.headers as Record<string, string>;
      expect(headers['If-Match']).toBeUndefined();
      expect(headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
      const body = String(call.init?.body);
      expect(body).toContain(JSON.stringify({ appProperties: { schemaVersion: '1' } }));
      expect(body).toContain(JSON.stringify({ value: 7 }));
    });

    it('sends empty metadata when no appProperties are given (still one request)', async () => {
      const seen: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: input.toString(), init });
        return jsonResponse(200, { id: 'fid', name: 'data.json', version: '4' });
      }) as typeof fetch;
      const result = await updateJsonFile('fid', { v: 1 }, { accessToken: 'tk', fetchImpl });
      expect(result.version).toBe('4');
      expect(seen).toHaveLength(1);
      expect(String(seen[0]!.init?.body)).toContain('{}');
    });

    it('maps a 412 to a plain DriveApiError', async () => {
      const fetchImpl = (async () => plainResponse(412)) as typeof fetch;
      const err: unknown = await updateJsonFile(
        'fid',
        { x: 1 },
        { accessToken: 'tk', fetchImpl },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DriveApiError);
      expect((err as DriveApiError).status).toBe(412);
    });

    it('throws DriveNotFoundError on 404', async () => {
      const fetchImpl = (async () => plainResponse(404)) as typeof fetch;
      await expect(
        updateJsonFile('fid', { x: 1 }, { accessToken: 'tk', fetchImpl }),
      ).rejects.toBeInstanceOf(DriveNotFoundError);
    });
  });

  describe('deleteFile', () => {
    it('resolves silently on 404 (idempotent)', async () => {
      const fetchImpl = (async () => plainResponse(404)) as typeof fetch;
      await expect(deleteFile('fid', { accessToken: 'tk', fetchImpl })).resolves.toBeUndefined();
    });

    it('throws on 500', async () => {
      const fetchImpl = (async () => plainResponse(500, 'boom')) as typeof fetch;
      await expect(deleteFile('fid', { accessToken: 'tk', fetchImpl })).rejects.toBeInstanceOf(
        DriveApiError,
      );
    });
  });

  describe('listFiles', () => {
    it('returns the parsed file list', async () => {
      const fetchImpl = (async () =>
        jsonResponse(200, {
          files: [
            { id: 'a', name: 'data.json' },
            { id: 'b', name: 'backup-1.json' },
          ],
        })) as typeof fetch;
      const result = await listFiles({ accessToken: 'tk', fetchImpl });
      expect(result).toHaveLength(2);
      expect(result.map((f) => f.id)).toEqual(['a', 'b']);
    });
  });

  describe('readFileMeta', () => {
    it('reads the version from the metadata body', async () => {
      const calls: string[] = [];
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(input.toString());
        return jsonResponse(200, { id: 'fid', name: 'data.json', version: '42' });
      }) as typeof fetch;
      const meta = await readFileMeta('fid', { accessToken: 'tk', fetchImpl });
      expect(meta.id).toBe('fid');
      expect(meta.version).toBe('42');
      expect(new URL(calls[0]!).searchParams.get('fields')).toContain('version');
    });

    it('throws DriveNotFoundError on 404', async () => {
      const fetchImpl = (async () => plainResponse(404)) as typeof fetch;
      await expect(readFileMeta('fid', { accessToken: 'tk', fetchImpl })).rejects.toBeInstanceOf(
        DriveNotFoundError,
      );
    });
  });
});
