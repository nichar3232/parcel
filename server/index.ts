import { createApp } from './app';
import { configFromEnv } from './config';
const config = configFromEnv(),
  app = createApp(config);
app.server.listen(config.port, config.host, () =>
  console.log(
    `Parcel API and frontend listening on ${config.host}:${config.port}`,
  ),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    app.server.close(() => {
      app.store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000).unref();
  });
