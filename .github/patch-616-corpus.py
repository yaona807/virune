import json
from pathlib import Path

path = Path('.github/self-hosting/parser-parity-corpus-v1.json')
data = json.loads(path.read_text())
case_id = 'valid-call-argument-block-lambda'
if any(case.get('id') == case_id for case in data['cases']):
    raise SystemExit(f'{case_id} already exists')
case = {
    'id': case_id,
    'tags': ['valid', 'expression', 'lambda', 'call', 'newline'],
    'source': 'pub fn main() -> Unit {\n\tinvoke(\n\t\tfn() -> Unit {\n\t\t\tdiscard nested(\n\t\t\t\t1,\n\t\t\t\t2,\n\t\t\t)\n\t\t\treturn Unit\n\t\t},\n\t)\n\treturn Unit\n}\n',
    'mutations': [],
}
first_invalid = next((index for index, item in enumerate(data['cases']) if 'invalid' in item.get('tags', [])), len(data['cases']))
data['cases'].insert(first_invalid, case)
path.write_text(json.dumps(data, indent=2) + '\n')
