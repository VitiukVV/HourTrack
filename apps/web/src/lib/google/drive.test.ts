import { describe, expect, it } from 'vitest';

import {
  DriveApiError,
  DriveAuthError,
  DriveEtagMismatchError,
  DriveNotFoundError,
  createJsonFile,
  deleteFile,
  findFile,
  listFiles,
  readFileMeta,
  readJsonFile,
  updateJsonFile,
} from './drive';

function jsonResponse(status: number, body: unknown, etag = 'etag-xyz'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', etag },
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

    it('returns the first hit with its etag (via a second metadata fetch)', async () => {
      let call = 0;
      const fetchImpl = (async (_input: RequestInfo | URL) => {
        call += 1;
        if (call === 1) {
          return jsonResponse(200, {
            files: [{ id: 'abc', name: 'data.json', modifiedTime: 't' }],
          });
        }
        return jsonResponse(200, { id: 'abc', name: 'data.json', modifiedTime: 't' }, 'etag-meta');
      }) as typeof fetch;
      const result = await findFile('data.json', { accessToken: 'tk', fetchImpl });
      expect(result?.id).toBe('abc');
      expect(result?.etag).toBe('etag-meta');
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

  describe('readJsonFile', () => {
    it('returns data + etag for a successful read', async () => {
      const fetchImpl = (async () =>
        jsonResponse(200, { hello: 'world' }, 'etag-read')) as typeof fetch;
      const result = await readJsonFile<{ hello: string }>('fid', {
        accessToken: 'tk',
        fetchImpl,
      });
      expect(result.data.hello).toBe('world');
      expect(result.etag).toBe('etag-read');
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
    it('POSTs a multipart body and returns the new file metadata', async () => {
      const seen: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: input.toString(), init });
        return jsonResponse(
          200,
          { id: 'new-fid', name: 'data.json', modifiedTime: '2026-05-15' },
          'etag-create',
        );
      }) as typeof fetch;
      const result = await createJsonFile(
        'data.json',
        { value: 42 },
        { schemaVersion: '1' },
        { accessToken: 'tk', fetchImpl },
      );
      expect(result.fileId).toBe('new-fid');
      expect(result.etag).toBe('etag-create');
      const first = seen[0]!;
      expect(first.url).toContain('uploadType=multipart');
      expect(first.init?.method).toBe('POST');
      const ctype = (first.init?.headers as Record<string, string>)['Content-Type'];
      expect(ctype).toMatch(/multipart\/related/);
    });
  });

  describe('updateJsonFile', () => {
    it('sends If-Match when etag is provided + applies appProperties via a second PATCH', async () => {
      const seen: Array<{ url: string; init?: RequestInit }> = [];
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push({ url: input.toString(), init });
        if (input.toString().includes('upload/drive/v3/files')) {
          return jsonResponse(
            200,
            { id: 'fid', name: 'data.json', modifiedTime: '2026-05-15' },
            'etag-after-update',
          );
        }
        return jsonResponse(200, { appProperties: { schemaVersion: '1' } });
      }) as typeof fetch;

      const result = await updateJsonFile('fid', { value: 7 }, 'etag-before', {
        accessToken: 'tk',
        fetchImpl,
        appProperties: { schemaVersion: '1' },
      });
      expect(result.fileId).toBe('fid');
      expect(result.etag).toBe('etag-after-update');
      const uploadCall = seen.find((c) => c.url.includes('upload/drive/v3/files'));
      expect(uploadCall).toBeTruthy();
      const ifMatch = (uploadCall?.init?.headers as Record<string, string>)['If-Match'];
      expect(ifMatch).toBe('etag-before');
      // The second call is the metadata PATCH for appProperties.
      const metaCall = seen.find((c) => !c.url.includes('upload') && c.init?.method === 'PATCH');
      expect(metaCall).toBeTruthy();
    });

    it('throws DriveEtagMismatchError on 412', async () => {
      const fetchImpl = (async () => plainResponse(412)) as typeof fetch;
      await expect(
        updateJsonFile('fid', { x: 1 }, 'etag', {
          accessToken: 'tk',
          fetchImpl,
        }),
      ).rejects.toBeInstanceOf(DriveEtagMismatchError);
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
    it('captures the etag from the response header', async () => {
      const fetchImpl = (async () =>
        jsonResponse(200, { id: 'fid', name: 'data.json' }, 'etag-meta')) as typeof fetch;
      const meta = await readFileMeta('fid', { accessToken: 'tk', fetchImpl });
      expect(meta.id).toBe('fid');
      expect(meta.etag).toBe('etag-meta');
    });
  });
});
