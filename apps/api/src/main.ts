import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDependencies } from './container.js';

const config = loadConfig();
const { deps, close } = await createDependencies(config);
const app = await buildApp(deps);

app.addHook('onClose', close);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'Shutting down');
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
