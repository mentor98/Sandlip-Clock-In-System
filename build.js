const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🏗️ Building Oasis ClockIn Admin Dashboard...');
execSync('npm --prefix oasis-clockin/admin-dashboard run build', { stdio: 'inherit' });

console.log('📦 Assembling top-level distribution directory (/dist)...');
const distRoot = path.join(__dirname, 'dist');
const adminDist = path.join(__dirname, 'oasis-clockin/admin-dashboard/dist');
const studentPwa = path.join(__dirname, 'oasis-clockin/student-pwa');

// Ensure dist directory exists
if (fs.existsSync(distRoot)) {
  fs.rmSync(distRoot, { recursive: true, force: true });
}
fs.mkdirSync(distRoot, { recursive: true });

// Copy student PWA files to dist root
if (fs.existsSync(studentPwa)) {
  fs.cpSync(studentPwa, distRoot, { recursive: true });
  console.log('✅ Student PWA assets copied to /dist');
}

// Copy built admin dashboard to dist/admin
if (fs.existsSync(adminDist)) {
  const distAdmin = path.join(distRoot, 'admin');
  fs.mkdirSync(distAdmin, { recursive: true });
  fs.cpSync(adminDist, distAdmin, { recursive: true });
  console.log('✅ Admin dashboard assets copied to /dist/admin');
}

console.log('🎉 Full build completed successfully! Output directory: dist/');
