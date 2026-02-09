#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

console.log('[DB] Starting PostgreSQL database initialization...');

/**
 * Check if Prisma CLI is available (Windows-safe)
 */
async function checkPrismaAvailability() {
  try {
    await execAsync('npx prisma --version', { shell: true });
    console.log('[DB] Prisma CLI found');
    return true;
  } catch (error) {
    console.error('[DB] ERROR: Prisma CLI not found.');
    console.error('[DB] Run: npm install --save-dev prisma');
    return false;
  }
}

/**
 * Initialize PostgreSQL database
 */
async function initializeDatabase() {
  try {
    const prismaAvailable = await checkPrismaAvailability();
    if (!prismaAvailable) {
      throw new Error('Prisma CLI is not available. Cannot initialize database.');
    }

    const databaseUrl =
      process.env.DATABASE_URL ||
      'postgresql://postgres:Km979057@localhost:5432/harborguard?sslmode=disable';

    console.log('[DB] Using PostgreSQL database');
    console.log(
      '[DB] Database URL:',
      databaseUrl.replace(/:[^:@]+@/, ':****@')
    );

    console.log('[DB] Generating Prisma client...');
    await execAsync('npx prisma generate', {
      shell: true,
      env: { ...process.env, DATABASE_URL: databaseUrl }
    });

    console.log('[DB] Running database migrations...');
    try {
      await execAsync('npx prisma migrate deploy', {
        shell: true,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 30000
      });
      console.log('[DB] Migrations applied successfully');
    } catch (err) {
      console.warn('[DB] Migration failed, trying db push...');
      await execAsync('npx prisma db push --accept-data-loss', {
        shell: true,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        timeout: 30000
      });
      console.log('[DB] Database schema synchronized');
    }

    console.log('[DB] PostgreSQL database initialized successfully');
    return { success: true };
  } catch (error) {
    console.error('[DB] Database initialization failed:', error.message);
    return { success: false };
  }
}

// Run directly
if (require.main === module) {
  initializeDatabase().then((result) => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { initializeDatabase };
