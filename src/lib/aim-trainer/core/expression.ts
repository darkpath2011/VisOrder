/**
 * expression.ts evaluates and pretty-prints safe math expressions for aim control.
 * Users edit rotation formulas in settings; only arithmetic, parentheses, and a small
 * identifier/function whitelist are accepted so arbitrary JavaScript cannot run.
 */

/** Built-in constants and bound variables available inside a rotation expression. */
export type ExpressionScope = Record<string, number>;

/** Result of parsing + evaluating a user formula. */
export type ExpressionEvalResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/** Result of formatting a formula without evaluating numeric bindings. */
export type ExpressionFormatResult =
  | { ok: true; formatted: string }
  | { ok: false; error: string };

type Token =
  | { kind: "number"; value: number }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

type AstNode =
  | { type: "number"; value: number }
  | { type: "ident"; name: string }
  | { type: "unary"; op: "-"; arg: AstNode }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "^"; left: AstNode; right: AstNode }
  | { type: "call"; name: string; args: AstNode[] };

/** Default rotation formula matching the built-in rad-per-count conversion. */
export const DEFAULT_ROTATION_EXPR = "sens * yaw * pi / 180";

/** Whitelisted math helpers callable from expressions as name(...). */
const FUNCS: Record<string, (...args: number[]) => number> = {
  abs: (x) => Math.abs(x),
  sqrt: (x) => Math.sqrt(x),
  min: (...xs) => Math.min(...xs),
  max: (...xs) => Math.max(...xs),
  sin: (x) => Math.sin(x),
  cos: (x) => Math.cos(x),
  tan: (x) => Math.tan(x),
};

/**
 * tokenize splits source into numbers, identifiers, operators, and punctuation.
 * Rejects characters outside the safe math alphabet so scripts cannot sneak in.
 */
function tokenize(source: string): Token[] {
  const input = source.trim();
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < input.length && /[0-9.]/.test(input[i])) i += 1;
      const raw = input.slice(start, i);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new Error(`无效数字：${raw}`);
      }
      tokens.push({ kind: "number", value });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (i < input.length && /[A-Za-z0-9_]/.test(input[i])) i += 1;
      tokens.push({ kind: "ident", value: input.slice(start, i) });
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i += 1;
      continue;
    }
    if (ch === "*" && input[i + 1] === "*") {
      tokens.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }
    if ("+-*/^".includes(ch)) {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    throw new Error(`不支持的字符：${ch}`);
  }

  return tokens;
}

/**
 * parseExpression builds an AST with standard precedence: ^ > * / > + -.
 * Function calls use ident(...); unknown tokens surface as Chinese error strings.
 */
function parseExpression(source: string): AstNode {
  const tokens = tokenize(source);
  let index = 0;

  const peek = (): Token | undefined => tokens[index];
  const take = (): Token => {
    const token = tokens[index];
    if (!token) throw new Error("表达式不完整");
    index += 1;
    return token;
  };

  function parsePrimary(): AstNode {
    const token = take();
    if (token.kind === "number") return { type: "number", value: token.value };
    if (token.kind === "ident") {
      if (peek()?.kind === "lparen") {
        take();
        const args: AstNode[] = [];
        if (peek()?.kind !== "rparen") {
          args.push(parseAdd());
          while (peek()?.kind === "comma") {
            take();
            args.push(parseAdd());
          }
        }
        const close = take();
        if (close.kind !== "rparen") throw new Error("函数调用缺少 )");
        return { type: "call", name: token.value.toLowerCase(), args };
      }
      return { type: "ident", name: token.value.toLowerCase() };
    }
    if (token.kind === "lparen") {
      const inner = parseAdd();
      const close = take();
      if (close.kind !== "rparen") throw new Error("括号未闭合");
      return inner;
    }
    if (token.kind === "op" && token.value === "-") {
      return { type: "unary", op: "-", arg: parsePrimary() };
    }
    throw new Error("期望数字、变量或 (");
  }

  function peekOp(values: string[]): string | null {
    const token = peek();
    if (token?.kind === "op" && values.includes(token.value)) {
      return token.value;
    }
    return null;
  }

  function parsePower(): AstNode {
    let node = parsePrimary();
    while (peekOp(["^"])) {
      take();
      node = { type: "binary", op: "^", left: node, right: parsePrimary() };
    }
    return node;
  }

  function parseMul(): AstNode {
    let node = parsePower();
    let op = peekOp(["*", "/"]);
    while (op) {
      take();
      node = {
        type: "binary",
        op: op as "*" | "/",
        left: node,
        right: parsePower(),
      };
      op = peekOp(["*", "/"]);
    }
    return node;
  }

  function parseAdd(): AstNode {
    let node = parseMul();
    let op = peekOp(["+", "-"]);
    while (op) {
      take();
      node = {
        type: "binary",
        op: op as "+" | "-",
        left: node,
        right: parseMul(),
      };
      op = peekOp(["+", "-"]);
    }
    return node;
  }

  if (tokens.length === 0) throw new Error("表达式不能为空");
  const ast = parseAdd();
  if (index < tokens.length) throw new Error("表达式末尾有多余内容");
  return ast;
}

