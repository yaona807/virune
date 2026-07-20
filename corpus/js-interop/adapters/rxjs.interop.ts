import { firstValueFrom, of } from 'rxjs';

export async function echoAsync(value: unknown): Promise<unknown> {
	return firstValueFrom(of(value));
}
