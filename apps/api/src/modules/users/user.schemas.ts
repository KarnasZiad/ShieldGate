import { z } from 'zod';
import { MAX_PASSWORD_LENGTH } from './password-policy.js';

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Bounded before hashing, so a megabyte "password" cannot burn CPU (threat D1). */
export const PasswordSchema = z
  .string()
  .min(1)
  .max(MAX_PASSWORD_LENGTH * 4);

export const RoleNameSchema = z.string().regex(/^[a-z][a-z0-9-]{1,49}$/);

/** Response shape: the hash, the TOTP seed and the step never leave the API. */
export const PublicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  status: z.enum(['active', 'disabled']),
  roles: z.array(z.string()),
  mfaEnabled: z.boolean(),
  createdAt: z.string(),
});

export const CreateUserSchema = z.object({
  email: EmailSchema,
  displayName: z.string().trim().min(1).max(120),
  password: PasswordSchema,
  roles: z.array(RoleNameSchema).max(10).default(['member']),
});

export const UpdateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    roles: z.array(RoleNameSchema).max(10).optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined || value.status !== undefined || value.roles !== undefined,
    {
      message: 'Provide at least one field to update',
    },
  );

export const UserListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(100).optional(),
});

export const IdParamsSchema = z.object({ id: z.uuid() });
