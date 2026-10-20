import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, describeError } from './api';

function respond(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(response: Response, token: string | null = 'csrf-123') {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
  const onUnauthorized = vi.fn();
  const client = createApi({ csrfToken: () => token, onUnauthorized, fetchImpl });
  const headersOf = () => (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
  return { client, fetchImpl, onUnauthorized, headersOf };
}

describe('createApi', () => {
  it('sends the CSRF token on state-changing requests only', async () => {
    const write = setup(respond(201, { id: 'u1' }));
    await write.client.post('/v1/users', { email: 'a@x.ma' });
    expect(write.headersOf()['X-CSRF-Token']).toBe('csrf-123');
    expect(write.fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'same-origin',
      body: '{"email":"a@x.ma"}',
    });

    const read = setup(respond(200, []));
    await read.client.get('/v1/users');
    expect(read.headersOf()['X-CSRF-Token']).toBeUndefined();
  });

  it('turns problem details into ApiError', async () => {
    const { client } = setup(
      respond(409, { title: 'Conflict', status: 409, detail: 'Already exists' }),
    );

    const error = await client.post('/v1/users', {}).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: 'Already exists' });
  });

  it('reports a lost session', async () => {
    const { client, onUnauthorized } = setup(respond(401, { title: 'Unauthorized', status: 401 }));

    await expect(client.get('/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('handles empty and non-JSON answers', async () => {
    await expect(setup(respond(204)).client.delete('/v1/api-keys/1')).resolves.toBeUndefined();

    const html = new Response('<html>Bad gateway</html>', {
      status: 502,
      statusText: 'Bad Gateway',
    });
    await expect(setup(html).client.get('/v1/me')).rejects.toMatchObject({
      problem: { title: 'Bad Gateway' },
    });
  });

  it('supports PATCH and PUT', async () => {
    const patch = setup(respond(200, {}));
    await patch.client.patch('/v1/users/1', { status: 'disabled' });
    const put = setup(respond(200, {}));
    await put.client.put('/v1/policies/p', { effect: 'allow' });

    expect(patch.fetchImpl.mock.calls[0]?.[1]?.method).toBe('PATCH');
    expect(put.fetchImpl.mock.calls[0]?.[1]?.method).toBe('PUT');
  });
});

describe('describeError', () => {
  it('explains errors in French, with overrides and validation details', () => {
    expect(describeError(new ApiError(403, { title: 'Forbidden', status: 403 }))).toContain(
      'permission',
    );
    expect(describeError(new ApiError(429, { title: 'Too Many Requests', status: 429 }))).toContain(
      'Trop',
    );
    expect(
      describeError(new ApiError(409, { title: 'Conflict', status: 409 }), { 409: 'Déjà pris.' }),
    ).toBe('Déjà pris.');
    expect(
      describeError(
        new ApiError(400, {
          title: 'Bad Request',
          status: 400,
          errors: [{ path: 'email', message: 'Invalid email' }],
        }),
      ),
    ).toBe('email : Invalid email');
    expect(describeError(new TypeError('Failed to fetch'))).toBe('Le serveur est injoignable.');
  });
});
