/**
 * Same matching as the API policy engine ("users:*", "*"). The console only uses it to hide what
 * the user cannot do: every request is still authorized by the API.
 */
export function matchesPermission(pattern: string, permission: string): boolean {
  if (pattern === '*') return true;
  const [patternResource, patternAction] = pattern.split(':');
  const [resource, action] = permission.split(':');
  return patternResource === resource && (patternAction === '*' || patternAction === action);
}

export function hasPermission(granted: readonly string[], permission: string): boolean {
  return granted.some((pattern) => matchesPermission(pattern, permission));
}
