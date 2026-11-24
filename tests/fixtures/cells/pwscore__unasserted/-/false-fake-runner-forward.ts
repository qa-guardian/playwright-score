type Body = (args: { page: unknown }) => unknown;

export function test(title: string, body: Body) {
  return body({ page: {} });
}

export const it = (title: string, body: Body) => test(title, body);
