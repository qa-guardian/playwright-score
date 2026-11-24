const { test: base } = require('@playwright/test');
const { fake, createRunner } = require('./runner');
exports.test = base;
for (const k of ['test']) this[k] = require('./runner')[k];
