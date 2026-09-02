const app = require('./app');

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`⏱ Oasis ClockIn running at http://0.0.0.0:${PORT}`);
  console.log(`📱 Student PWA: http://localhost:${PORT}/`);
  console.log(`⚙️ Admin Dashboard: http://localhost:${PORT}/admin`);
});
