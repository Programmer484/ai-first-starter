// Public surface of the _example module. This is the ONLY file other modules
// are allowed to import from (enforced by ESLint boundaries — see eslint.config.js).
import { formatGreeting } from './internal/greeting.ts';

export interface Greeting {
  who: string;
  text: string;
}

export function greet(who: string): Greeting {
  return { who, text: formatGreeting(who) };
}
