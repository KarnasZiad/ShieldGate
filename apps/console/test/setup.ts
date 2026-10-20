import { config, enableAutoUnmount } from '@vue/test-utils';
import { afterEach } from 'vitest';

// Router links render as plain anchors in component tests.
config.global.stubs = { RouterLink: { template: '<a><slot /></a>' } };

// A view left mounted would keep reacting to the next test's fake API.
enableAutoUnmount(afterEach);
