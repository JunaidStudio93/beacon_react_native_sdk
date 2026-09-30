import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/// Metro resolves `require()` statically at build time, so a non-literal
/// argument (`require(name)`) can never resolve on device — it throws at
/// runtime and, if the call site swallows the error, degrades silently.
///
/// Node resolves requires at runtime, so the unit tests above cannot catch
/// this. This scan can.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('Metro compatibility', () => {
  test('every require() uses a literal module name', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(join(__dirname, '..', 'src'))) {
      const source = readFileSync(file, 'utf8');
      source.split('\n').forEach((line, index) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) {
          return;
        }
        // A require whose first argument is not a quoted string literal.
        if (/\brequire\s*\(\s*[^'"\s)]/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
