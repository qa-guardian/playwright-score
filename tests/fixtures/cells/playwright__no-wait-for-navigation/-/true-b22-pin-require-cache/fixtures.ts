export * from '@playwright/test';
import { fake } from './runner';
require.cache[__filename]!.exports = { test: fake };
