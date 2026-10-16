import type { Answer, Ask, Step } from './types';

/** A piece of game flow: yields events and questions, resumes with the human's answer. */
export type Flow<T = void> = Generator<Step, T, Answer>;

/** Wrap a question so the driver can tell it from an event. */
export const ask = (a: Ask): Step => ({ ...a, ask: true });