/**
 * evalAst walks the tree against a scope and whitelisted functions.
 * Division by zero and unknown names fail with a clear error for the settings UI.
 */
function evalAst(node: AstNode, scope: ExpressionScope): number {
  switch (node.type) {
    case "number":
      return node.value;
    case "ident": {
      if (!(node.name in scope)) {
        throw new Error(`未知变量：${node.name}`);
      }
      return scope[node.name];
    }
    case "unary":
      return -evalAst(node.arg, scope);
    case "binary": {
      const left = evalAst(node.left, scope);
      const right = evalAst(node.right, scope);
      switch (node.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          if (right === 0) throw new Error("除以零");
          return left / right;
        case "^":
          return left ** right;
      }
      break;
    }
    case "call": {
      const fn = FUNCS[node.name];
      if (!fn) throw new Error(`未知函数：${node.name}`);
      const args = node.args.map((arg) => evalAst(arg, scope));
      if (
        (node.name === "min" || node.name === "max") &&
        args.length < 1
      ) {
        throw new Error(`${node.name} 至少需要 1 个参数`);
      }
      if (
        node.name !== "min" &&
        node.name !== "max" &&
        args.length !== 1
      ) {
        throw new Error(`${node.name} 需要 1 个参数`);
      }
      return fn(...args);
    }
  }
  throw new Error("无法计算表达式");
}

/**
 * formatAst pretty-prints an AST with spaces around + - * / and tight ^ binding.
 * Parentheses are reintroduced only when needed for precedence or associativity.
 */
function formatAst(node: AstNode, parentPrec = 0, isRight = false): string {
  const precOf = (op: string): number => {
    if (op === "+" || op === "-") return 1;
    if (op === "*" || op === "/") return 2;
    if (op === "^") return 3;
    return 0;
  };

  switch (node.type) {
    case "number":
      return String(node.value);
    case "ident":
      return node.name;
    case "unary": {
      const inner = formatAst(node.arg, 3, true);
      return node.arg.type === "binary" ? `-(${inner})` : `-${inner}`;
    }
    case "call":
      return `${node.name}(${node.args.map((arg) => formatAst(arg)).join(", ")})`;
    case "binary": {
      const prec = precOf(node.op);
      const left = formatAst(node.left, prec, false);
      const right = formatAst(node.right, prec, true);
      const opText = node.op === "^" ? "^" : ` ${node.op} `;
      let text = `${left}${opText}${right}`;
      const needParen =
        prec < parentPrec ||
        (prec === parentPrec && (isRight || node.op === "-" || node.op === "/"));
      if (needParen) text = `(${text})`;
      return text;
    }
  }
}

/**
 * evaluateExpression parses and evaluates source against the provided scope.
 * Returns ok/value or ok/error without throwing so settings can show inline status.
 */
export function evaluateExpression(
  source: string,
  scope: ExpressionScope,
): ExpressionEvalResult {
  try {
    const value = evalAst(parseExpression(source), scope);
    if (!Number.isFinite(value)) {
      return { ok: false, error: "结果不是有限数字" };
    }
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "表达式无效",
    };
  }
}

/**
 * formatExpression rewrites a formula with consistent spacing and parentheses.
 * Formatting fails with the same parse errors as evaluation when syntax is invalid.
 */
export function formatExpression(source: string): ExpressionFormatResult {
  try {
    return { ok: true, formatted: formatAst(parseExpression(source)) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "表达式无效",
    };
  }
}

/**
 * rotationScope builds the variable map used by the aim rotation formula.
 * sens is the clamped in-game sensitivity; yaw/fov come from the selected profile.
 */
export function rotationScope(
  sens: number,
  yawDeg: number,
  verticalFovDeg: number,
): ExpressionScope {
  return {
    sens,
    yaw: yawDeg,
    fov: verticalFovDeg,
    pi: Math.PI,
  };
}
