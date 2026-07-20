const minimumMajor = 24;
const [major] = process.versions.node.split('.').map(Number);

if (!Number.isInteger(major) || major < minimumMajor) {
	console.error(`Virune requires Node.js ${minimumMajor} or newer; received ${process.versions.node}.`);
	process.exit(1);
}

console.log(`Verified Node.js runtime ${process.versions.node} (minimum ${minimumMajor}).`);
