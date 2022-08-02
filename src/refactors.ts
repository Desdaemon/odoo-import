import type ts from "typescript/lib/tsserverlibrary";
import utils, { assert } from "./utils";

export default function refactors(ts: typeof import("typescript/lib/tsserverlibrary")) {
  const { quote } = utils(ts);
  function toSpan(node: ts.Node) {
    const start = node.getStart();
    const end = node.getEnd();
    return {
      start,
      length: end - start,
    };
  }

  function getRequireModule(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text == "require" &&
      ts.isLiteralExpression(node.arguments[0])
    ) {
      return node.arguments[0].text;
    }
  }

  function getInlineTextChanges(stmt: ts.ExpressionStatement) {
    assert(ts.isCallExpression, stmt.expression);
    if (stmt.expression.arguments.length != 2) {
      throw new Error("Module declaration must have exactly two expressions.");
    }
    const {
      arguments: [module, scope],
    } = stmt.expression;
    assert(ts.isLiteralExpression, module);
    assert([ts.isFunctionExpression, ts.isArrowFunction], scope);

    const textChanges: ts.TextChange[] = [
      {
        // equivalent to inserting text
        span: { start: 0, length: 0 },
        newText: quote`/** @odoo-module alias=${module.text} */\n`,
      },
    ];
    if (ts.isBlock(scope.body)) {
      for (const stmt of scope.body.statements) {
        if (ts.isVariableStatement(stmt)) {
          /** var, let or const */
          const specifier = stmt.getFirstToken()!;
          textChanges.push({
            span: toSpan(specifier),
            newText: "",
          });
          let i = 1;
          let declCount = stmt.declarationList.declarations.length;
          for (const decl of stmt.declarationList.declarations) {
            const required = decl.initializer && getRequireModule(decl.initializer);
            if (required) {
              const span = toSpan(decl);
              // In a multi-declaration statement, the decls are joined by
              // a single-char comma which needs to be removed.
              if (i != declCount) span.length += 1;
              textChanges.push({
                newText: quote`import ${decl.name} from "${required}"`,
                span,
              });
            }
            i += 1;
          }
        } else if (ts.isExpressionStatement(stmt)) {
          const required = getRequireModule(stmt.expression);
          if (required) {
            textChanges.push({
              span: toSpan(stmt),
              newText: quote`import "${required}";`,
            });
          }
        } else if (ts.isReturnStatement(stmt)) {
          textChanges.push({
            span: toSpan(stmt),
            newText: quote`export default ${stmt.expression};`,
          });
        } else {
          debugger;
        }
      }
      // a body begins and ends with brace tokens.
      const leftBrace = scope.body.getFirstToken()!;
      const rightBrace = scope.body.getLastToken()!;
      textChanges.push(
        {
          span: { start: stmt.pos, length: leftBrace.end - stmt.pos },
          newText: "",
        },
        {
          span: {
            start: rightBrace.pos,
            length: stmt.end - rightBrace.pos,
          },
          newText: "",
        }
      );
    } else {
      textChanges.push({
        span: toSpan(stmt),
        newText: quote`export default ${scope.body};`,
      });
    }
    return textChanges;
  }

  const inlineAction = {
    name: "classicToEs6Inline",
    description: "Refactor classic module to ES6 module inline",
    getEdits(fileName: string, stmt: ts.ExpressionStatement): ts.RefactorEditInfo {
      return {
        edits: [{ fileName, textChanges: getInlineTextChanges(stmt) }],
      };
    },
  };

  function isSingleStatement(activeNode: ts.Statement) {
    return activeNode.getSourceFile().statements.length == 1;
  }

  const newfileAction = {
    name: "classicToEs6",
    description: "Refactor classic module to ES6 module in new file",
    getEdits(fileName: string, stmt: ts.ExpressionStatement): ts.RefactorEditInfo {
      return {
        edits: [
          {
            fileName,
            textChanges: [
              {
                span: toSpan(stmt),
                newText: "",
              },
            ],
          },
          {
            isNewFile: true,
            textChanges: getInlineTextChanges(stmt),
            fileName: "foo.js",
          },
        ],
      };
    },
  };
  function newfileApplicable(node: ts.Statement): node is ts.ExpressionStatement {
    return (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text == "odoo" &&
      node.expression.expression.name.text == "define"
    );
  }
  const refactorNamespace = "odooRefactor";
  function getRefactorInfo(activeNode: ts.Statement): ts.ApplicableRefactorInfo {
    const actions = [];
    if (newfileApplicable(activeNode)) {
      if (isSingleStatement(activeNode)) {
        actions.push(inlineAction);
      } else {
        actions.push(newfileAction);
      }
    }
    return {
      name: refactorNamespace,
      description: "Odoo Refactor Actions",
      actions,
    };
  }

  function isStringLiteral(node: ts.Node, sourceFile?: ts.SourceFile) {
    sourceFile ||= node.getSourceFile();
    main: while (!ts.isStringLiteral(node)) {
      for (const child of node.getChildren(sourceFile)) {
        if (child.end >= node.end) {
          node = child;
          continue main;
        }
      }
      return false;
    }
    return true;
  }
  return {
    refactorNamespace,
    inlineAction,
    isSingleStatement,
    newfileAction,
    newfileApplicable,
    getRefactorInfo,
    isStringLiteral,
  };
}
