const fakePage = { goto: async () => null, waitForSelector: async () => null, waitForNavigation: async () => null };
function test(title, body) { return body({ page: fakePage }); }
exports.test = test;
exports.fake = test;
exports.createRunner = () => ({ test });
