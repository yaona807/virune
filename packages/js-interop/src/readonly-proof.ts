import ts from 'typescript';

export function contextualObjectEntryIsWritable(type: ts.Type, propertyName: string, checker: ts.TypeChecker): boolean {
	try {
		const flags = type.getFlags();
		if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) !== 0) return false;
		if (type.isUnionOrIntersection()) return type.types.every(item => contextualObjectEntryIsWritable(item, propertyName, checker));
		if ((flags & ts.TypeFlags.Object) === 0) return false;
		const objectType = type as ts.ObjectType;
		if ((objectType.objectFlags & ts.ObjectFlags.Mapped) !== 0) return false;
		const property = checker.getPropertyOfType(type, propertyName);
		if (property !== undefined) {
			const declarations = property.declarations;
			if (declarations === undefined || declarations.length === 0) return false;
			return declarations.every(declaration => {
				if (ts.isGetAccessorDeclaration(declaration)) return false;
				const modifiers = ts.getCombinedModifierFlags(declaration);
				return (modifiers & (ts.ModifierFlags.Readonly | ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0;
			});
		}
		const key = checker.getStringLiteralType(propertyName);
		const indexInfos = checker.getIndexInfosOfType(type).filter(info => checker.isTypeAssignableTo(key, info.keyType));
		return indexInfos.length === 1 && indexInfos[0]!.isReadonly === false;
	} catch {
		return false;
	}
}
