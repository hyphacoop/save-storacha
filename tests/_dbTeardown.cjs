// Global Jest teardown: close DB connection and remove the test database file
const fs = require('fs/promises');

module.exports = async () => {
  const { closeDatabase, clearCleanupIntervals } = await import('../src/lib/db.js');
  const { clearCleanupIntervals: clearStoreIntervals } = await import('../src/lib/store.js');
  
  // Clear any running intervals
  clearStoreIntervals();
  
  await closeDatabase();

  const dbPath = process.env.DB_PATH;
  if (dbPath) {
    try {
      await fs.unlink(dbPath);
    } catch (_) {
      /* ignore */
    }
  }
}; 