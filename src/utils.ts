import type ts from "typescript/lib/tsserverlibrary";

type Guard<T> = T extends (value: any) => value is infer Type ? Type : unknown;
export function assert<T extends Function | Function[]>(
  matcher: T,
  value: unknown
): asserts value is T extends any[] ? Guard<T[number]> : Guard<T> {
  const condition = typeof matcher === "function" ? matcher(value) : matcher.some((e) => e(value));
  if (!condition) throw new Error("Assertion error");
}

export default function utils(ts: typeof import("typescript/lib/tsserverlibrary")) {
  function inRange(pos: number, node: ts.TextRange) {
    return pos >= node.pos && pos < node.end;
  }

  function quote(strings: TemplateStringsArray, ...tokens: any[]) {
    tokens.reverse();
    const ret = [];
    for (const str of strings) {
      ret.push(str);
      if (!tokens.length) continue;
      let token = tokens.pop() || "";
      if (typeof token.getText === "function") {
        ret.push(token.getText());
      } else {
        ret.push(`${token}`);
      }
    }
    return ret.join("");
  }

  function isInImport({ parent }: ts.StringLiteral) {
    return (
      ts.isImportDeclaration(parent) ||
      (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.escapedText === "require")
    );
  }

  function findTopLevelStatement(sourceFile: ts.SourceFile, pos: number) {
    for (const stmt of sourceFile.statements) {
      if (inRange(pos, stmt)) return stmt;
    }
  }

  function cached<F extends (..._: any[]) => any>(func: F) {
    let map = new WeakMap<Parameters<F>, ReturnType<F>>();
    let hits = 0;
    let misses = 0;
    function wrapped(...args: Parameters<F>): ReturnType<F> {
      if (map.has(args)) {
        hits += 1;
        return map.get(args)!;
      } else {
        misses += 1;
        return map.set(args, func(...args)).get(args)!;
      }
    }
    wrapped.reset = () => void (map = new WeakMap());
    wrapped.report = () => ({ hits, misses });
    return wrapped;
  }

  return {
    inRange,
    isInImport,
    findTopLevelStatement,
    quote,
    cached,
  };
}
