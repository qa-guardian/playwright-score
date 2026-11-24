const page = {
  waitForTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  pause: async () => undefined,
};

export async function settle() {
  await page.waitForTimeout(250);
  await page.pause();
}
