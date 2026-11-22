const fakePage = { goto: async () => null, waitForSelector: async () => null, waitForNavigation: async () => null };
exports.test = function test(title, body) { return body({ page: fakePage }); };
