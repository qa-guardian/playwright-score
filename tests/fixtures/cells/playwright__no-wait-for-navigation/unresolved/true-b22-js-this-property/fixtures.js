const { test: base } = require('@playwright/test');
const { fake, createRunner } = require('./runner');
exports.test = base;
this.test = fake;
