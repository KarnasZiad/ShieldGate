import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../lib/clock.js';
import {
  type AuthorizationRequest,
  AuthorizationRequestSchema,
  type Policy,
  PolicySchema,
} from './policy.js';
import { matchesPattern, PolicyEngine, rolePolicies } from './policy-engine.js';

const engine = new PolicyEngine(new FixedClock(Date.parse('2026-10-20T09:30:00Z')));

function policy(input: Record<string, unknown>): Policy {
  return PolicySchema.parse({ id: 'test-policy', ...input });
}

function request(overrides: Record<string, unknown> = {}): AuthorizationRequest {
  return AuthorizationRequestSchema.parse({
    subject: { id: 'u-42', roles: ['accountant'], attributes: { department: 'finance', level: 3 } },
    action: 'invoice:approve',
    resource: { type: 'invoice', id: 'inv-7', attributes: { ownerId: 'u-7', amount: 12_000 } },
    context: { ip: '10.0.4.12' },
    ...overrides,
  });
}

const accountantsApprove = policy({
  id: 'accountants-approve',
  effect: 'allow',
  actions: ['invoice:approve'],
  resources: ['invoice:*'],
  roles: ['accountant'],
});

const noSelfApproval = policy({
  id: 'no-self-approval',
  effect: 'deny',
  actions: ['invoice:approve'],
  resources: ['invoice:*'],
  condition: { equals: [{ ref: 'resource.attributes.ownerId' }, { ref: 'subject.id' }] },
});

describe('matchesPattern', () => {
  it.each([
    ['*', 'invoice:approve', true],
    ['invoice:*', 'invoice:approve', true],
    ['invoice:approve', 'invoice:approve', true],
    ['invoice:approve', 'invoice:delete', false],
    ['invoice:*', 'payment:approve', false],
    ['invoice', 'invoice:approve', false],
  ])('%s matches %s: %s', (pattern, value, expected) => {
    expect(matchesPattern(pattern, value)).toBe(expected);
  });
});

