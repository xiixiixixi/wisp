import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceRoot = path.join(root, 'apps/client/src');

export function flattenMessages(value, prefix = '', result = {}) {
  for (const [key, text] of Object.entries(value)) {
    if (typeof text === 'string') result[prefix + key] = text;
    else flattenMessages(text, `${prefix}${key}.`, result);
  }
  return result;
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(file) && !/\.(test|spec)\./.test(file) ? [file] : [];
  });
}

export function auditI18n() {
  const messages = Object.fromEntries(
    ['en', 'zh'].map((language) => [
      language,
      flattenMessages(
        JSON.parse(fs.readFileSync(path.join(sourceRoot, `locales/${language}.json`), 'utf8')),
      ),
    ]),
  );
  const parity = [...new Set([...Object.keys(messages.en), ...Object.keys(messages.zh)])].filter(
    (key) => !(key in messages.en) || !(key in messages.zh),
  );
  const placeholders = (text) =>
    [...text.matchAll(/{{\s*([^},]+)(?:,[^}]+)?\s*}}/g)].map((match) => match[1].trim()).sort();
  const interpolation = Object.keys(messages.en).filter(
    (key) =>
      messages.zh[key] &&
      JSON.stringify(placeholders(messages.en[key])) !==
        JSON.stringify(placeholders(messages.zh[key])),
  );
  const missing = [];
  const literals = [];
  const files = sourceFiles(sourceRoot);
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const location = (node) => ({
      file: path.relative(root, file),
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
    const visit = (node) => {
      const checkKey = (key, options) => {
        if (!messages.en[key] && !messages.en[`${key}_one`] && !messages.en[`${key}_other`]) {
          missing.push({ ...location(node), key, options });
        }
      };
      const checkExpression = (expression, options) => {
        if (!expression) return;
        if (ts.isStringLiteralLike(expression)) checkKey(expression.text, options);
        else if (ts.isConditionalExpression(expression)) {
          checkExpression(expression.whenTrue, options);
          checkExpression(expression.whenFalse, options);
        }
      };
      if (ts.isCallExpression(node) && /^(t|tUi|i18n\.t)$/.test(node.expression.getText(source))) {
        checkExpression(node.arguments[0], node.arguments[1]?.getText(source));
      }
      if (
        ts.isJsxAttribute(node) &&
        node.name.text === 'i18nKey' &&
        node.initializer &&
        ts.isStringLiteral(node.initializer)
      ) {
        checkKey(node.initializer.text);
      }
      if (ts.isJsxText(node) && /[a-zA-Z\u4e00-\u9fff]{2}/.test(node.text)) {
        literals.push({
          ...location(node),
          kind: 'text',
          text: node.text.trim().replace(/\s+/g, ' '),
        });
      }
      if (
        ts.isJsxAttribute(node) &&
        /^(title|placeholder|aria-label|alt|label|description)$/.test(node.name.text) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        /[a-zA-Z\u4e00-\u9fff]{2}/.test(node.initializer.text)
      ) {
        literals.push({ ...location(node), kind: node.name.text, text: node.initializer.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return {
    files: files.length,
    keys: Object.keys(messages.en).length,
    parity,
    interpolation,
    missing,
    literals,
  };
}

// Extension bundles do not share the host's catalog. Report their independent
// coverage explicitly; the core key check must not imply these are translated.
export function auditExtensionI18n() {
  const extensionRoot = path.join(root, 'packages/extensions');
  const files = fs.readdirSync(extensionRoot, { withFileTypes: true }).flatMap((entry) => {
    const directory = path.join(extensionRoot, entry.name, 'src');
    return entry.isDirectory() && fs.existsSync(directory) ? sourceFiles(directory) : [];
  });
  const findings = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const literals = [];
    const visit = (node) => {
      if (ts.isJsxText(node) && /[A-Za-z]{3}/.test(node.text)) {
        literals.push(node.text.trim().replace(/\s+/g, ' '));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (literals.length)
      findings.push({
        file: path.relative(root, file),
        candidates: literals.length,
        samples: literals.slice(0, 3),
      });
  }
  return { files: files.length, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--extensions')) {
    console.log(JSON.stringify(auditExtensionI18n(), null, 2));
    process.exit(0);
  }
  const result = auditI18n();
  console.log(
    JSON.stringify(
      process.argv.includes('--json')
        ? result
        : {
            files: result.files,
            keys: result.keys,
            parity: result.parity,
            interpolation: result.interpolation,
            missing: [...new Set(result.missing.map(({ key }) => key))],
            literalCandidates: result.literals.length,
          },
      null,
      2,
    ),
  );
  if (result.parity.length || result.interpolation.length || result.missing.length)
    process.exitCode = 1;
}
