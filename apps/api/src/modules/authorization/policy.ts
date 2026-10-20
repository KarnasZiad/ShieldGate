import { z } from 'zod';

const NAME = '[a-z][a-z0-9-]*';
/** Concrete action requested by an application, e.g. "invoice:approve". */
const ACTION = new RegExp(`^${NAME}:${NAME}$`);
/** Action pattern of a policy: "invoice:approve", "invoice:*" or "*". */
const ACTION_PATTERN = new RegExp(`^([*]|${NAME}:([*]|${NAME}))$`);
/** Resource pattern of a policy: "invoice:inv-7", "invoice:*" or "*". */
const RESOURCE_PATTERN = new RegExp(`^([*]|${NAME}:([*]|[A-Za-z0-9._-]+))$`);
/** Attribute reference: subject.attributes.department. Names starting with "__" are refused. */
const REFERENCE = /^(subject|resource|context)([.](?!__)[A-Za-z0-9_]+){1,4}$/;
const HOUR_MINUTE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export const OperandSchema = z.union([
  z.object({ ref: z.string().regex(REFERENCE) }).strict(),
  z.string().max(256),
  z.number(),
  z.boolean(),
]);

export type Operand = z.infer<typeof OperandSchema>;

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { equals: [Operand, Operand] }
  | { in: [Operand, (string | number)[]] }
  | { greaterThan: [Operand, Operand] }
  | { lessThan: [Operand, Operand] }
  | { ipInCidr: [Operand, string] }
  | { timeBetween: [string, string] };

/** A closed set of typed operators: policies never evaluate code (ADR 0005). */
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(ConditionSchema).min(1).max(20) }).strict(),
    z.object({ any: z.array(ConditionSchema).min(1).max(20) }).strict(),
    z.object({ not: ConditionSchema }).strict(),
    z.object({ equals: z.tuple([OperandSchema, OperandSchema]) }).strict(),
    z
      .object({
        in: z.tuple([OperandSchema, z.array(z.union([z.string().max(256), z.number()])).max(100)]),
      })
      .strict(),
    z.object({ greaterThan: z.tuple([OperandSchema, OperandSchema]) }).strict(),
    z.object({ lessThan: z.tuple([OperandSchema, OperandSchema]) }).strict(),
    z.object({ ipInCidr: z.tuple([OperandSchema, z.string().max(64)]) }).strict(),
    z
      .object({
        timeBetween: z.tuple([z.string().regex(HOUR_MINUTE), z.string().regex(HOUR_MINUTE)]),
      })
      .strict(),
  ]),
);

export const PolicySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    description: z.string().max(500).default(''),
    effect: z.enum(['allow', 'deny']),
    actions: z.array(z.string().regex(ACTION_PATTERN)).min(1).max(50),
    resources: z.array(z.string().regex(RESOURCE_PATTERN)).min(1).max(50),
    roles: z
      .array(z.string().regex(new RegExp(`^${NAME}$`)))
      .max(20)
      .default([]),
    condition: ConditionSchema.optional(),
  })
  .strict();

export type Policy = z.output<typeof PolicySchema>;

const AttributeValue = z.union([
  z.string().max(256),
  z.number(),
  z.boolean(),
  z.array(z.string().max(256)).max(50),
]);

const Attributes = z
  .record(z.string().regex(/^(?!__)[A-Za-z0-9_]{1,64}$/), AttributeValue)
  .refine((attributes) => Object.keys(attributes).length <= 50, 'At most 50 attributes')
  .default({});

export const AuthorizationRequestSchema = z.object({
  subject: z.object({
    id: z.string().min(1).max(128),
    roles: z.array(z.string().max(64)).max(50).default([]),
    attributes: Attributes,
  }),
  action: z.string().regex(ACTION),
  resource: z.object({
    type: z.string().regex(new RegExp(`^${NAME}$`)),
    id: z.string().min(1).max(128),
    attributes: Attributes,
  }),
  context: z
    .object({ ip: z.string().max(64).optional(), time: z.iso.datetime().optional() })
    .default({}),
});

export type AuthorizationRequest = z.output<typeof AuthorizationRequestSchema>;
