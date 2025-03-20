const fs = require("fs");
const path = require("path");
const database = require("./database");

async function runMigrations() {
  console.log("Running Navigator database migrations");
  // Check for all `.sql` files in the `migrations` folder at the current working directory
  let files = [];
  try {
    files = fs.readdirSync(path.join(__dirname, "..", "migrations"));
  } catch (err) {
    warnMissingMigrationsAndExit();
  }
  let migrationFileNames = [];
  let migrationObjects = [];
  files.forEach((file) => {
    if (file.endsWith(".sql")) {
      migrationFileNames.push(file);
    }
  });

  console.log("Available migrations: ", migrationFileNames);

  if (migrationFileNames.length === 0) {
    warnMissingMigrationsAndExit();
  }

  // Assume that the first migration index we will want to run is "0" (None)
  let highestMigrationRan = 0;

  // Get all current migrations that have been run, if the `migrations` table exists
  try {
    const currentMigrations = await database.asyncQuery(
      "SELECT * FROM migrations",
    );
    // console.log(currentMigrations);
    for (const migration of currentMigrations) {
      // noinspection JSUnresolvedReference
      if (migration.migration_id > highestMigrationRan) {
        // noinspection JSUnresolvedReference
        highestMigrationRan = migration.migration_id;
      }
    }
    console.log(
      "Found existing migrations in database, we're on version: " +
        highestMigrationRan,
    );
  } catch (err) {
    // The `migrations` table might not exist yet, if we haven't actually had a chance to run any migrations
    //  so the error doesn't necessarily have to be fatal.
    if (err.errno === 1146) {
      // Expected error (ER_NO_SUCH_TABLE), not fatal in this case
      console.log("Migrations table does not exist (yet).");
    } else {
      // Probably a fatal error
      console.error(err);
      console.error("Failed to process migrations, terminating!");
      process.exit(2);
    }
  }

  console.debug("Finding next migration to apply");
  // We build a list of migration "objects", which just is some parsing of the file name to make it a bit more
  //  convenient to use later on.
  for (const migration of migrationFileNames) {
    let migrationIdx = migration.split("_")[0].replace("v", "");
    let versionIdentifier = `v${migrationIdx}_`;
    migrationObjects.push({
      index: parseInt(migrationIdx),
      name: migration.replace(versionIdentifier, "").replace(".sql", ""),
      filename: migration,
    });
  }

  // Of all our migration objects, find the "highest" index
  let highestIndex = -1; // Initialize with a value that is lower than any valid index
  for (const migration of migrationObjects) {
    if (migration.index > highestIndex) {
      highestIndex = migration.index;
    }
  }

  console.log(`Highest target migration index found: ${highestIndex}`);
  if (highestIndex === highestMigrationRan) {
    console.log("No migrations needed");
    return true;
  }

  if (highestIndex < highestMigrationRan) {
    if (
      process.env.NAVIGATOR_IGNORE_MIGRATION_MISMATCH === "true" ||
      process.env.NAVIGATOR_IGNORE_MIGRATION_MISMATCH === "1"
    ) {
      console.warn(
        "****** WARNING: Migration mismatch bypassed (NAVIGATOR_IGNORE_MIGRATION_MISMATCH set) *******",
      );
      console.warn("Whoa there partner!");
      console.warn(
        "Your database has a migration that Navigator does not know about. You must be a time-traveler!",
      );
      console.warn(
        "Greetings time-traveler, please proceed with caution - what you are attempting to do may attempt in data corruption and unexpected behavior!",
      );
      console.warn(
        "For instructions on how to fix this, unset the `NAVIGATOR_IGNORE_MIGRATION_MISMATCH` environmental variable.",
      );
      console.warn(
        "By proceeding without resolving this issue, you could end up shattering the timeline!",
      );
      console.warn("Don't say we didn't warn you.");
      console.warn(
        "*********************************************************************************************",
      );
    } else {
      console.error(
        "****** ERROR: Database migration inconsistency detected! *******",
      );
      console.error(`Found:    ${highestIndex} < ${highestMigrationRan}`);
      console.error(`Expected: ${highestIndex} >= ${highestMigrationRan}`);
      console.error(
        "Your database has a migration that we do not know about. What?",
      );
      console.error(
        `The database has a migration version (${highestMigrationRan}) that is higher than Navigator's expected version (${highestIndex}).`,
      );
      console.error(
        "This indicates a potential downgrade or missing migration files.",
      );
      console.error(
        "This can lead to data corruption or unpredictable behavior. Navigator will now exit.",
      );
      console.error(" ");
      console.error("To resolve this issue:");
      console.error(
        "1. Upgrade Navigator to the latest version, or at least the latest version you were previously using.",
      );
      console.error(
        "2. If you intentionally downgraded, restore a database backup to fix the mismatch.",
      );
      console.error(
        "3. Are you a time-traveler? If so, you should return to your original time!",
      );
      console.error(
        "******************************************************************",
      );
      process.exit(2);
    }
  }

  while (highestMigrationRan < highestIndex) {
    const nextIdx = highestMigrationRan + 1;
    const migration = getMigrationFromIndex(migrationObjects, nextIdx);
    const migrationPath = path.join(
      __dirname,
      "..",
      "migrations",
      migration.filename,
    );
    console.log("Running migration: ", migrationPath);
    const migrationStr = fs.readFileSync(migrationPath).toString();
    try {
      await database.asyncQuery(migrationStr);
      await database.asyncQuery(
        "INSERT INTO migrations (migration_id) VALUES (?)",
        migration.index,
      );
      highestMigrationRan++;
    } catch (err) {
      console.error(err);
      console.error(
        `An issue occurred while trying to run this migration (${migration.name}) - cannot continue!`,
      );
      console.error("Failed to process migrations, terminating!");
      process.exit(2);
    }
  }

  return true;
}

function getMigrationFromIndex(migrations, idx) {
  return migrations.filter((migration) => migration.index === idx)[0];
}

function warnMissingMigrationsAndExit() {
  console.error("****** FATAL ERROR: Missing migration files! ******");
  console.error(
    "Navigator cannot find its migration files! Something is definitely not right.",
  );
  console.error("There are a couple of reasons this could happen:");
  console.error(
    "- You have upgraded Navigator to a version that introduced migrations, but did not obtain the `migrations` folder.",
  );
  console.error(
    "- You *do* have a `migrations` folder, but it is empty (this should never be the case).",
  );
  console.error(
    "- Navigator for some reason cannot access the `migrations` folder.",
  );
  console.error(
    "- Or cosmic rays have hit your storage medium, and effectively mangled or deleted the `migrations` folder.",
  );
  console.error(" ");
  console.error(
    "Nonetheless, Navigator's installation is currently in an unexpected state and cannot continue - Navigator will now exit.",
  );
  console.error(
    "Please make sure the `migrations` folder exists, and try again.",
  );
  console.error("***************************************************");
  process.exit(2);
}

module.exports = { runMigrations };
