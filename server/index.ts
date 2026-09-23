import { createApp } from './app';
import { configFromEnv } from './config';
const config = configFromEnv(),
  app = createApp(config, { live: process.env.PARCEL_LIVE !== 'false' });
// A vault priced before the first real print would open at the engine's
// boot seed, so the listener waits (briefly) for the venue to answer.
void (app.live ? app.live.ready() : Promise.resolve(true)).then((ready) => {
  if (app.live && !ready)
    console.warn('Live marks not yet available; the vault will retry.');
  app.server.listen(config.port, config.host, () =>
    console.log(
      `Parcel API and frontend listening on ${config.host}:${config.port}${app.live ? ' (live market)' : ''}`,
    ),
  );
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    app.server.close(() => {
      app.store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 15000).unref();
  });
