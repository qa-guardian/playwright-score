const { test: base } = require('@playwright/test');
const { fake, createRunner } = require('./runner');
module.exports = { test: base };
