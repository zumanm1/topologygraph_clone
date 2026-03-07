#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GRAPH_TIME = (process.env.GRAPH_TIME || process.env.GRAPH_TIMES || '').split(',')[0].trim() || resolveLatestGraphTime();

let PASS = 0;
let FAIL = 0;

function pass(tag, msg) { PASS++; console.log(`  ✅ PASS [${tag}]: ${msg}`); }
function fail(tag, msg) { FAIL++; console.log(`  ❌ FAIL [${tag}]: ${msg}`); }

function resolveLatestGraphTime() {
  const inout = path.join(ROOT, 'IN-OUT-FOLDER');
  if (!fs.existsSync(inout)) return '';
  const dirs = fs.readdirSync(inout)
    .filter(name => fs.existsSync(path.join(inout, name, 'nodes.json')))
    .filter(name => name.includes('_54_hosts'))
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : '';
}

function expectFile(tag, filePath, label) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    pass(tag, `${label}: ${path.relative(ROOT, filePath)}`);
    return true;
  }
  fail(tag, `${label} missing: ${path.relative(ROOT, filePath)}`);
  return false;
}

function expectDir(tag, dirPath, label) {
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    pass(tag, `${label}: ${path.relative(ROOT, dirPath)}`);
    return true;
  }
  fail(tag, `${label} missing: ${path.relative(ROOT, dirPath)}`);
  return false;
}

function safeJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function csvRowCount(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).length;
  } catch (error) {
    return 0;
  }
}

console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║   Step 10 Artifact Validation                                  ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log(`  ℹ  Graph time: ${GRAPH_TIME || '(auto-detect failed)'}`);

if (!GRAPH_TIME) {
  fail('PRE', 'No 54-host graph_time found in IN-OUT-FOLDER');
  console.log('');
  console.log(`TOTAL PASSED: ${PASS}`);
  console.log(`TOTAL FAILED: ${FAIL}`);
  process.exit(1);
}

const inputDir = path.join(ROOT, 'INPUT-FOLDER');
const inoutDir = path.join(ROOT, 'IN-OUT-FOLDER', GRAPH_TIME);
const asisDir = path.join(ROOT, 'OUTPUT', 'AS-IS', `${GRAPH_TIME}_AS-IS`);
const gatewayDir = path.join(ROOT, 'OUTPUT', 'GATEWAY', `${GRAPH_TIME}_GATEWAY`);
const enrichedDir = path.join(ROOT, 'OUTPUT', 'ENRICHED', `${GRAPH_TIME}_ENRICHED`);
const collapsingDir = path.join(ROOT, 'OUTPUT', 'COLLAPSING', `${GRAPH_TIME}_COLLAPSING`);

expectFile('INPUT', path.join(inputDir, 'ospf-database-54-unk-test.txt'), 'OSPF fixture');
expectFile('INPUT', path.join(inputDir, 'Load-hosts.csv'), 'Host CSV fixture');

if (expectDir('INOUT', inoutDir, 'IN-OUT graph folder')) {
  const nodesOk = expectFile('INOUT', path.join(inoutDir, 'nodes.json'), 'nodes.json');
  const edgesOk = expectFile('INOUT', path.join(inoutDir, 'edges.json'), 'edges.json');
  expectFile('INOUT', path.join(inoutDir, 'meta.json'), 'meta.json');
  expectFile('INOUT', path.join(inoutDir, 'edges.csv'), 'edges.csv');
  if (nodesOk) {
    const nodes = safeJson(path.join(inoutDir, 'nodes.json'));
    Array.isArray(nodes) && nodes.length >= 54
      ? pass('INOUT', `nodes.json contains ${nodes.length} nodes`)
      : fail('INOUT', 'nodes.json does not contain the expected 54-node dataset');
  }
  if (edgesOk) {
    const edges = safeJson(path.join(inoutDir, 'edges.json'));
    Array.isArray(edges) && edges.length > 0
      ? pass('INOUT', `edges.json contains ${edges.length} edges`)
      : fail('INOUT', 'edges.json is empty or unreadable');
  }
}

