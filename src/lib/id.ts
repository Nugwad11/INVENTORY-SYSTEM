let counter = 0;

export function uid(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

export function docNumber(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(5, '0')}`;
}
