/**
 * Helper to trigger manual garbage collection if Node is executed with --expose-gc.
 */
export function triggerGC(): void {
  if (typeof global.gc === "function") {
    try {
      global.gc();
    } catch {
      // Ignore GC invocation errors
    }
  }
}
