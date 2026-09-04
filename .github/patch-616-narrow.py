from pathlib import Path

host_path = Path('packages/compiler/src/syntax/tokens.ts')
host = host_path.read_text()
host_old = "\t\tconst opensLambdaBlock = name === 'LBrace' && isBlockLambdaOpeningBrace(input, index);"
host_new = "\t\tconst opensLambdaBlock = name === 'LBrace' && (parenDepth > 0 || bracketDepth > 0) && isBlockLambdaOpeningBrace(input, index);"
if host.count(host_old) != 1:
    raise SystemExit('host lambda-open anchor mismatch')
host_path.write_text(host.replace(host_old, host_new))

selfhost_path = Path('selfhost/mvp/src/frontend-lexer.virune')
selfhost = selfhost_path.read_text()
selfhost_old = '\t\tlet opensLambdaBlock = value.text == "{" && isBlockLambdaOpeningBrace(rawTokens, index)'
selfhost_new = '\t\tlet opensLambdaBlock = value.text == "{" && (parenDepth > 0 || bracketDepth > 0) && isBlockLambdaOpeningBrace(rawTokens, index)'
if selfhost.count(selfhost_old) != 1:
    raise SystemExit('selfhost lambda-open anchor mismatch')
selfhost_path.write_text(selfhost.replace(selfhost_old, selfhost_new))
