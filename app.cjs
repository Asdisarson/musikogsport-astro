// Plesk entry (Node.js extension, "Application Startup File": app.cjs). Plesk runs the app under Phusion Passenger,
// which loads the startup file with require(); this package is ESM and server.mjs uses top-level await, so a
// CommonJS file that imports it is the only shape Passenger can start. Passenger takes over the server's listen()
// call, so HOST and PORT play no part there. Build first with `npm run build:plesk` (DEPLOY.md "Plesk").
import('./server.mjs').catch((err) => {
  console.error(err);
  process.exit(1);
});
