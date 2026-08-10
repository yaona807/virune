import { readFile } from 'node:fs';

export async function readUtf8(path: string): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		readFile(path, 'utf8', (error, data) => {
			if (error !== null) {
				reject(error);
				return;
			}
			resolve(data);
		});
	});
}
