function test(title, body) {
  return body({ page: {} });
}

const it = (title, body) => test(title, body);

module.exports = { test, it };
