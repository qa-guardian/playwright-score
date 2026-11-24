const { test: base } = require('@playwright/test');
const { fake, createRunner } = require('./runner');
exports.test = base;
module.exports = { __proto__: require('./runner') };
