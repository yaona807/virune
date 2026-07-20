import {
	intAdd,
	intDivide,
	intMultiply,
	intNegate,
	intRemainder,
	intSubtract,
	viruneEquals,
} from '@virune/runtime';
import type {
	AssignmentStatement,
	BinaryExpression,
	BlockStatement,
	Expression,
	FunctionDeclaration,
	ModuleNode,
	Pattern,
	Statement,
} from '../ast/nodes.js';

/**
 * Deliberately small reference evaluator for the pure Virune core.
 *
 * It is not used by production execution. Its purpose is differential testing:
 * pure programs can be evaluated here and through emitted JavaScript, and the
 * observable results must agree.
 */
export class ReferenceEvaluationError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'ReferenceEvaluationError';
	}
}

type Environment = Map<string, unknown>;

class ReturnSignal {
	public constructor(readonly value: unknown) {}
}

export function evaluatePureFunction(module: ModuleNode, name: string, args: readonly unknown[] = []): unknown {
	const functions = new Map<string, FunctionDeclaration>();
	for (const declaration of module.declarations) {
		if (declaration.kind === 'FunctionDeclaration') functions.set(declaration.name, declaration);
	}
	const invoke = (functionName: string, values: readonly unknown[]): unknown => {
		const declaration = functions.get(functionName);
		if (declaration === undefined) throw new ReferenceEvaluationError(`Unknown pure function ${functionName}`);
		if (declaration.async) throw new ReferenceEvaluationError('The reference evaluator does not execute async functions');
		if (declaration.parameters.length !== values.length) throw new ReferenceEvaluationError(`Function ${functionName} expects ${declaration.parameters.length} arguments`);
		const environment: Environment = new Map();
		declaration.parameters.forEach((parameter, index) => environment.set(parameter.name, values[index]));
		try {
			if (declaration.expressionBody) return evaluateExpression(declaration.body as Expression, environment, invoke);
			evaluateBlock(declaration.body as BlockStatement, environment, invoke);
			return undefined;
		} catch (signal) {
			if (signal instanceof ReturnSignal) return signal.value;
			throw signal;
		}
	};
	return invoke(name, args);
}

function evaluateBlock(block: BlockStatement, parent: Environment, invoke: (name: string, args: readonly unknown[]) => unknown): void {
	const environment = new Map(parent);
	for (const statement of block.statements) evaluateStatement(statement, environment, invoke);
	for (const [name, value] of environment) if (parent.has(name)) parent.set(name, value);
}

function evaluateStatement(statement: Statement, environment: Environment, invoke: (name: string, args: readonly unknown[]) => unknown): void {
	switch (statement.kind) {
		case 'LetStatement': environment.set(statement.name, evaluateExpression(statement.value, environment, invoke)); return;
		case 'AssignmentStatement': assign(statement, environment, invoke); return;
		case 'ReturnStatement': throw new ReturnSignal(statement.value === undefined ? undefined : evaluateExpression(statement.value, environment, invoke));
		case 'ExpressionStatement': evaluateExpression(statement.expression, environment, invoke); return;
		case 'IfStatement': {
			if (asBoolean(evaluateExpression(statement.condition, environment, invoke))) evaluateBlock(statement.thenBlock, environment, invoke);
			else if (statement.elseBranch?.kind === 'BlockStatement') evaluateBlock(statement.elseBranch, environment, invoke);
			else if (statement.elseBranch !== undefined) evaluateStatement(statement.elseBranch, environment, invoke);
			return;
		}
		case 'WhileStatement': {
			let iterations = 0;
			while (asBoolean(evaluateExpression(statement.condition, environment, invoke))) {
				if (++iterations > 100_000) throw new ReferenceEvaluationError('Reference evaluator loop limit exceeded');
				evaluateBlock(statement.body, environment, invoke);
			}
			return;
		}
		case 'ForStatement': {
			const iterable = evaluateExpression(statement.iterable, environment, invoke);
			if (iterable === null || iterable === undefined || !(Symbol.iterator in Object(iterable))) throw new ReferenceEvaluationError('for target is not iterable');
			for (const value of iterable as Iterable<unknown>) {
				const child = new Map(environment);
				child.set(statement.name, value);
				evaluateBlock(statement.body, child, invoke);
				for (const [name, current] of child) if (environment.has(name)) environment.set(name, current);
			}
			return;
		}
		case 'DeferStatement': throw new ReferenceEvaluationError('defer is outside the pure reference subset');
	}
}

