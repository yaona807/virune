import { panic } from './core.js';

export interface Duration { readonly milliseconds: number; }

function create(milliseconds: number): Duration {
	if (!Number.isFinite(milliseconds) || milliseconds < 0) return panic('Duration must be a finite non-negative number');
	return Object.freeze({ milliseconds });
}

export const durationMilliseconds = (value: number): Duration => create(value);
export const durationSeconds = (value: number): Duration => create(value * 1_000);
export const durationMinutes = (value: number): Duration => create(value * 60_000);
export const durationHours = (value: number): Duration => create(value * 3_600_000);
export const durationToMilliseconds = (value: Duration): number => value.milliseconds;
