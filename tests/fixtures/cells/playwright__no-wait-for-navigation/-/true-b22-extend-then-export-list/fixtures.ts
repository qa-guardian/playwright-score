import { test as base } from '@playwright/test';
import { fake, createRunner } from './runner';
const test = base.extend({});
export { test };
