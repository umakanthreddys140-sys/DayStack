import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseDir = __dirname;
const indexHtml = fs.readFileSync(path.join(baseDir, 'app.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(baseDir, 'styles.css'), 'utf8');
const chartJs = fs.readFileSync(path.join(baseDir, 'vendor', 'chart.umd.js'), 'utf8');
const appJs = fs.readFileSync(path.join(baseDir, 'app.js'), 'utf8');

// Build self-contained HTML
let standalone = indexHtml;

// Replace CSS link with inline style safely
standalone = standalone.replace(
  /<link rel="stylesheet" href="styles\.css[^"]*">/,
  () => `<style>\n${stylesCss}\n</style>`
);

// Replace external scripts with inline scripts safely
const scriptBlock = `
<script>
/* --- Inlined Chart.js Library --- */
${chartJs}
</script>
<script>
/* --- Inlined DAYSTACK Core Application Engine --- */
${appJs}
</script>
`;

standalone = standalone.replace(
  /<script src="vendor\/chart\.umd\.js"><\/script>[\s\S]*?<script src="app\.js[^"]*"><\/script>/,
  () => scriptBlock
);

fs.writeFileSync(path.join(baseDir, 'daystack-standalone.html'), standalone, 'utf8');
fs.writeFileSync(path.join(baseDir, 'daystack.html'), standalone, 'utf8');
fs.writeFileSync(path.join(baseDir, 'orvyn-standalone.html'), standalone, 'utf8');
fs.writeFileSync(path.join(baseDir, 'orvyn.html'), standalone, 'utf8');
console.log('✅ Generated daystack-standalone.html, daystack.html, orvyn-standalone.html successfully! (Single-file offline edition)');
