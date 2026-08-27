import type { AppConfig } from './config.js';
import { infrastructureDisabledReason } from './config.js';

/**
 * THE STARTUP BANNER — a few lines that answer, immediately, the question a developer actually has:
 * "is this worker going to do anything, and if not, why not?"
 *
 * WHY A BANNER AT ALL, given the structured log already carries every field. Because the failure it
 * addresses is a READING failure, not a missing-data failure. The information was always in the
 * `worker.startup` record — `infrastructure: "disabled"` sat right there — but it was one key among
 * twenty in a single-line JSON blob, next to a `processors: 0` that turned out to be a hardcoded
 * stub. Everything needed was present and nobody could see it.
 *
 * SCOPE — this is DX only, and deliberately narrow:
 *   • It prints only when `WV2_LOG_FORMAT=console`, i.e. local development. Production runs `json`
 *     and gets the machine-readable `worker.mode` record instead, so log pipelines are unaffected.
 *   • It writes to stdout directly rather than through the logger, because a multi-line box does not
 *     belong in a line-oriented structured sink.
 *   • It reports SHAPE, never values — the same rule the configuration summary follows. A secret can
 *     never reach it, because it is only ever handed derived facts.
 */

export interface BannerInputs {
  readonly config: AppConfig;
  /** Job types actually registered in the `ProcessorRegistry`. Empty in reference mode. */
  readonly processors: readonly string[];
  /** `.env` files that contributed variables, for "where did this value come from?". */
  readonly envFiles: readonly string[];
  readonly workerVersion: string;
  readonly nodeVersion?: string;
  /** Environment source, so the reason for a disabled switch can be read back. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const WIDTH = 74;

/** Build the banner as a string (pure — testable without capturing stdout). */
export function renderStartupBanner(inputs: BannerInputs): string {
  const { config, processors } = inputs;
  const production = config.mode === 'production';
  const lines: string[] = [];

  const row = (label: string, value: string): void => {
    lines.push(`│ ${label.padEnd(16)}${value}`);
  };

  lines.push(`┌─ Worker V2 ${'─'.repeat(WIDTH - 12)}`);
  row(
    'Mode',
    production
      ? 'PRODUCTION — processing real jobs'
      : 'REFERENCE — no production jobs will be processed',
  );
  row('Environment', process.env['NODE_ENV'] ?? 'development');
  row('Version', `${inputs.workerVersion} · node ${inputs.nodeVersion ?? process.version}`);
  lines.push(`├${'─'.repeat(WIDTH)}`);

  row('Infrastructure', production ? 'enabled' : 'DISABLED');
  if (!production) {
    // The whole point of the banner: never leave the developer guessing.
    const why = infrastructureDisabledReason(config, inputs.env ?? process.env);
    if (why !== null) {
      row('  Reason', why.reason);
      row('  Expected', why.expected);
      row('  Template', 'worker/.env.example');
    }
  } else {
    row('  Database', 'configured (DIRECT_URL)');
    row('  R2 bucket', 'configured');
    /**
     * THE RENDER TARGET, AND WHERE IT CAME FROM.
     *
     * Printing the URL alone was not enough: a configured `http://localhost:3000` and an
     * unconfigured one are the same string, and only one of them is a mistake. Chromium runs
     * inside this worker, so a defaulted localhost means "port 3000 on THIS machine" — which is
     * how every render came to die with ERR_CONNECTION_REFUSED while the app was healthy
     * elsewhere. The source is now stated, and a default is called out as a default.
     */
    const render = config.infrastructure?.render;
    if (render) {
      const origin = (() => {
        try {
          return new URL(render.appUrl).origin;
        } catch {
          return render.appUrl;
        }
      })();
      row(
        '  App URL',
        render.appUrlSource === 'env'
          ? `${origin}  (from ${render.appUrlVar})`
          : `${origin}  (DEFAULT — no APP_URL set)`,
      );
      if (render.appUrlSource === 'default') {
        row('  ⚠ Note', 'Chromium resolves this "localhost" to the WORKER\'s own machine.');
        row('', 'If the app runs anywhere else, set APP_URL — see worker/.env.example.');
      }
    } else {
      row('  App URL', '—');
    }
  }

  row('Storage', config.runtime.storage.kind);
  row(
    'Processors',
    processors.length === 0
      ? '0 registered'
      : `${processors.length} registered — ${processors.join(', ')}`,
  );
  for (const type of processors) row('', `  ✓ ${type}`);

  const recovery = config.infrastructure?.recovery;
  row(
    'Recovery',
    recovery === undefined
      ? 'n/a (reference mode)'
      : recovery.enabled
        ? `enabled — every ${recovery.intervalMs}ms`
        : 'disabled',
  );
  row(
    'Health',
    config.app.healthPort === null
      ? 'headless (no PORT set — no /health endpoint)'
      : `http://localhost:${config.app.healthPort}/health`,
  );
  row(
    'Diagnostics',
    config.app.diagnosticsToken === null ? 'disabled (set WV2_DIAGNOSTICS_TOKEN)' : 'protected',
  );
  row(
    'Tracing',
    config.observability.tracing ? `on (sample ${config.observability.traceSampleRatio})` : 'off',
  );
  row('Metrics', config.observability.metrics ? 'on' : 'off');
  row('Log level', `${config.observability.level} (${config.observability.format})`);
  row(
    'Env files',
    inputs.envFiles.length === 0
      ? 'none found — using process.env only'
      : inputs.envFiles.join(', '),
  );

  if (config.warnings.length > 0) {
    lines.push(`├${'─'.repeat(WIDTH)}`);
    for (const warning of config.warnings) row('⚠ Warning', warning);
  }

  lines.push(`└${'─'.repeat(WIDTH)}`);
  return lines.join('\n');
}

/**
 * The machine-readable equivalent, emitted as the `worker.mode` log record in EVERY format. This is
 * the field set an operator greps in production; the banner is its human rendering.
 */
export function startupModeFields(inputs: BannerInputs): Record<string, unknown> {
  const { config } = inputs;
  const why = infrastructureDisabledReason(config, inputs.env ?? process.env);
  return {
    mode: config.mode,
    environment: process.env['NODE_ENV'] ?? 'development',
    infrastructure: config.infrastructure === null ? 'disabled' : 'enabled',
    ...(why === null ? {} : { disabledReason: why.reason, expected: why.expected }),
    storage: config.runtime.storage.kind,
    processors: inputs.processors,
    processorCount: inputs.processors.length,
    recovery:
      config.infrastructure === null
        ? 'n/a'
        : config.infrastructure.recovery.enabled
          ? 'enabled'
          : 'disabled',
    healthPort: config.app.healthPort,
    diagnostics: config.app.diagnosticsToken === null ? 'disabled' : 'protected',
    tracing: config.observability.tracing,
    metrics: config.observability.metrics,
    envFiles: inputs.envFiles,
  };
}

/** Print the banner to stdout. Console format only — production `json` logs are left untouched. */
export function printStartupBanner(inputs: BannerInputs): void {
  if (inputs.config.observability.format !== 'console') return;
  process.stdout.write(`${renderStartupBanner(inputs)}\n`);
}
