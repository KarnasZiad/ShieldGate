import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixedClock } from '../../lib/clock.js';
import { InMemoryPolicyRepository } from '../../testing/in-memory-policies.js';
import {
  createTestApp,
  createUser,
  signIn,
  type SignedIn,
  type TestContext,
} from '../../testing/test-app.js';
import { PolicySchema } from './policy.js';
import { CachedPolicySource } from './policy-repository.js';

const approveInvoices = {
  description: 'Accountants approve invoices',
  effect: 'allow',
  actions: ['invoice:approve'],
  resources: ['invoice:*'],
  roles: ['accountant'],
};

const noSelfApproval = {
  effect: 'deny',
  actions: ['invoice:approve'],
  resources: ['invoice:*'],
  condition: { equals: [{ ref: 'resource.attributes.ownerId' }, { ref: 'subject.id' }] },
};

function decisionRequest(ownerId: string) {
  return {
    subject: { id: 'u-42', roles: ['accountant'] },
    action: 'invoice:approve',
    resource: { type: 'invoice', id: 'inv-7', attributes: { ownerId } },
  };
}

describe('policy decision point (HTTP)', () => {
  let context: TestContext;
  let admin: SignedIn;
  let analyst: SignedIn;
  let apiKey: string;

  beforeEach(async () => {
    context = await createTestApp();
    await createUser(context, { email: 'admin@shieldgate.ma', roles: ['admin'] });
    await createUser(context, { email: 'analyst@shieldgate.ma', roles: ['security-analyst'] });
    admin = await signIn(context, 'admin@shieldgate.ma');
    analyst = await signIn(context, 'analyst@shieldgate.ma');
    apiKey = (
      await context.app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        headers: admin.headers,
        payload: { name: 'Invoicing app', scopes: ['authorize'] },
      })
    ).json<{ key: string }>().key;
  });

  afterEach(async () => {
    await context.app.close();
  });

  function putPolicy(id: string, body: object, as = admin) {
    return context.app.inject({
      method: 'PUT',
      url: `/v1/policies/${id}`,
      headers: as.headers,
      payload: body,
    });
  }

  function authorize(body: object, token = apiKey) {
    return context.app.inject({
      method: 'POST',
      url: '/v1/authorize',
      headers: { authorization: `Bearer ${token}` },
      payload: body,
    });
  }

  it('denies by default, then follows the stored policies with deny overriding allow', async () => {
    expect((await authorize(decisionRequest('u-7'))).json()).toEqual({
      decision: 'deny',
      policyId: null,
      reason: 'no_matching_policy',
    });

    expect((await putPolicy('approve-invoices', approveInvoices)).statusCode).toBe(201);
    expect((await putPolicy('no-self-approval', noSelfApproval)).statusCode).toBe(201);

    expect((await authorize(decisionRequest('u-7'))).json()).toMatchObject({
      decision: 'allow',
      policyId: 'approve-invoices',
    });
    expect((await authorize(decisionRequest('u-42'))).json()).toMatchObject({
      decision: 'deny',
      policyId: 'no-self-approval',
    });
  });

  it('audits every decision with the client application', async () => {
    await authorize(decisionRequest('u-7'));
    await context.audit.flush();

    expect(context.auditStore.events.at(-1)).toMatchObject({
      event: { action: 'authz.decision', outcome: 'failure', reason: 'no_matching_policy' },
      user: { id: 'u-42' },
      labels: {
        decision: 'deny',
        action: 'invoice:approve',
        resource: 'invoice:inv-7',
        client: 'Invoicing app',
      },
    });
  });

  it('lets a console user with authz:evaluate test a request, not others', async () => {
    const asAdmin = await context.app.inject({
      method: 'POST',
      url: '/v1/authorize',
      headers: admin.headers,
      payload: decisionRequest('u-7'),
    });
    const asAnalyst = await context.app.inject({
      method: 'POST',
      url: '/v1/authorize',
      headers: analyst.headers,
      payload: decisionRequest('u-7'),
    });
    const anonymous = await context.app.inject({
      method: 'POST',
      url: '/v1/authorize',
      payload: decisionRequest('u-7'),
    });

    expect(asAdmin.statusCode).toBe(200);
    expect(asAnalyst.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
  });

  it('validates policies and requests strictly', async () => {
    const unknownOperator = await putPolicy('bad', {
      ...approveInvoices,
      condition: { eval: 'process.exit()' },
    });
    const badRequest = await authorize({ ...decisionRequest('u-7'), action: 'invoice:*' });

    expect(unknownOperator.statusCode).toBe(400);
    expect(badRequest.statusCode).toBe(400);
  });

  it('restricts policy management to policies:write and audits changes', async () => {
    expect((await putPolicy('approve-invoices', approveInvoices, analyst)).statusCode).toBe(403);
    expect(
      (await context.app.inject({ method: 'GET', url: '/v1/policies', headers: analyst.headers }))
        .statusCode,
    ).toBe(200);

    await putPolicy('approve-invoices', approveInvoices);
    expect(
      (await putPolicy('approve-invoices', { ...approveInvoices, roles: ['manager'] })).statusCode,
    ).toBe(200);
    const deleted = await context.app.inject({
      method: 'DELETE',
      url: '/v1/policies/approve-invoices',
      headers: admin.headers,
    });
    const missing = await context.app.inject({
      method: 'DELETE',
      url: '/v1/policies/approve-invoices',
      headers: admin.headers,
    });
    await context.audit.flush();

    expect(deleted.statusCode).toBe(204);
    expect(missing.statusCode).toBe(404);
    expect(
      context.auditStore.events
        .filter((event) => event.event.action === 'policy.changed')
        .map((event) => event.labels?.change),
    ).toEqual(['created', 'updated', 'deleted']);
  });
});

describe('CachedPolicySource', () => {
  it('serves policies from memory for a few seconds, then reloads', async () => {
    const repository = new InMemoryPolicyRepository();
    const clock = new FixedClock(0);
    const source = new CachedPolicySource(repository, clock, 5_000);
    await repository.upsert(PolicySchema.parse({ id: 'p1', ...approveInvoices }));

    await source.all();
    await source.all();
    expect(repository.reads).toBe(1);

    clock.advance(5_000);
    await source.all();
    expect(repository.reads).toBe(2);

    source.invalidate();
    await source.all();
    expect(repository.reads).toBe(3);
  });
});