function assign(statement: AssignmentStatement, environment: Environment, invoke: (name: string, args: readonly unknown[]) => unknown): void {
	if (!environment.has(statement.name)) throw new ReferenceEvaluationError(`Unknown variable ${statement.name}`);
	environment.set(statement.name, evaluateExpression(statement.value, environment, invoke));
}

function evaluateExpression(expression: Expression, environment: Environment, invoke: (name: string, args: readonly unknown[]) => unknown): unknown {
	switch (expression.kind) {
		case 'LiteralExpression': return expression.value;
		case 'IdentifierExpression': {
			if (environment.has(expression.name)) return environment.get(expression.name);
			return { $function: expression.name };
		}
		case 'BinaryExpression': return evaluateBinary(expression, environment, invoke);
		case 'UnaryExpression': {
			const value = evaluateExpression(expression.operand, environment, invoke);
			if (expression.operator === '!') return !asBoolean(value);
			if (typeof value === 'bigint') return -value;
			if (typeof value !== 'number') throw new ReferenceEvaluationError('Unary minus requires a number');
			return Number.isInteger(value) ? intNegate(value) : -value;
		}
		case 'ConditionalExpression': return asBoolean(evaluateExpression(expression.condition, environment, invoke))
			? evaluateExpression(expression.thenExpression, environment, invoke)
			: evaluateExpression(expression.elseExpression, environment, invoke);
		case 'CallExpression': {
			const callee = evaluateExpression(expression.callee, environment, invoke);
			const args = expression.arguments.map(argument => evaluateExpression(argument, environment, invoke));
			if (isFunctionReference(callee)) return invoke(callee.$function, args);
			throw new ReferenceEvaluationError('Only pure user functions are callable in the reference evaluator');
		}
		case 'ListExpression': return expression.items.map(item => evaluateExpression(item, environment, invoke));
		case 'TupleExpression': return expression.items.map(item => evaluateExpression(item, environment, invoke));
		case 'RecordExpression': return Object.assign(Object.create(null), Object.fromEntries(expression.entries.map(entry => [entry.name, evaluateExpression(entry.value, environment, invoke)])));
		case 'RecordUpdateExpression': return Object.assign(Object.create(null), evaluateExpression(expression.base, environment, invoke), Object.fromEntries(expression.entries.map(entry => [entry.name, evaluateExpression(entry.value, environment, invoke)])));
		case 'FieldExpression': {
			const target = evaluateExpression(expression.target, environment, invoke);
			if (target === null || typeof target !== 'object') throw new ReferenceEvaluationError(`Cannot access field ${expression.field}`);
			return (target as Record<string, unknown>)[expression.field];
		}
		case 'MatchExpression': {
			const target = evaluateExpression(expression.target, environment, invoke);
			for (const arm of expression.arms) {
				const bindings = new Map<string, unknown>();
				if (!matchPattern(arm.pattern, target, bindings)) continue;
				const child = new Map(environment);
				for (const [name, value] of bindings) child.set(name, value);
				if (arm.guard !== undefined && !asBoolean(evaluateExpression(arm.guard, child, invoke))) continue;
				return evaluateExpression(arm.expression, child, invoke);
			}
			throw new ReferenceEvaluationError('Non-exhaustive match reached the reference evaluator');
		}
		case 'PipelineExpression': {
			if (expression.right.kind !== 'CallExpression') throw new ReferenceEvaluationError('Unsupported pipeline target');
			const rewritten = { ...expression.right, arguments: [expression.left, ...expression.right.arguments] };
			return evaluateExpression(rewritten, environment, invoke);
		}
		case 'LambdaExpression':
		case 'TryExpression':
		case 'AwaitExpression':
		case 'ParallelExpression':
		case 'WildcardExpression':
			throw new ReferenceEvaluationError(`${expression.kind} is outside the pure reference subset`);
	}
}

