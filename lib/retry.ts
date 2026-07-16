export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, backoffMs = 1000): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      console.error(`Attempt ${attempt} failed, retrying in ${backoffMs}ms:`, error);
      await delay(backoffMs);
      backoffMs *= 2;
    }
  }
}
