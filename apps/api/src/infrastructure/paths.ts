import { fileURLToPath } from 'node:url';

/** apps/api/migrations, both from src/ (tsx) and from dist/ (compiled). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));
