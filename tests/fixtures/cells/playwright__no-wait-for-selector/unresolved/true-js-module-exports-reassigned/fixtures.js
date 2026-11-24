const { test: base } = require('@playwright/test');
const { createRunner } = require('./runner');

module.exports = { test: base };
module.exports = createRunner();