function evaluateBinary(expression: BinaryExpression, environment: Environment, invoke: (name: string, args: readonly unknown[]) => unknown): unknown {
	const left = evaluateExpression(expression.left, environment, invoke);
	if (expression.operator === '&&') return asBoolean(left) && asBoolean(evaluateExpression(expression.right, environment, invoke));
	if (expression.operator === '||') return asBoolean(left) || asBoolean(evaluateExpression(expression.right, environment, invoke));
	const right = evaluateExpression(expression.right, environment, invoke);
	if (expression.operator === '==') return viruneEquals(left, right);
	if (expression.operator === '!=') return !viruneEquals(left, right);
	if (['<', '<=', '>', '>='].includes(expression.operator)) return compare(expression.operator, left, right);
	if (typeof left === 'string' && typeof right === 'string' && expression.operator === '+') return left + right;
	if (typeof left === 'bigint' && typeof right === 'bigint') {
		switch (expression.operator) { case '+': return left + right; case '-': return left - right; case '*': return left * right; case '/': return left / right; case '%': return left % right; }
	}
	if (typeof left !== 'number' || typeof right !== 'number') throw new ReferenceEvaluationError(`Operator ${expression.operator} requires numeric operands`);
	if (!Number.isInteger(left) || !Number.isInteger(right)) {
		switch (expression.operator) { case '+': return left + right; case '-': return left - right; case '*': return left * right; case '/': return left / right; case '%': return left % right; }
	}
	switch (expression.operator) { case '+': return intAdd(left, right); case '-': return intSubtract(left, right); case '*': return intMultiply(left, right); case '/': return intDivide(left, right); case '%': return intRemainder(left, right); default: throw new ReferenceEvaluationError(`Unsupported operator ${expression.operator}`); }
}

function compare(operator: string, left: unknown, right: unknown): boolean {
	if (typeof left === 'number' && typeof right === 'number') return compareOrdered(operator, left, right);
	if (typeof left === 'bigint' && typeof right === 'bigint') return compareOrdered(operator, left, right);
	if (typeof left === 'string' && typeof right === 'string') return compareOrdered(operator, left, right);
	throw new ReferenceEvaluationError('Ordered comparison requires equal ordered types');
}

function compareOrdered<T extends number | bigint | string>(operator: string, left: T, right: T): boolean {
	switch (operator) {
		case '<': return left < right;
		case '<=': return left <= right;
		case '>': return left > right;
		case '>=': return left >= right;
		default: throw new ReferenceEvaluationError(`Unsupported comparison ${operator}`);
	}
}

function matchPattern(pattern: Pattern, value: unknown, bindings: Map<string, unknown>): boolean {
	switch (pattern.kind) {
		case 'WildcardPattern': return true;
		case 'BindingPattern': bindings.set(pattern.name, value); return true;
		case 'LiteralPattern': return viruneEquals(pattern.value, value);
		case 'OrPattern': return pattern.alternatives.some(alternative => {
			const local = new Map<string, unknown>();
			if (!matchPattern(alternative, value, local)) return false;
			for (const [name, item] of local) bindings.set(name, item);
			return true;
		});
		case 'RangePattern': return typeof value === 'number' && value >= pattern.start && value <= pattern.end;
		case 'TuplePattern': {
			if (!Array.isArray(value) || value.length !== pattern.items.length) return false;
			return pattern.items.every((item, index) => matchPattern(item, value[index], bindings));
		}
		case 'ListPattern': {
			if (!Array.isArray(value) || value.length < pattern.items.length || (pattern.rest === undefined && value.length !== pattern.items.length)) return false;
			for (let index = 0; index < pattern.items.length; index++) if (!matchPattern(pattern.items[index]!, value[index], bindings)) return false;
			if (pattern.rest?.kind === 'BindingPattern') bindings.set(pattern.rest.name, value.slice(pattern.items.length));
			return true;
		}
		case 'VariantPattern': {
			if (value === null || typeof value !== 'object') return false;
			const tagged = value as { readonly $tag?: string; readonly $values?: readonly unknown[] };
			if (tagged.$tag !== pattern.name || tagged.$values?.length !== pattern.values.length) return false;
			return pattern.values.every((item, index) => matchPattern(item, tagged.$values![index], bindings));
		}
		case 'RecordPattern': {
			if (value === null || typeof value !== 'object') return false;
			const record = value as Record<string, unknown>;
			return pattern.fields.every(field => Object.hasOwn(record, field.name) && matchPattern(field.pattern, record[field.name], bindings));
		}
	}
}

function asBoolean(value: unknown): boolean {
	if (typeof value !== 'boolean') throw new ReferenceEvaluationError('Expected Bool');
	return value;
}

function isFunctionReference(value: unknown): value is { readonly $function: string } {
	return value !== null && typeof value === 'object' && typeof (value as { readonly $function?: unknown }).$function === 'string';
}
