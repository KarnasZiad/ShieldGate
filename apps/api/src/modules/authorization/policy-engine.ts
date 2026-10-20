import type { Clock } from '../../lib/clock.js';
import { ipInCidr } from '../../lib/ip.js';
import type { AuthorizationRequest, Condition, Operand, Policy } from './policy.js';

export interface Decision {
  decision: 'allow' | 'deny';
  policyId: string | null;
  reason: 'deny_policy' | 'allow_policy' | 'no_matching_policy';
}

/** Three-valued logic: `null` means "unknown" (a referenced attribute is missing). */
type Truth = boolean | null;

type Environment = Record<'subject' | 'resource' | 'context', unknown>;

/** "invoice:*" matches "invoice:approve"; "*" matches everything. */
export function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  const [patternType, patternId] = pattern.split(':');
  const [valueType, valueId] = value.split(':');
  return patternType === valueType && (patternId === '*' || patternId === valueId);
}

/** Own properties only: a reference can never reach Object.prototype. */
function resolve(environment: Environment, path: string): unknown {
  let current: unknown = environment;
  for (const key of path.split('.')) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function value(environment: Environment, operand: Operand): unknown {
  return typeof operand === 'object' ? resolve(environment, operand.ref) : operand;
}

function isScalar(input: unknown): input is string | number | boolean {
  return typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean';
}

function minutesOfDay(hourMinute: string): number {
  const [hours = 0, minutes = 0] = hourMinute.split(':').map(Number);
  return hours * 60 + minutes;
}

function compare(environment: Environment, [left, right]: [Operand, Operand]) {
  return { left: value(environment, left), right: value(environment, right) };
}

function evaluate(condition: Condition, environment: Environment): Truth {
  if ('all' in condition) {
    const results = condition.all.map((child) => evaluate(child, environment));
    if (results.includes(false)) return false;
    return results.includes(null) ? null : true;
  }
  if ('any' in condition) {
    const results = condition.any.map((child) => evaluate(child, environment));
    if (results.includes(true)) return true;
    return results.includes(null) ? null : false;
  }
  if ('not' in condition) {
    const result = evaluate(condition.not, environment);
    return result === null ? null : !result;
  }
  if ('equals' in condition) {
    const { left, right } = compare(environment, condition.equals);
    if (!isScalar(left) || !isScalar(right)) return null;
    return left === right;
  }
  if ('in' in condition) {
    const candidate = value(environment, condition.in[0]);
    if (typeof candidate !== 'string' && typeof candidate !== 'number') return null;
    return condition.in[1].includes(candidate);
  }
  if ('greaterThan' in condition || 'lessThan' in condition) {
    const operands = 'greaterThan' in condition ? condition.greaterThan : condition.lessThan;
    const { left, right } = compare(environment, operands);
    if (typeof left !== 'number' || typeof right !== 'number') return null;
    return 'greaterThan' in condition ? left > right : left < right;
  }
  if ('ipInCidr' in condition) {
    const ip = value(environment, condition.ipInCidr[0]);
    if (typeof ip !== 'string') return null;
    return ipInCidr(ip, condition.ipInCidr[1]);
  }
  const time = resolve(environment, 'context.time');
  const date = typeof time === 'string' ? new Date(time) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const now = date.getUTCHours() * 60 + date.getUTCMinutes();
  const start = minutesOfDay(condition.timeBetween[0]);
  const end = minutesOfDay(condition.timeBetween[1]);
  // A range crossing midnight (22:00 to 06:00) wraps around.
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

/**
 * Policy Decision Point (docs/architecture/authorization-model.md).
 *
 * Deny overrides allow, and the default is deny. Unknown conditions always resolve toward denial:
 * an allow policy only applies when its condition is true, a deny policy applies unless its
 * condition is false. A missing attribute can neither grant access nor bypass a prohibition.
 */
export class PolicyEngine {
  constructor(private readonly clock: Clock) {}

  evaluate(request: AuthorizationRequest, policies: readonly Policy[]): Decision {
    const resource = `${request.resource.type}:${request.resource.id}`;
    const environment: Environment = {
      subject: request.subject,
      resource: request.resource,
      context: {
        ...request.context,
        time: request.context.time ?? new Date(this.clock.now()).toISOString(),
      },
    };

    let allowedBy: Policy | undefined;
    for (const policy of policies) {
      const applies =
        policy.actions.some((pattern) => matchesPattern(pattern, request.action)) &&
        policy.resources.some((pattern) => matchesPattern(pattern, resource)) &&
        (policy.roles.length === 0 ||
          policy.roles.some((role) => request.subject.roles.includes(role)));
      if (!applies) continue;

      const truth = policy.condition ? evaluate(policy.condition, environment) : true;
      if (policy.effect === 'deny' && truth !== false) {
        return { decision: 'deny', policyId: policy.id, reason: 'deny_policy' };
      }
      if (policy.effect === 'allow' && truth === true) {
        allowedBy ??= policy;
      }
    }

    return allowedBy
      ? { decision: 'allow', policyId: allowedBy.id, reason: 'allow_policy' }
      : { decision: 'deny', policyId: null, reason: 'no_matching_policy' };
  }
}

export interface RolePermissions {
  name: string;
  permissions: readonly string[];
}

/** RBAC as policies: each role grants its permissions on every resource. */
export function rolePolicies(roles: readonly RolePermissions[]): Policy[] {
  return roles
    .filter((role) => role.permissions.length > 0)
    .map((role) => ({
      id: `role-${role.name}`,
      description: `Permissions of the ${role.name} role`,
      effect: 'allow' as const,
      actions: [...role.permissions],
      resources: ['*'],
      roles: [role.name],
    }));
}
