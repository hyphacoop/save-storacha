// Global Jest setup: create a fresh SQLite DB and run migrations before tests
const fs = require('fs/promises');
const path = require('path');

module.exports = async () => {
  // Use a throw-away DB file inside project data directory
  const testDbPath = path.join(process.cwd(), 'data', 'delegations.test.db');
  process.env.DB_PATH = testDbPath;

  // Remove any existing test DB so we always start fresh
  try {
    await fs.unlink(testDbPath);
  } catch (_) {
    /* file may not exist – ignore */
  }

  // Dynamically import after env var is set so it picks the correct path
  const { setupDatabase } = await import('../src/lib/db.js');
  global.__DB__ = await setupDatabase(); // migrations run here
}; 