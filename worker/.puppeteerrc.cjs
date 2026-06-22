const { join } = require('path');

/**
 * Puppeteer configuration for the PDF worker.
 *
 * Pin Chrome's download/lookup directory to a PROJECT-RELATIVE path so the browser
 * binary installed at BUILD time lands in the SAME place the worker reads it at RUNTIME.
 * Puppeteer's default is `~/.cache/puppeteer` (the home dir), which Render does NOT
 * reliably carry from the build phase into the running service — that is why
 * `puppeteer.launch()` failed with "Could not find Chrome (ver. 131.0.6778.204)".
 *
 * This file is read by BOTH `puppeteer browsers install` (the postinstall step) and
 * `puppeteer.launch()`, so the launch still auto-resolves the executable — no
 * `executablePath` threading and no change to the generation pipeline.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
