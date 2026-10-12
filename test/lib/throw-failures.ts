/**
 * Throws nothing, the single failure unchanged, or one error listing every failure, so a
 * cleanup failure never hides the test failure it follows.
 */
export function throwFailures(message: string, failures: unknown[]): void {
  if (failures.length === 0) return;
  if (failures.length === 1) throw failures[0];
  const error = new Error(`${message}: ${failures.map((failure) => (failure instanceof Error ? failure.message : String(failure))).join('; ')}`);
  throw Object.assign(error, { errors: failures });
}
