#!/usr/bin/env node
/**
 * Local bridge entrypoint.
 *
 * Responsibilities, and nothing else:
 *   1. hold the permanent Gemini API key,
 *   2. authenticate the installed extension,
 *   3. mint short-lived Live ephemeral tokens,
 *   4. report health.
 *
 * Audio never passes through this process.
 */
import { BRIDGE_HOST, BRIDGE_HEALTH_PATH, PRODUCT_NAME, PRODUCT_VERSION } from '@gbl/shared';
import { createBridgeApp } from './app.js';
import { loadConfig, maskSecret } from './config.js';
import { createLogger } from './logger.js';

function main(): void {
  const loaded = loadConfig();
  if (!loaded.ok || !loaded.config) {
    console.error('');
    console.error('  Gemini Browser Live — local bridge cannot start');
    console.error('');
    for (const error of loaded.errors) console.error(`  • ${error}`);
    console.error('');
    console.error(`  Configuration file: ${loaded.envFile}`);
    console.error('  Run the setup script (scripts/setup-windows.ps1) or edit the file manually.');
    console.error(
      '  Required: GEMINI_API_KEY, LOCAL_GATE_SECRET (32+ chars), ALLOWED_EXTENSION_IDS.',
    );
    console.error('');
    process.exitCode = 1;
    return;
  }

  const config = loaded.config;
  const logger = createLogger(config.logLevel);
  const { server } = createBridgeApp(config, { logger });

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\n  Port ${config.port} is already in use. Stop the other bridge process or change PORT in ${config.envFile}.\n`,
      );
    } else if (error.code === 'EACCES') {
      console.error(
        `\n  Permission denied binding port ${config.port}. Choose a port above 1024.\n`,
      );
    } else {
      console.error(`\n  Bridge error: ${error.message}\n`);
    }
    process.exitCode = 1;
  });

  server.listen(config.port, BRIDGE_HOST, () => {
    const url = `http://${BRIDGE_HOST}:${config.port}`;
    console.log('');
    console.log(`  ${PRODUCT_NAME} — local bridge v${PRODUCT_VERSION}`);
    console.log(`  Listening on ${url} (loopback only)`);
    console.log(`  Health:     ${url}${BRIDGE_HEALTH_PATH}`);
    console.log(`  API key:    ${maskSecret(config.apiKey)}  (never leaves this process)`);
    console.log(
      `  Allowlist:  ${config.extensionIds.join(', ') || '(empty — extension will be rejected)'}`,
    );
    console.log('');
    if (!config.extensionIds.length) {
      console.warn('  Warning: ALLOWED_EXTENSION_IDS is empty. Nothing can mint tokens.');
      console.warn('  Run the setup script to derive the id from the extension manifest key.');
      console.warn('');
    }
    if (config.extensionIds.length > 0 && process.stdout.isTTY) {
      console.log('  Keep this window open while you use the extension. Ctrl+C stops the bridge.');
      console.log('');
    }
  });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    // Do not let a hung connection block exit forever.
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught exception', { error: error.message });
    process.exitCode = 1;
  });
}

main();
