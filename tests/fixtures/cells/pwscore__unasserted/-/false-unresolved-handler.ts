import { test } from '@playwright/test';
import { checkoutFlow } from 'shop-flows';

test('checks out', checkoutFlow);
