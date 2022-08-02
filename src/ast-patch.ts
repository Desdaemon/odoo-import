import type ts from "typescript/lib/tsserverlibrary";

export default function astPatch(ts: typeof import("typescript/lib/tsserverlibrary")) {
  const S = ts.SyntaxKind;
  /**
   * Advance to the next token of the matching `kind` if exists.
   */
  function find(kind: ts.SyntaxKind, scanner: ts.Scanner) {
    do {
      scanner.scan();
    } while (scanner.getToken() != kind && scanner.getToken() != S.EndOfFileToken);
    return scanner.getToken() == kind;
  }

  function peek(kind: ts.SyntaxKind, scanner: ts.Scanner, count = 1) {
    return scanner.lookAhead(() => {
      let token;
      while (count--) token = scanner.scan();
      return token == kind;
    });
  }

  /**
   * Advances the scanner from, but not including {@link left},
   * to the matching {@link right} token.
   * @param reset By default, the procedure is wrapped in a {@link ts.Scanner.lookAhead | Scanner.lookAhead}
   * to reset the scanner to {@link left}. If this is false, the scanner will not be reset.
   */
  function delimited(
    left: ts.SyntaxKind,
    right: ts.SyntaxKind,
    scanner: ts.Scanner,
    reset = true
  ): ts.TextSpan | undefined {
    let stack = 1;
    function _span() {
      let start = scanner.getTokenPos();
      do {
        let token;
        do {
          token = scanner.scan();
        } while (token != left && token != right && token != S.EndOfFileToken);
        switch (token) {
          case left:
            stack += 1;
            break;
          case right:
            stack -= 1;
            break;
          case S.EndOfFileToken:
            return;
          default:
            console.error("Unexpected token: " + scanner.getTokenText());
            return;
        }
      } while (stack != 0);
      return { start, length: scanner.getTokenPos() - start };
    }
    return reset ? scanner.lookAhead(_span) : _span();
  }

  function findFinalReturn(file: string) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true);
    scanner.setText(file);
    let token: ts.SyntaxKind;

    if (!find(S.OpenBraceToken, scanner)) return;
    const body = delimited(S.OpenBraceToken, S.CloseBraceToken, scanner);
    if (!body) return;

    // Exclude the braces
    const contents = file.substring(body.start + 1, body.start + body.length - 2);
    scanner.setText(contents);
    while (true) {
      do {
        token = scanner.scan();
      } while (token != S.OpenBraceToken && token != S.ReturnKeyword && token != S.EndOfFileToken);
      if (peek(S.SemicolonToken, scanner)) return;
      switch (token) {
        case S.ReturnKeyword:
          return body.start + 1 + scanner.getTokenPos();
        case S.OpenBraceToken:
          delimited(S.OpenBraceToken, S.CloseBraceToken, scanner, false);
          break;
        case S.EndOfFileToken:
          return;
      }
    }
  }

  function virtualModule(file: string, alias: string) {
    let moduleIndex = file.indexOf(alias);
    if (moduleIndex == -1) return file;

    // Include the quote
    moduleIndex -= 1;
    const module = file.substring(moduleIndex);
    const pos = findFinalReturn(module);
    if (typeof pos !== "number") return file;

    return file.substring(0, moduleIndex) + module.substring(0, pos) + "module.exports=" + module.substring(pos + 6);
  }

  /**
   * Replaces the final return in a classic Odoo module scope with `module.exports =`.
   * @param file The contents of the file. Assumed to contain a single classic module declaration.
   * @param alias Name of the classic module, used for disambiguation.
   */
  function replaceFinalReturn(file: string, alias: string) {
    if (file.indexOf("odoo") != file.lastIndexOf("odoo")) return virtualModule(file, alias);

    const pos = findFinalReturn(file);
    if (typeof pos === "number") {
      return file.substring(0, pos) + "module.exports=" + file.substring(pos + 6);
    }

    return replaceLast(file, "=>", "=>module.exports=");
  }

  function replaceLast(src: string, needle: string, replace: string) {
    const idx = src.lastIndexOf(needle);
    if (idx != -1) {
      src = src.slice(0, idx) + replace + src.slice(idx + needle.length);
    }
    return src;
  }

  return { replaceFinalReturn, replaceLast };
}
