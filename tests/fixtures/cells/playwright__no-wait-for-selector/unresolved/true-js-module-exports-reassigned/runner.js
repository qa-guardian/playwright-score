exports.createRunner = () => ({
  test: (name, fn) => fn({ page: { waitForSelector: async () => null, $: async () => null } }),
});
