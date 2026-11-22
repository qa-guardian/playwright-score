export * from './c';
const fakePage = { goto: async () => null, waitForSelector: async () => null, waitForNavigation: async () => null };
export function test(title, body) { return body({ page: fakePage }); }