describe('PolicyEngine', () => {
  it('denies by default', () => {
    expect(engine.evaluate(request(), [])).toEqual({
      decision: 'deny',
      policyId: null,
      reason: 'no_matching_policy',
    });
  });

  it('allows through a matching role policy', () => {
    expect(engine.evaluate(request(), [accountantsApprove])).toEqual({
      decision: 'allow',
      policyId: 'accountants-approve',
      reason: 'allow_policy',
    });
  });

  it('ignores policies for other roles, actions or resources', () => {
    const others = [
      { ...accountantsApprove, roles: ['manager'] },
      { ...accountantsApprove, actions: ['invoice:read'] },
      { ...accountantsApprove, resources: ['payment:*'] },
      { ...accountantsApprove, resources: ['invoice:inv-8'] },
    ];

    for (const other of others) {
      expect(engine.evaluate(request(), [other]).decision).toBe('deny');
    }
  });

  it('lets a matching deny override any allow, whatever the order', () => {
    const selfApproval = request({
      resource: { type: 'invoice', id: 'inv-7', attributes: { ownerId: 'u-42' } },
    });

    expect(engine.evaluate(selfApproval, [accountantsApprove, noSelfApproval])).toMatchObject({
      decision: 'deny',
      policyId: 'no-self-approval',
    });
    expect(engine.evaluate(selfApproval, [noSelfApproval, accountantsApprove]).decision).toBe(
      'deny',
    );
    expect(engine.evaluate(request(), [accountantsApprove, noSelfApproval]).decision).toBe('allow');
  });

  describe('missing attributes always resolve toward denial', () => {
    const noOwner = request({ resource: { type: 'invoice', id: 'inv-7', attributes: {} } });

    it('cannot satisfy an allow condition', () => {
      const ownerOnly = policy({
        effect: 'allow',
        actions: ['invoice:approve'],
        resources: ['*'],
        condition: { not: { equals: [{ ref: 'resource.attributes.ownerId' }, 'nobody'] } },
      });

      expect(engine.evaluate(noOwner, [ownerOnly]).decision).toBe('deny');
    });

    it('cannot bypass a deny condition', () => {
      expect(engine.evaluate(noOwner, [accountantsApprove, noSelfApproval])).toMatchObject({
        decision: 'deny',
        policyId: 'no-self-approval',
      });
    });
  });

  it('never reads inherited properties through references', () => {
    expect(() =>
      policy({
        effect: 'allow',
        actions: ['*'],
        resources: ['*'],
        condition: { equals: [{ ref: 'subject.__proto__' }, 'x'] },
      }),
    ).toThrow();

    const constructorRef = policy({
      effect: 'allow',
      actions: ['*'],
      resources: ['*'],
      condition: { equals: [{ ref: 'subject.attributes.constructor' }, 'x'] },
    });
    expect(engine.evaluate(request(), [constructorRef]).decision).toBe('deny');
  });

  describe('operators', () => {
    const allowWhen = (condition: unknown) =>
      policy({ effect: 'allow', actions: ['*'], resources: ['*'], condition });
    const decide = (condition: unknown, overrides: Record<string, unknown> = {}) =>
      engine.evaluate(request(overrides), [allowWhen(condition)]).decision;

    it.each([
      [{ equals: [{ ref: 'subject.attributes.department' }, 'finance'] }, 'allow'],
      [{ equals: [{ ref: 'subject.attributes.department' }, 'sales'] }, 'deny'],
      [{ equals: [{ ref: 'subject.attributes.level' }, '3'] }, 'deny'],
      [{ in: [{ ref: 'subject.attributes.department' }, ['finance', 'audit']] }, 'allow'],
      [{ in: [{ ref: 'subject.attributes.department' }, ['sales']] }, 'deny'],
      [{ greaterThan: [{ ref: 'resource.attributes.amount' }, 10_000] }, 'allow'],
      [{ lessThan: [{ ref: 'resource.attributes.amount' }, 10_000] }, 'deny'],
      [{ greaterThan: [{ ref: 'subject.attributes.department' }, 1] }, 'deny'],
      [{ ipInCidr: [{ ref: 'context.ip' }, '10.0.0.0/8'] }, 'allow'],
      [{ ipInCidr: [{ ref: 'context.ip' }, '192.168.0.0/16'] }, 'deny'],
      [{ timeBetween: ['08:00', '18:00'] }, 'allow'],
      [{ timeBetween: ['18:00', '08:00'] }, 'deny'],
      [
        { all: [{ equals: [{ ref: 'subject.id' }, 'u-42'] }, { timeBetween: ['09:00', '10:00'] }] },
        'allow',
      ],
      [
        { all: [{ equals: [{ ref: 'subject.id' }, 'u-42'] }, { timeBetween: ['10:00', '11:00'] }] },
        'deny',
      ],
      [{ any: [{ equals: [{ ref: 'subject.id' }, 'nobody'] }, { equals: [true, true] }] }, 'allow'],
      [{ any: [{ equals: [{ ref: 'subject.id' }, 'nobody'] }, { equals: [1, 2] }] }, 'deny'],
      [{ not: { equals: [{ ref: 'subject.id' }, 'nobody'] } }, 'allow'],
    ])('%j → %s', (condition, expected) => {
      expect(decide(condition)).toBe(expected);
    });

    it('handles time ranges crossing midnight', () => {
      const night = { timeBetween: ['22:00', '06:00'] };

      expect(decide(night, { context: { time: '2026-10-20T23:15:00Z' } })).toBe('allow');
      expect(decide(night, { context: { time: '2026-10-20T05:59:00Z' } })).toBe('allow');
      expect(decide(night, { context: { time: '2026-10-20T12:00:00Z' } })).toBe('deny');
    });

    it('treats unknown inside all/any as unknown', () => {
      const unknown = { equals: [{ ref: 'subject.attributes.missing' }, 'x'] };

      expect(decide({ all: [{ equals: [1, 1] }, unknown] })).toBe('deny');
      expect(decide({ any: [{ equals: [1, 2] }, unknown] })).toBe('deny');
      expect(decide({ any: [{ equals: [1, 1] }, unknown] })).toBe('allow');
      expect(decide({ all: [{ equals: [1, 2] }, unknown] })).toBe('deny');
      expect(decide({ in: [{ ref: 'subject.attributes.missing' }, ['x']] })).toBe('deny');
      expect(decide({ ipInCidr: [{ ref: 'context.missing' }, '10.0.0.0/8'] })).toBe('deny');
    });
  });
});

describe('policy validation', () => {
  it.each([
    ['an unknown operator', { condition: { matches: ['x', 'y'] } }],
    ['an action pattern with code', { actions: ['invoice:approve; drop'] }],
    ['an extra property', { priority: 1 }],
    ['an invalid time', { condition: { timeBetween: ['25:00', '08:00'] } }],
    ['an empty action list', { actions: [] }],
  ])('rejects %s', (_label, overrides) => {
    expect(() =>
      policy({ effect: 'allow', actions: ['*'], resources: ['*'], ...overrides }),
    ).toThrow();
  });
});

describe('rolePolicies', () => {
  it('turns role permissions into allow policies scoped to the role', () => {
    const policies = rolePolicies([
      { name: 'admin', permissions: ['*'] },
      { name: 'security-analyst', permissions: ['audit:read'] },
      { name: 'member', permissions: [] },
    ]);

    expect(policies.map((item) => item.id)).toEqual(['role-admin', 'role-security-analyst']);
    const analyst = request({
      subject: { id: 'u-1', roles: ['security-analyst'] },
      action: 'audit:read',
    });
    expect(engine.evaluate(analyst, policies).decision).toBe('allow');
    expect(engine.evaluate({ ...analyst, action: 'users:write' }, policies).decision).toBe('deny');
  });
});
