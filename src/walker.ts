const _exts = [".js", ".ts"];
const _exclude = ["node_modules"];

export class Walker {
  readonly roots!: string[];
  stack!: string[];

  constructor(private ts: typeof import("typescript/lib/tsserverlibrary"), ...roots: string[]) {
    this.roots = roots;
  }

  *[Symbol.iterator]() {
    debugger;
    this.stack = [...this.roots];
    while (this.stack.length) {
      const current = this.stack.pop()!;
      const dirs = this.ts.sys.readDirectory(current, _exts, _exclude);
      this.stack.push(...dirs);
      yield* dirs;
    }
  }
}
