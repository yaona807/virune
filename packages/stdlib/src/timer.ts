import type { Duration, TaskContext } from '@virune/runtime';
import { sleep as runtimeSleep } from '@virune/runtime';

export const sleep = (duration: Duration, context: TaskContext): Promise<void> => runtimeSleep(context, duration);
export const now = (): number => Date.now();
