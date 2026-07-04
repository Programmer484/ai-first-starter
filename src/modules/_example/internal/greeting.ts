// Internal implementation detail. Importing this file from another module is a
// deep import and is blocked by lint. Only index.ts may use it.
export function formatGreeting(who: string): string {
  const name = who.trim() || 'world';
  return `Hello, ${name}!`;
}
