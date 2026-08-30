/**
 * Comprehensive Automated Test Suite for Orvyn Platform Extension
 */

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('🧪 Starting Orvyn Automated Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Landing Page Test
    console.log('Test 1: Public Landing Page');
    const landingRes = await fetch(`${BASE_URL}/`);
    assert(landingRes.status === 200, 'GET / returns 200 OK');
    const landingText = await landingRes.text();
    assert(landingText.includes('Orvyn') && landingText.includes('Command Centre'), 'Landing page contains branding and hero');

    // 2. Auth Page Test
    console.log('\nTest 2: Public Auth Page');
    const authRes = await fetch(`${BASE_URL}/auth`);
    assert(authRes.status === 200, 'GET /auth returns 200 OK');
    const authText = await authRes.text();
    assert(authText.includes('Create Account') && authText.includes('Sign In'), 'Auth page contains registration & login forms');

    // 3. Unauthenticated Route Protection
    console.log('\nTest 3: Unauthenticated Route Protection');
    const appUnauth = await fetch(`${BASE_URL}/app`, { redirect: 'manual' });
    assert(appUnauth.status === 302, 'GET /app without session redirects 302 to /auth');

    const adminUnauth = await fetch(`${BASE_URL}/admin`, { redirect: 'manual' });
    assert(adminUnauth.status === 302, 'GET /admin without session redirects 302 to /auth');

    // 4. User Registration Flow
    console.log('\nTest 4: User Registration & Validation');
    const testEmail = `student_${Date.now()}@example.com`;
    const testPhone = `+91 9${Math.floor(100000000 + Math.random() * 900000000)}`;
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alex Student',
        email: testEmail,
        phone: testPhone,
        password: 'Password123!'
      })
    });
    const regData = await regRes.json();
    assert(regRes.status === 200 && regData.success, 'Registration creates unverified user');
    assert(!!regData.userId, 'Registration returns userId');
    const devOtp = regData.devOtp;
    assert(!!devOtp && devOtp.length === 6, `Generated 6-digit OTP (${devOtp})`);

    // 5. OTP Verification
    console.log('\nTest 5: OTP Verification & Session Issuance');
    // Test invalid OTP first
    const badOtpRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: regData.userId, otp: '000000' })
    });
    assert(badOtpRes.status === 400, 'Invalid OTP returns 400 Error');

    // Test correct OTP
    const goodOtpRes = await fetch(`${BASE_URL}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: regData.userId, otp: devOtp })
    });
    const goodOtpData = await goodOtpRes.json();
    const userCookie = goodOtpRes.headers.get('set-cookie');
    assert(goodOtpRes.status === 200 && goodOtpData.success, 'Valid OTP marks account as verified');
    assert(goodOtpData.user.verified === true, 'User verified status is true');
    assert(!!userCookie && userCookie.includes('lifeos_session='), 'HTTP-only session cookie issued');

    // 6. Accessing Protected App as Normal User
    console.log('\nTest 6: Authenticated User Access');
    const appAuthRes = await fetch(`${BASE_URL}/app`, {
      headers: { cookie: userCookie }
    });
    assert(appAuthRes.status === 200, 'Authenticated user can access GET /app (HTTP 200)');

    // 7. Normal User Cannot Access Admin
    console.log('\nTest 7: Role-Based Access Control (Admin Protection)');
    const adminForbiddenRes = await fetch(`${BASE_URL}/admin`, {
      headers: { cookie: userCookie }
    });
    assert(adminForbiddenRes.status === 403, 'Normal user blocked from GET /admin (HTTP 403 Forbidden)');

    const adminStatsForbidden = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { cookie: userCookie }
    });
    assert(adminStatsForbidden.status === 403, 'Normal user blocked from GET /api/admin/stats (HTTP 403 Forbidden)');

    // 8. Admin Login & Authorization
    console.log('\nTest 8: Administrator Authentication & Capabilities');
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'umakanthreddyannem2007@gmail.com',
        password: 'Orvyn@Admin2026'
      })
    });
    const adminLoginData = await adminLoginRes.json();
    const adminCookie = adminLoginRes.headers.get('set-cookie');
    assert(adminLoginRes.status === 200 && adminLoginData.user.role === 'admin', 'Admin login successful with admin role');

    const adminPageRes = await fetch(`${BASE_URL}/admin`, {
      headers: { cookie: adminCookie }
    });
    assert(adminPageRes.status === 200, 'Admin can access GET /admin (HTTP 200)');

    const adminStatsRes = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { cookie: adminCookie }
    });
    const adminStatsData = await adminStatsRes.json();
    assert(adminStatsRes.status === 200 && adminStatsData.success && adminStatsData.stats.total >= 1, 'Admin can fetch platform stats');

    const adminUsersRes = await fetch(`${BASE_URL}/api/admin/users`, {
      headers: { cookie: adminCookie }
    });
    const adminUsersData = await adminUsersRes.json();
    assert(adminUsersRes.status === 200 && Array.isArray(adminUsersData.users), 'Admin can list registered users');

    // 9. User-Scoped Data Store & Cross-Device Sync
    console.log('\nTest 9: User-Scoped Store Isolation & Cross-Device Sync');
    // User A saves custom habit
    const userAStorePayload = {
      habits: [{ id: 'h_test_1', name: 'Solve 3 LeetCode problems', streak: 5 }],
      settings: { name: 'Alex Student' }
    };
    const saveResA = await fetch(`${BASE_URL}/api/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: userCookie },
      body: JSON.stringify(userAStorePayload)
    });
    assert(saveResA.status === 200, 'User A saves data to /api/store');

    // User A on "Device 2" pulls data
    const pullResA = await fetch(`${BASE_URL}/api/store`, {
      headers: { cookie: userCookie }
    });
    const pullDataA = await pullResA.json();
    assert(pullResA.status === 200 && pullDataA.store.habits[0].name === 'Solve 3 LeetCode problems', 'User A on Device 2 retrieves identical synchronized data');

    // Admin pulls data - should NOT see User A's data (Isolated)
    const pullResAdmin = await fetch(`${BASE_URL}/api/store`, {
      headers: { cookie: adminCookie }
    });
    const pullDataAdmin = await pullResAdmin.json();
    const adminHabitNames = (pullDataAdmin.store?.habits || []).map(h => h.name);
    assert(!adminHabitNames.includes('Solve 3 LeetCode problems'), 'Data isolation: Admin does not leak or overwrite User A store');

    // 10. Logout
    console.log('\nTest 10: Session Logout');
    const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { cookie: userCookie }
    });
    const logoutCookie = logoutRes.headers.get('set-cookie');
    assert(logoutRes.status === 200 && logoutCookie.includes('Max-Age=0'), 'Logout clears session cookie');

    console.log(`\n══════════════════════════════════════════════════`);
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log(`══════════════════════════════════════════════════\n`);

    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Test execution failed:', err);
    process.exit(1);
  }
}

runTests();
