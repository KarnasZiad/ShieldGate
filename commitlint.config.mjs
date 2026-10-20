/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      1,
      'always',
      [
        'api',
        'console',
        'auth',
        'mfa',
        'sessions',
        'users',
        'api-keys',
        'authz',
        'audit',
        'db',
        'infra',
        'ci',
        'deps',
        'docs',
      ],
    ],
  },
};
