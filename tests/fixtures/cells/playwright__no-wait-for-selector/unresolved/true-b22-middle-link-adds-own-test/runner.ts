const fakePage = { goto: async () => null, waitForSelector: async () => null, waitForNavigation: async () => null };
type Body = (args: { page: any }) => unknown;
export function test(title: string, body: Body) { return body({ page: fakePage }); }
export const fake = test;
export function createRunner() { return { test }; }
