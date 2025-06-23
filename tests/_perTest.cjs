// Per-test DB transaction management for Jest
let dbModule;

beforeAll(async () => {
  dbModule = await import('../src/lib/db.js');
  await dbModule.setupDatabase();
});

beforeEach(() => {
  const db = dbModule.getDatabase();
  db.exec('BEGIN TRANSACTION;');
});

afterEach(() => {
  try {
    const db = dbModule.getDatabase();
    db.exec('ROLLBACK;');
  } catch (_) {}
}); 