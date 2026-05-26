const { readdirSync, readFileSync, statSync } = require('fs');
const { join } = require('path');

const ROOT = process.cwd();
const TARGETS = [
  'README.md',
  'src/web',
  'public/js',
];
const EXTENSIONS = new Set(['.html', '.js', '.md', '.ts']);
const MOJIBAKE_PATTERNS = [
  '\uFFFD',
  '?붿',
  '?뚯',
  '?ㅼ',
  '?낅',
  '?댁',
  '?몃',
  '?뱁',
  '濡',
  '臾몄',
  '寃',
  '誘몃',
  '遺덈',
  '以묒',
  '李얠',
  '沅',
  '愿',
  '踰',
];

const failures = [];

for (const target of TARGETS) {
  scan(join(ROOT, target));
}

if (failures.length > 0) {
  console.error('Potential mojibake text found:');
  for (const failure of failures) {
    console.error(`- ${failure.file}:${failure.line}: ${failure.pattern}`);
  }
  process.exit(1);
}

console.log('Encoding check passed.');

function scan(path) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const name of readdirSync(path)) {
      scan(join(path, name));
    }
    return;
  }
  if (!EXTENSIONS.has(extension(path))) {
    return;
  }
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of MOJIBAKE_PATTERNS) {
      if (line.includes(pattern)) {
        failures.push({
          file: path.slice(ROOT.length + 1).replace(/\\/g, '/'),
          line: index + 1,
          pattern,
        });
      }
    }
  });
}

function extension(path) {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}
