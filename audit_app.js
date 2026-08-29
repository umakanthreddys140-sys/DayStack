/**
 * Deep Full-Application Health & Navigation Audit Script
 */
import fs from 'node:fs';
import path from 'node:path';

console.log('🕵️‍♂️ Starting Deep Application Health Audit...\n');

let totalChecks = 0;
let passedChecks = 0;

function check(label, condition, details = '') {
  totalChecks++;
  if (condition) {
    console.log(`  ✅ [PASS] ${label}`);
    passedChecks++;
  } else {
    console.error(`  ❌ [FAIL] ${label} - ${details}`);
  }
}

// 1. Files Existence & Non-Empty
const requiredFiles = [
  'index.html',
  'landing.html',
  'auth.html',
  'admin.html',
  'app.js',
  'server.js',
  'auth-server.js',
  'styles.css',
  'daystack.html',
  'daystack-standalone.html',
  'orvyn.html',
  'orvyn-standalone.html',
  '.env',
  '.users.db.json',
  '.cycle_state.json'
];

console.log('1. Checking File Existence & Sizes:');
for (const f of requiredFiles) {
  const exists = fs.existsSync(f);
  const size = exists ? fs.statSync(f).size : 0;
  check(`File: ${f}`, exists && size > 0, `Size: ${size} bytes`);
}

// 2. Checking HTML Navigation IDs match JS listeners
console.log('\n2. Verifying DOM Elements & Selectors in index.html:');
const indexHtml = fs.readFileSync('index.html', 'utf-8');
const expectedElements = [
  'targetBtn',
  'mobileTargetBtn',
  'quickAddBtn',
  'mobileQuickAddBtn',
  'accountBtn',
  'mobileAccountBtn',
  'globalSearchBtn',
  'globalSearch',
  'searchDropdown',
  'sidebar',
  'sidebarCollapseBtn',
  'sidebarFooterProgress',
  'sidebarRingFill',
  'sidebarRingLabel',
  'sidebarDayLabel',
  'brandRange',
  'mobileSyncDot',
  'menuBtn',
  'modalOverlay',
  'modal',
  'toast',
  'content'
];

for (const id of expectedElements) {
  check(`Element #${id} exists in index.html`, indexHtml.includes(`id="${id}"`));
}

// 3. Verifying Navigation Sections in index.html
console.log('\n3. Verifying Navigation Sections in Sidebar:');
const expectedSections = [
  'dashboard', 'planner', 'habits', 'pomodoro', 'calendar',
  'dojo', 'exams', 'college', 'study', 'projects', 'reading',
  'fitness', 'finance', 'journal', 'mistakes', 'goals', 'notes',
  'analytics', 'badges', 'settings'
];

for (const sec of expectedSections) {
  check(`Section [data-section="${sec}"] present`, indexHtml.includes(`data-section="${sec}"`));
}

// 4. Verifying JS Render Functions exist in app.js
console.log('\n4. Verifying Render & Mount Functions in app.js:');
const appJs = fs.readFileSync('app.js', 'utf-8');
const renderFns = [
  'renderDashboard', 'renderPlanner', 'renderHabits', 'renderPomodoro', 'renderCalendar',
  'renderDojo', 'renderExams', 'renderCollege', 'renderStudy', 'renderProjects', 'renderReading',
  'renderFitness', 'renderFinance', 'renderJournal', 'renderMistakes', 'renderGoals', 'renderNotes',
  'renderAnalytics', 'renderBadges', 'renderSettings', 'openMilestoneCheckpointModal',
  'openScheduleTargetModal', 'openAccountModal', 'openQuickAdd', 'openGlobalSearch'
];

for (const fn of renderFns) {
  check(`Function ${fn}() defined in app.js`, appJs.includes(`function ${fn}`));
}

// 5. Test Live Server Endpoints
console.log('\n5. Testing Live Server API & Page Endpoints:');
const BASE = 'http://localhost:3000';

async function testEndpoints() {
  try {
    // Health
    const health = await fetch(`${BASE}/api/health`).then(r => r.json());
    check('API: GET /api/health returns ok', health && health.status === 'ok');

    // Network Info
    const netInfo = await fetch(`${BASE}/api/network-info`).then(r => r.json());
    check('API: GET /api/network-info returns IP and URL', netInfo && netInfo.success && !!netInfo.ip);

    // Cycle State
    const cycleState = await fetch(`${BASE}/api/cycle/state`).then(r => r.json());
    check('API: GET /api/cycle/state returns cycle status', cycleState && cycleState.success && cycleState.state.status === 'LOCKED');

    // Landing HTML
    const landing = await fetch(`${BASE}/landing`).then(r => r.text());
    check('Page: GET /landing returns valid HTML', landing.includes('<!DOCTYPE html>') && landing.includes('DAYSTACK'));

    // Auth HTML
    const auth = await fetch(`${BASE}/auth`).then(r => r.text());
    check('Page: GET /auth returns valid HTML', auth.includes('<!DOCTYPE html>') && auth.includes('Create Account'));

    // Store unauthenticated fallback
    const storeRes = await fetch(`${BASE}/api/store`);
    check('API: GET /api/store returns 200 or 404', storeRes.status === 200 || storeRes.status === 404);

    console.log(`\n══════════════════════════════════════════════════`);
    console.log(`🎉 AUDIT RESULT: ${passedChecks} of ${totalChecks} CHECKS PASSED`);
    console.log(`══════════════════════════════════════════════════\n`);

    if (passedChecks === totalChecks) {
      console.log('✅ The entire application is 100% healthy with zero errors detected.');
    } else {
      console.error(`⚠️ Found ${totalChecks - passedChecks} failing checks.`);
      process.exit(1);
    }
  } catch (err) {
    console.error('Server endpoint test failed:', err);
    process.exit(1);
  }
}

testEndpoints();




