import ts from 'typescript';
import { createContextId } from '../ids.js';
import { estimateTokens, sliceLines } from '../chunking/text.js';
import type { ContextEdgeRecord, ContextSymbolKind, ContextSymbolRecord, ExtractedContext, ScannedFile } from '../types.js';

export function extractTypeScriptContext(file: ScannedFile, fileId: string): ExtractedContext {
  const scriptKind = file.path.endsWith('.tsx') || file.path.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: ContextSymbolRecord[] = [];
  const edges: ContextEdgeRecord[] = [];

  function addSymbol(node: ts.Node, kind: ContextSymbolKind, name: string, parentSymbolId?: string): ContextSymbolRecord {
    const id = createContextId('sym');
    const range = nodeRange(sourceFile, node);
    const signature = compactSignature(sliceLines(file.content, range.startLine, Math.min(range.endLine, range.startLine + 6)));
    const symbol: ContextSymbolRecord = {
      id,
      fileId,
      parentSymbolId,
      name,
      qualifiedName: parentSymbolId ? `${symbols.find((s) => s.id === parentSymbolId)?.qualifiedName ?? ''}.${name}` : name,
      kind,
      exported: hasExportModifier(node),
      signature,
      docText: readJsDoc(node),
      startLine: range.startLine,
      endLine: range.endLine,
      startCol: range.startCol,
      endCol: range.endCol,
    };
    symbols.push(symbol);
    if (symbol.exported) {
      edges.push({
        id: createContextId('edg'),
        sourceKind: 'file',
        sourceId: fileId,
        targetKind: 'symbol',
        targetId: id,
        targetName: name,
        edgeType: 'file_exports_symbol',
        confidence: 1,
      });
    }
    return symbol;
  }

  function visit(node: ts.Node, parentSymbolId?: string): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      edges.push({
        id: createContextId('edg'),
        sourceKind: 'file',
        sourceId: fileId,
        targetKind: specifier.startsWith('.') ? 'file' : 'package',
        targetName: specifier,
        edgeType: specifier.startsWith('.') ? 'file_imports_file' : 'file_imports_package',
        confidence: specifier.startsWith('.') ? 0.9 : 0.85,
      });
    }

    const commandName = extractCommanderCommandName(node);
    if (commandName) {
      const command = addSymbol(node, 'command', commandName, parentSymbolId);
      edges.push({
        id: createContextId('edg'),
        sourceKind: 'file',
        sourceId: fileId,
        targetKind: 'command',
        targetId: command.id,
        targetName: commandName,
        edgeType: 'cli_registers_command',
        confidence: 0.8,
      });
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const symbol = addSymbol(node, 'function', node.name.text, parentSymbolId);
      ts.forEachChild(node, (child) => visit(child, symbol.id));
      return;
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const symbol = addSymbol(node, 'class', node.name.text, parentSymbolId);
      ts.forEachChild(node, (child) => visit(child, symbol.id));
      return;
    }
    if (ts.isMethodDeclaration(node) && node.name) {
      const symbol = addSymbol(node, 'method', node.name.getText(sourceFile), parentSymbolId);
      ts.forEachChild(node, (child) => visit(child, symbol.id));
      return;
    }
    if (ts.isConstructorDeclaration(node)) {
      const symbol = addSymbol(node, 'constructor', 'constructor', parentSymbolId);
      ts.forEachChild(node, (child) => visit(child, symbol.id));
      return;
    }
    if (ts.isInterfaceDeclaration(node)) {
      addSymbol(node, 'interface', node.name.text, parentSymbolId);
    } else if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(node, 'type', node.name.text, parentSymbolId);
    } else if (ts.isEnumDeclaration(node)) {
      addSymbol(node, 'enum', node.name.text, parentSymbolId);
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const initializer = declaration.initializer;
          if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer) || ts.isObjectLiteralExpression(initializer))) {
            addSymbol(node, 'variable', declaration.name.text, parentSymbolId);
          }
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      const range = nodeRange(sourceFile, node);
      const name = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : 'export';
      symbols.push({
        id: createContextId('sym'),
        fileId,
        parentSymbolId,
        name,
        qualifiedName: name,
        kind: 'export',
        exported: true,
        startLine: range.startLine,
        endLine: range.endLine,
        startCol: range.startCol,
        endCol: range.endCol,
      });
    }

    if (ts.isCallExpression(node)) {
      const callName = callExpressionName(node);
      if (callName && parentSymbolId) {
        edges.push({
          id: createContextId('edg'),
          sourceKind: 'symbol',
          sourceId: parentSymbolId,
          targetKind: 'identifier',
          targetName: callName,
          edgeType: 'symbol_calls_identifier',
          confidence: 0.3,
        });
      }
    }

    ts.forEachChild(node, (child) => visit(child, parentSymbolId));
  }

  visit(sourceFile);

  const chunks = symbols
    .filter((symbol) => symbol.kind !== 'import' && symbol.kind !== 'export')
    .map((symbol) => {
      const content = sliceLines(file.content, symbol.startLine, symbol.endLine);
      return {
        id: createContextId('chk'),
        fileId,
        symbolId: symbol.id,
        chunkKind: 'symbol' as const,
        title: symbol.qualifiedName,
        content,
        filePath: file.path,
        symbolName: symbol.name,
        language: file.language,
        startLine: symbol.startLine,
        endLine: symbol.endLine,
        tokenEstimate: estimateTokens(content),
      };
    });

  return { symbols, chunks, edges: deDupeEdges(edges) };
}

function nodeRange(sourceFile: ts.SourceFile, node: ts.Node): { startLine: number; endLine: number; startCol: number; endCol: number } {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { startLine: start.line + 1, endLine: end.line + 1, startCol: start.character, endCol: end.character };
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function readJsDoc(node: ts.Node): string | undefined {
  const docs = ts.getJSDocCommentsAndTags(node).map((doc) => doc.getText()).join('\n').trim();
  return docs.length > 0 ? docs.slice(0, 2000) : undefined;
}

function compactSignature(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function callExpressionName(node: ts.CallExpression): string | undefined {
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function extractCommanderCommandName(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  if (node.expression.name.text !== 'command') return undefined;
  const firstArg = node.arguments[0];
  if (!firstArg || !ts.isStringLiteralLike(firstArg)) return undefined;
  return firstArg.text.split(/\s+/)[0];
}

function deDupeEdges(edges: ContextEdgeRecord[]): ContextEdgeRecord[] {
  const seen = new Set<string>();
  const unique: ContextEdgeRecord[] = [];
  for (const edge of edges) {
    const key = [edge.sourceKind, edge.sourceId, edge.targetKind, edge.targetId, edge.targetName, edge.edgeType].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }
  return unique;
}
