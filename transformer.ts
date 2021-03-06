import * as ts from 'typescript'
import {
  isArrayMethodCallExpression,
  isFunction,
  getSimpleArrayMethodExpression,
  MethodCallExpression,
  isArrayForOfStatement,
  isFunctionType
} from './type'
import { createFilterTmpFunction, createMapTmpFunction, createForEachTmpFunction, createFor } from './createStatement'

export default function transformer(program: ts.Program): ts.TransformerFactory<ts.SourceFile> {
  return (context: ts.TransformationContext) => (file: ts.SourceFile) => visitNodeAndChildren(file, program, context)
}

function visitNodeAndChildren(
  node: ts.SourceFile,
  program: ts.Program,
  context: ts.TransformationContext
): ts.SourceFile
function visitNodeAndChildren(
  node: ts.Node,
  program: ts.Program,
  context: ts.TransformationContext
): ts.Node | undefined
function visitNodeAndChildren(
  node: ts.Node,
  program: ts.Program,
  context: ts.TransformationContext
): ts.Node | undefined {
  return ts.visitEachChild(
    visitNode(node, program, context),
    childNode => visitNodeAndChildren(childNode, program, context),
    context
  )
}

function visitNode(node: ts.SourceFile, program: ts.Program, context: ts.TransformationContext): ts.SourceFile
function visitNode(node: ts.Node, program: ts.Program, context: ts.TransformationContext): ts.Node | undefined
function visitNode(node: ts.Node, program: ts.Program, context: ts.TransformationContext): ts.Node | undefined {
  const typeChecker = program.getTypeChecker()
  if (isArrayMethodCallExpression(node, typeChecker)) {
    return transformArrayMethods(node, context, typeChecker)
  }

  if (isArrayForOfStatement(node, typeChecker)) {
    return transformForOf(node, context)
  }

  return node
}

const ArrayIterationMethods = [
  'every',
  'fill',
  'filter',
  'find',
  'findIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some'
]

function transformArrayMethods(
  node: MethodCallExpression,
  context: ts.TransformationContext,
  typeChecker: ts.TypeChecker
): ts.Expression {
  const expression = getSimpleArrayMethodExpression(node.expression)

  const base = expression.expression
  const method = expression.name
  const methodName = method.getText()

  if (!ArrayIterationMethods.includes(methodName)) {
    return node
  }

  if (!['filter', 'map', 'forEach'].includes(methodName)) {
    console.log('Array::filter, Array::map and Array::forEach are only supported. Method name:', methodName)
    return node
  }

  const args = node.arguments
  const callback = args[0]
  const thisArg = args[1]
  if (!isFunction(callback) && !isFunctionType(typeChecker.getTypeAtLocation(callback))) {
    console.log('The first arg is not a function:', methodName)
    return node
  }

  const bindedCallback = thisArg ? ts.createCall(ts.createPropertyAccess(callback, 'bind'), [], [thisArg]) : callback

  let tmpFunction
  if (methodName === 'filter') {
    tmpFunction = createFilterTmpFunction(bindedCallback)
  } else if (methodName === 'map') {
    tmpFunction = createMapTmpFunction(bindedCallback)
  } else if (methodName === 'forEach') {
    tmpFunction = createForEachTmpFunction(bindedCallback)
  } else {
    throw new Error(`Transform Error: unsupported method was going to be transformed: ${methodName}`)
  }

  return ts.updateCall(node, tmpFunction, [], [base])
}

function transformForOf(node: ts.ForOfStatement, context: ts.TransformationContext): ts.Statement {
  const initializer = node.initializer
  if (!ts.isVariableDeclarationList(initializer)) {
    console.log('Ignoring because initializer type is unknown: ', initializer)
    return node
  }
  const nDeclarations = initializer.declarations
  if (nDeclarations.length !== 1) {
    console.log('Ignoring because initializer length is unknown: ', nDeclarations)
    return node
  }
  const n = nDeclarations[0]
  if (!ts.isIdentifier(n.name)) {
    console.log('Ignoring because name was not identifier: ', n.name)
    return node
  }

  const arr = node.expression
  const statement = node.statement

  let statements: ts.NodeArray<ts.Statement> | ts.Statement[]
  if (ts.isBlock(statement)) {
    statements = statement.statements
  } else {
    statements = [statement]
  }

  return createFor(arr, () => statements, false, n.name)
}
