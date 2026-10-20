import { loadConfig, type AppConfig } from '../config.js';

const KEY = Buffer.alloc(32, 7).toString('base64');

export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://shieldgate:secret@localhost:5432/shieldgate',
  MONGODB_URL: 'mongodb://localhost:27017',
  REDIS_URL: 'redis://localhost:6379',
  TOTP_ENCRYPTION_KEYS: `1:${KEY}`,
  API_KEY_PEPPER: Buffer.alloc(32, 9).toString('base64'),
  CONSOLE_ORIGINS: 'https://console.shieldgate.test',
} satisfies NodeJS.ProcessEnv;

export function testConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
