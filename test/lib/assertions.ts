import assert from 'assert';

export function assertSuccess<T extends { type?: string }>(branch: T | undefined, context: string): asserts branch is T & { type: 'success' } {
  assert.ok(branch, `${context}: missing structured result`);
  assert.equal(branch.type, 'success', `${context}: expected success branch, got ${branch?.type}`);
}

export function assertObjectsShape<T extends { type?: string; shape?: string }>(branch: T | undefined, context: string): asserts branch is T & { type: 'success'; shape: 'objects' } {
  assertSuccess(branch, context);
  assert.equal(branch.shape, 'objects', `${context}: expected objects shape, got ${branch.shape}`);
}