if (expectDir('AS-IS', asisDir, 'AS-IS output folder')) {
  expectFile('AS-IS', path.join(asisDir, 'AS-IS_nodes.json'), 'AS-IS_nodes.json');
  expectFile('AS-IS', path.join(asisDir, 'AS-IS_edges.json'), 'AS-IS_edges.json');
  expectFile('AS-IS', path.join(asisDir, 'AS-IS_meta.json'), 'AS-IS_meta.json');
  expectFile('AS-IS', path.join(asisDir, 'AS-IS_ospf-database.txt'), 'AS-IS_ospf-database.txt');
}

if (expectDir('GATEWAY', gatewayDir, 'GATEWAY output folder')) {
  const gwTopo = path.join(gatewayDir, 'GATEWAY_gateway-only-topology.json');
  const gwSummary = path.join(gatewayDir, 'GATEWAY_country-core-summary.json');
  const topoOk = expectFile('GATEWAY', gwTopo, 'GATEWAY_gateway-only-topology.json');
  expectFile('GATEWAY', path.join(gatewayDir, 'GATEWAY_gateway-only-topology.yaml'), 'GATEWAY_gateway-only-topology.yaml');
  const summaryOk = expectFile('GATEWAY', gwSummary, 'GATEWAY_country-core-summary.json');
  expectFile('GATEWAY', path.join(gatewayDir, 'GATEWAY_country-core-summary.yaml'), 'GATEWAY_country-core-summary.yaml');
  if (topoOk) {
    const topo = safeJson(gwTopo);
    const count = topo && Array.isArray(topo.nodes) ? topo.nodes.length : Array.isArray(topo) ? topo.length : 0;
    count > 0 ? pass('GATEWAY', `Gateway topology exposes ${count} node records`) : fail('GATEWAY', 'Gateway topology JSON appears empty');
  }
  if (summaryOk) {
    const summary = safeJson(gwSummary);
    const count = Array.isArray(summary) ? summary.length : summary && typeof summary === 'object' ? Object.keys(summary).length : 0;
    count > 0 ? pass('GATEWAY', `Country-core summary contains ${count} entries`) : fail('GATEWAY', 'Country-core summary JSON appears empty');
  }
}

if (expectDir('ENRICHED', enrichedDir, 'ENRICHED output folder')) {
  expectFile('ENRICHED', path.join(enrichedDir, 'ENRICHED_original-topology-with-country.json'), 'ENRICHED_original-topology-with-country.json');
  expectFile('ENRICHED', path.join(enrichedDir, 'ENRICHED_original-topology-with-country.yaml'), 'ENRICHED_original-topology-with-country.yaml');
  expectFile('ENRICHED', path.join(enrichedDir, 'ENRICHED_country-palette.json'), 'ENRICHED_country-palette.json');
  const mappingFile = path.join(enrichedDir, 'ENRICHED_country-mapping.csv');
  const mappingOk = expectFile('ENRICHED', mappingFile, 'ENRICHED_country-mapping.csv');
  if (mappingOk) {
    const rows = csvRowCount(mappingFile);
    rows > 1 ? pass('ENRICHED', `Country mapping CSV has ${rows - 1} data rows`) : fail('ENRICHED', 'Country mapping CSV has no data rows');
  }
}

if (expectDir('COLLAPSING', collapsingDir, 'COLLAPSING output folder')) {
  expectFile('COLLAPSING', path.join(collapsingDir, 'COLLAPSING_collapsed-topology.json'), 'COLLAPSING_collapsed-topology.json');
  expectFile('COLLAPSING', path.join(collapsingDir, 'COLLAPSING_collapsed-topology.yaml'), 'COLLAPSING_collapsed-topology.yaml');
  const configFile = path.join(collapsingDir, 'COLLAPSING_country-collapse-config.json');
  const configOk = expectFile('COLLAPSING', configFile, 'COLLAPSING_country-collapse-config.json');
  if (configOk) {
    const config = safeJson(configFile);
    config && typeof config === 'object'
      ? pass('COLLAPSING', `Collapse config keys: ${Object.keys(config).length}`)
      : fail('COLLAPSING', 'Collapse config JSON unreadable');
  }
}

console.log('');
console.log(`TOTAL PASSED: ${PASS}`);
console.log(`TOTAL FAILED: ${FAIL}`);
process.exit(FAIL > 0 ? 1 : 0);
