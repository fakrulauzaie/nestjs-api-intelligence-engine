import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const spikeRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const cytoscapeSource = require.resolve('cytoscape/dist/cytoscape.min.js');
const templatePath = resolve(spikeRoot, 'offline-graph-template.html');
const outputPath = resolve(spikeRoot, '.output', 'offline-graph-spike.html');

const [library, template] = await Promise.all([
  readFile(cytoscapeSource, 'utf8'),
  readFile(templatePath, 'utf8'),
]);

if (!template.includes('/*__CYTOSCAPE_LIBRARY__*/')) {
  throw new Error('Offline graph template is missing its library marker.');
}

const html = template.replace('/*__CYTOSCAPE_LIBRARY__*/', library);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, html);

const externalReferences = [...html.matchAll(/(?:src|href)=["'](https?:|\/\/)/giu)].map(
  (match) => match[0],
);

process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      bytes: Buffer.byteLength(html),
      cytoscapeBytes: Buffer.byteLength(library),
      externalReferences,
      containsGraphData: html.includes('endpoint:GET:/notes'),
      contentSecurityPolicy: html.match(/Content-Security-Policy[^>]+/iu)?.[0] ?? null,
    },
    null,
    2,
  )}\n`,
);
