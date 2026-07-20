import { z } from 'zod';

const userSchema = z.object({
	id: z.string(),
	name: z.string(),
});

export function parseUser(value: unknown): unknown {
	const result = userSchema.safeParse(value);
	return result.success ? result.data : undefined;
}
