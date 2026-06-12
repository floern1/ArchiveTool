#pragma once

#include <QSqlDatabase>
#include <QString>

namespace db {

/**
 * Owns the database schema and its versioned migrations. Calling
 * Schema::migrate() on a fresh or existing database brings it up to the latest
 * version, creating tables as needed. This keeps upgrades safe for archives
 * that were created with an earlier release of the program.
 */
class Schema {
public:
    /// The schema version this build expects.
    static int currentVersion();

    /// Apply all pending migrations. Returns false and sets @p error on failure.
    static bool migrate(QSqlDatabase &database, QString *error);

private:
    static int readUserVersion(QSqlDatabase &database);
    static bool writeUserVersion(QSqlDatabase &database, int version, QString *error);
    static bool applyVersion1(QSqlDatabase &database, QString *error);
};

} // namespace db
