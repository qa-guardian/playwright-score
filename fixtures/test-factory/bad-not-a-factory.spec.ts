import { expect } from '@playwright/test';
import { notAFactory } from './fixtures';

const t = notAFactory();

t.run();
expect(1).toBe(1);
