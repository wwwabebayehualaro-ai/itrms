import { a } from './bad-cycle-a';
export const b = () => a;
