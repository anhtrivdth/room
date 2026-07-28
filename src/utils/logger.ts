export const logger = {
  info(message: string, data?: Record<string, unknown>) { console.info(message, data ?? ""); },
  error(message: string, error?: unknown) {
    // Error messages from unofficial clients can contain response payloads. Never log them.
    const safe = error instanceof Error ? { name: error.name } : undefined;
    console.error(message, safe ?? "");
  },
};
