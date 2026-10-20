import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedClock } from '../../lib/clock.js';
import { HttpProblem } from '../../lib/problem.js';
import { InMemoryAuditStore } from '../../testing/in-memory-audit-store.js';
import { InMemoryUserRepository } from '../../testing/in-memory-users.js';
import { AuditLogger } from '../audit/audit-logger.js';
import type { PasswordHasher } from './password-hasher.js';
import { type Actor, type SessionRevoker, UsersService } from './users.service.js';

const actor: Actor = {
  id: 'admin-id',
  email: 'admin@shieldgate.ma',
  ip: '10.0.0.1',
  requestId: 'req-1',
};
const strongPassword = 'le thé à la menthe de grand-mère';

describe('UsersService', () => {
  let users: InMemoryUserRepository;
  let auditStore: InMemoryAuditStore;
  let audit: AuditLogger;
  let sessions: SessionRevoker & { revokeAllForUser: ReturnType<typeof vi.fn> };
  let service: UsersService;

  const hasher = {
    hash: (password: string) => Promise.resolve(`hashed:${password}`),
  } as unknown as PasswordHasher;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    auditStore = new InMemoryAuditStore();
    audit = new AuditLogger(auditStore, new FixedClock(0));
    sessions = { revokeAllForUser: vi.fn(() => Promise.resolve(2)) };
    service = new UsersService(users, hasher, sessions, audit);
  });

  async function createAmina() {
    return service.create(
      {
        email: 'amina@exemple.ma',
        displayName: 'Amina Benali',
        password: strongPassword,
        roles: ['member'],
      },
      actor,
    );
  }

  it('creates an account with a hashed password and audits it', async () => {
    const user = await createAmina();
    await audit.flush();

    expect(user).toMatchObject({ email: 'amina@exemple.ma', roles: ['member'], status: 'active' });
    expect(user.passwordHash).toBe(`hashed:${strongPassword}`);
    expect(auditStore.events[0]).toMatchObject({
      event: { action: 'user.created', outcome: 'success' },
      user: { id: 'admin-id', target: { id: user.id, email: 'amina@exemple.ma' } },
      source: { ip: '10.0.0.1' },
      trace: { id: 'req-1' },
    });
  });

  it('refuses a password that breaks the policy and says why', async () => {
    const error = await service
      .create(
        { email: 'amina@exemple.ma', displayName: 'Amina', password: 'Password1234', roles: [] },
        actor,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpProblem);
    expect(error).toMatchObject({ status: 422, extensions: { problems: ['common'] } });
  });

  it('reports a taken e-mail and unknown roles', async () => {
    await createAmina();

    await expect(createAmina()).rejects.toMatchObject({ status: 409 });
    await expect(
      service.create(
        {
          email: 'other@exemple.ma',
          displayName: 'Other',
          password: strongPassword,
          roles: ['root'],
        },
        actor,
      ),
    ).rejects.toMatchObject({ status: 422, extensions: { roles: ['root'] } });
  });

  it('logs the user out everywhere when the account is disabled', async () => {
    const user = await createAmina();

    const updated = await service.update(user.id, { status: 'disabled' }, actor);

    expect(updated.status).toBe('disabled');
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
  });

  it('logs the user out everywhere when the roles change', async () => {
    const user = await createAmina();

    const updated = await service.update(user.id, { roles: ['security-analyst'] }, actor);
    await audit.flush();

    expect(updated.roles).toEqual(['security-analyst']);
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(user.id);
    expect(auditStore.events.at(-1)).toMatchObject({
      event: { action: 'user.updated' },
      labels: { changes: 'roles', roles: 'security-analyst' },
    });
  });

  it('keeps sessions when only the display name changes', async () => {
    const user = await createAmina();

    await service.update(user.id, { displayName: 'Amina B.' }, actor);

    expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('prevents administrators from disabling themselves or changing their own roles', async () => {
    await expect(service.update(actor.id, { status: 'disabled' }, actor)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.update(actor.id, { roles: [] }, actor)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('returns 404 for unknown accounts', async () => {
    await expect(service.get('missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.update('missing', { displayName: 'x' }, actor)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lists accounts newest first with a cursor', async () => {
    await createAmina();
    await service.create(
      { email: 'youssef@exemple.ma', displayName: 'Youssef', password: strongPassword, roles: [] },
      actor,
    );

    const first = await service.list({ limit: 1 });
    const second = await service.list({ limit: 1, cursor: first.nextCursor ?? '' });

    expect(first.items.map((user) => user.email)).toEqual(['youssef@exemple.ma']);
    expect(second.items.map((user) => user.email)).toEqual(['amina@exemple.ma']);
    expect(second.nextCursor).toBeNull();
  });
});
