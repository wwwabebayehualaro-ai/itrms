/** @itrms/kernel/numbering: the numbers ITRMS issues, gapless, from per-unit counters (architecture.md §15). */
export { counterExists, formatNumber, nextNumber, requireCounter, setUpCounter, type CounterSetup } from './numbering';
export { numberCounters } from './numbering.table';
export { counterNeeds, ensureCounter, type CounterNeed } from './service-counters';
