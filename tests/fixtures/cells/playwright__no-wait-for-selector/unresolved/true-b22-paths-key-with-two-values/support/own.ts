const fakePage = { goto: async () => null, waitForSelector: async () => null, waitForNavigation: async () => null };
export function test(title: string, body: (args: { page: any }) => unknown) { return body({ page: fakePage }); }
