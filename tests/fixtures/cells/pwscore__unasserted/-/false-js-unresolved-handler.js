const { test } = require('@playwright/test');
const { checkoutFlow } = require('shop-flows');

test('checks out', checkoutFlow);
