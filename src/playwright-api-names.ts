/**
 * Method names of the Playwright objects a spec calls directly (Page,
 * Locator, FrameLocator, Frame, APIRequestContext, Keyboard, Mouse,
 * Touchscreen, BrowserContext). A user-defined helper that shares one of
 * these names must never be registered as an "assertion helper": upstream
 * `expect-expect` matches the LAST property of any call chain, so a helper
 * `nav.goto` that asserts would make every `page.goto()` count as an
 * assertion. One exported set, used by metrics.ts and finding-triage.ts.
 */
export const PLAYWRIGHT_API_METHODS: ReadonlySet<string> = new Set([
  // navigation / page
  'goto', 'goBack', 'goForward', 'reload', 'close', 'bringToFront', 'evaluate', 'evaluateHandle',
  'evaluateAll', 'setContent', 'content', 'title', 'url', 'screenshot', 'pdf', 'route', 'unroute',
  'routeFromHAR', 'on', 'once', 'off', 'addInitScript', 'addScriptTag', 'addStyleTag', 'exposeFunction',
  'exposeBinding', 'pause', 'frame', 'frames', 'mainFrame', 'opener', 'setViewportSize',
  'setExtraHTTPHeaders', 'emulateMedia', 'dragAndDrop', 'setDefaultTimeout',
  'setDefaultNavigationTimeout', 'storageState', 'newPage', 'cookies', 'addCookies', 'clearCookies',
  'grantPermissions', 'clearPermissions', 'setGeolocation', 'setOffline', 'newContext', 'newCDPSession',
  // locators
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle',
  'getByTestId', 'frameLocator', 'filter', 'and', 'or', 'first', 'last', 'nth', 'all', 'count',
  'contentFrame', 'elementHandle', 'elementHandles', 'highlight', 'describe',
  // actions
  'click', 'dblclick', 'tap', 'fill', 'clear', 'type', 'press', 'pressSequentially', 'check', 'uncheck',
  'setChecked', 'hover', 'focus', 'blur', 'selectOption', 'selectText', 'setInputFiles', 'dispatchEvent',
  'scrollIntoViewIfNeeded', 'down', 'up', 'insertText', 'move', 'wheel',
  // reads / waits
  'textContent', 'innerText', 'innerHTML', 'inputValue', 'getAttribute', 'allTextContents',
  'allInnerTexts', 'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isEditable', 'isChecked',
  'boundingBox', 'ariaSnapshot', 'waitFor', 'waitForSelector', 'waitForTimeout', 'waitForLoadState',
  'waitForURL', 'waitForEvent', 'waitForFunction', 'waitForRequest', 'waitForResponse',
  'waitForNavigation',
  // APIRequestContext
  'get', 'post', 'put', 'patch', 'delete', 'head', 'fetch', 'dispose',
]);
