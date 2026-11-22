const { test: base } = require('@playwright/test');
const { createRunner } = require('./runner');

module.exports = { test: base };
if (process.env.LEGACY_RUNNER) {
  Object.assign(module.exports, createRunner());
}
