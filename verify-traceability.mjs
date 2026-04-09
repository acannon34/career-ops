#!/usr/bin/env node
/**
 * verify-traceability.mjs — Audit full pipeline traceability
 *
 * Checks:
 * 1. Every report has a matching JD in jds/
 * 2. Every report contains a **URL:** header
 * 3. Every report with score 4.0+ has a matching PDF in output/
 * 4. Every tracker entry with a report link has a matching report file
 * 5. Every evaluated role URL appears in scan-history.tsv
 *
 * Run: node career-ops/verify-traceability.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(CAREER_OPS, 'reports');
const JDS_DIR = join(CAREER_OPS, 'jds');
const OUTPUT_DIR = join(CAREER_OPS, 'output');
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const SCAN_HISTORY = join(CAREER_OPS, 'data/scan-history.tsv');

let pass = 0;
let fail = 0;
let warn = 0;
const issues = [];
const warnings = [];

// --- 1. Check reports ---
const reports = existsSync(REPORTS_DIR)
  ? readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md') && /^\d{3}/.test(f))
  : [];
console.log(`\nReports found: ${reports.length}`);

for (const report of reports) {
  const num = report.match(/^(\d{3})/)?.[1];
  const content = readFileSync(join(REPORTS_DIR, report), 'utf8');

  // Check URL header
  if (/\*\*URL:\*\*\s+\S+/.test(content)) {
    pass++;
  } else {
    fail++;
    issues.push(`${report}: missing **URL:** header`);
  }

  // Check score
  const scoreMatch = content.match(/\*\*Score:\*\*\s+([\d.]+)/);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;

  // Check matching JD
  if (existsSync(JDS_DIR)) {
    const jdFiles = readdirSync(JDS_DIR).filter(f => f.startsWith(num) && f.endsWith('.md'));
    if (jdFiles.length > 0) {
      pass++;
    } else {
      fail++;
      issues.push(`${report}: no matching JD in jds/ (expected ${num}-*.md)`);
    }
  } else {
    fail++;
    issues.push(`jds/ directory does not exist`);
  }

  // Check PDF if score 4.0+
  if (score >= 4.0 && existsSync(OUTPUT_DIR)) {
    const slug = report.replace(/^\d{3}-/, '').replace(/-\d{4}-\d{2}-\d{2}\.md$/, '');
    const allPdfs = readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.pdf'));
    const matchingPdfs = allPdfs.filter(f => f.includes(num) || f.includes(slug));
    if (matchingPdfs.length > 0) {
      pass++;
      // Check if PDF uses new naming (includes report number)
      const hasReportNum = matchingPdfs.some(f => f.includes(`-${num}-`));
      if (!hasReportNum) {
        warn++;
        warnings.push(`${report}: PDF exists but uses legacy naming (no report # in filename)`);
      }
    } else {
      fail++;
      issues.push(`${report}: score ${score} but no PDF found in output/`);
    }
  }
}

// --- 2. Check tracker entries (column-position-agnostic) ---
if (existsSync(APPS_FILE)) {
  const tracker = readFileSync(APPS_FILE, 'utf8');
  const rows = tracker.split('\n').filter(l => {
    if (!l.startsWith('|')) return false;
    const first = l.split('|')[1]?.trim();
    return first && first !== '#' && !first.startsWith('---') && first !== '';
  });
  console.log(`Tracker entries: ${rows.length}`);

  for (const row of rows) {
    // Find report link by regex, not by column index
    const reportMatch = row.match(/\[(\d{3})\]\(reports\//);
    if (reportMatch) {
      const reportNum = reportMatch[1];
      const reportFiles = readdirSync(REPORTS_DIR).filter(f => f.startsWith(reportNum));
      if (reportFiles.length > 0) {
        pass++;
      } else {
        fail++;
        issues.push(`Tracker: references report ${reportNum} but file not found`);
      }
    }
  }
}

// --- 3. Check scan-history coverage (match exact URL from report) ---
if (existsSync(SCAN_HISTORY)) {
  const scanHistory = readFileSync(SCAN_HISTORY, 'utf8');
  for (const report of reports) {
    const content = readFileSync(join(REPORTS_DIR, report), 'utf8');
    const urlMatch = content.match(/\*\*URL:\*\*\s+(\S+)/);
    if (urlMatch) {
      const reportUrl = urlMatch[1];
      if (scanHistory.includes(reportUrl)) {
        pass++;
      } else {
        warn++;
        warnings.push(`${report}: URL ${reportUrl} not found in scan-history.tsv (may be manually added)`);
      }
    }
  }
}

// --- Summary ---
console.log(`\n${'='.repeat(50)}`);
console.log(`Traceability Audit — ${new Date().toISOString().slice(0, 10)}`);
console.log(`${'='.repeat(50)}`);
console.log(`Checks passed: ${pass}`);
console.log(`Checks failed: ${fail}`);
console.log(`Warnings: ${warn}`);
if (issues.length > 0) {
  console.log(`\nFailures:`);
  issues.forEach(i => console.log(`  ❌ ${i}`));
}
if (warnings.length > 0) {
  console.log(`\nWarnings:`);
  warnings.forEach(w => console.log(`  ⚠️  ${w}`));
}
console.log(`\nStatus: ${fail === 0 ? 'PASS ✅' : 'FAIL ❌'}`);
process.exit(fail > 0 ? 1 : 0);
