export const NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND = 'npm-publication-authorization-v1';
export const NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS = Object.freeze([
	'documentation-sync',
	'package-publication-enablement',
	'publication-gate-integration',
	'registry-ownership',
	'release-identity-integration',
	'trusted-publishing',
]);
export const NPM_PUBLICATION_POST_WRITE_REQUIREMENTS = Object.freeze([
	'clean-registry-install-smoke',
	'generated-project-registry-smoke',
	'public-registry-verification',
]);
export const NPM_PUBLICATION_REQUIREMENTS = Object.freeze([
	...NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS,
	...NPM_PUBLICATION_POST_WRITE_REQUIREMENTS,
].sort(compareText));

export function validateNpmPublicationAuthorizationContract(value, path = '$.authorization') {
	const contract = record(value, path);
	assertExactKeys(contract, [
		'schemaVersion',
		'reportKind',
		'evidenceSchemaVersion',
		'evidenceSetBindingRequired',
		'preWriteRequirements',
		'postWriteCompletionRequirements',
	], path);
	assert(contract.schemaVersion === 1, `${path}.schemaVersion`, 'expected schemaVersion 1');
	assert(contract.reportKind === NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND, `${path}.reportKind`, `expected ${NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND}`);
	assert(contract.evidenceSchemaVersion === 1, `${path}.evidenceSchemaVersion`, 'expected evidence schemaVersion 1');
	assert(contract.evidenceSetBindingRequired === true, `${path}.evidenceSetBindingRequired`, 'fresh execution evidence-set binding is required');
	const preWriteRequirements = requirementList(contract.preWriteRequirements, `${path}.preWriteRequirements`);
	const postWriteCompletionRequirements = requirementList(contract.postWriteCompletionRequirements, `${path}.postWriteCompletionRequirements`);
	assert(
		JSON.stringify(preWriteRequirements) === JSON.stringify(NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS),
		`${path}.preWriteRequirements`,
		`expected canonical pre-write requirements ${NPM_PUBLICATION_PRE_WRITE_REQUIREMENTS.join(', ')}`,
	);
	assert(
		JSON.stringify(postWriteCompletionRequirements) === JSON.stringify(NPM_PUBLICATION_POST_WRITE_REQUIREMENTS),
		`${path}.postWriteCompletionRequirements`,
		`expected canonical post-write requirements ${NPM_PUBLICATION_POST_WRITE_REQUIREMENTS.join(', ')}`,
	);
	const overlap = preWriteRequirements.filter(requirement => postWriteCompletionRequirements.includes(requirement));
	assert(overlap.length === 0, path, `pre-write and post-write requirements must be disjoint: ${overlap.join(', ')}`);
	const combined = [...preWriteRequirements, ...postWriteCompletionRequirements].sort(compareText);
	assert(
		JSON.stringify(combined) === JSON.stringify(NPM_PUBLICATION_REQUIREMENTS),
		path,
		`authorization requirements must exactly cover ${NPM_PUBLICATION_REQUIREMENTS.join(', ')}`,
	);
	return {
		schemaVersion: 1,
		reportKind: NPM_PUBLICATION_AUTHORIZATION_REPORT_KIND,
		evidenceSchemaVersion: 1,
		evidenceSetBindingRequired: true,
		preWriteRequirements,
		postWriteCompletionRequirements,
	};
}

function requirementList(value, path) {
	const requirements = array(value, path).map((item, index) => nonEmptyString(item, `${path}[${index}]`));
	assertUnique(requirements, path, 'requirement');
	return requirements;
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function array(value, path) {
	assert(Array.isArray(value), path, 'expected an array');
	return value;
}

function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}

function assertExactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), path, `expected exact keys ${wanted.join(', ')}`);
}

function assertUnique(values, path, label) {
	assert(new Set(values).size === values.length, path, `duplicate ${label}`);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
