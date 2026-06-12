#pragma once

#include <QSqlDatabase>
#include <QString>

namespace db {

/**
 * Manages the single SQLite connection used throughout the application and the
 * on-disk layout of an archive:
 *
 *   <dataDir>/archive.sqlite      the database file
 *   <dataDir>/attachments/        imported files referenced by the database
 *
 * The data directory defaults to a writable per-user location so the installed
 * program never needs to write inside Program Files.
 */
class Database {
public:
    /// Default data directory (per-user, writable), creating it if necessary.
    static QString defaultDataDirectory();

    /// Open (and, if needed, create + migrate) the archive stored in @p dataDir.
    /// Returns false and fills @p error on failure.
    bool open(const QString &dataDir, QString *error);

    /// Close the connection. Safe to call when not open.
    void close();

    bool isOpen() const;

    QSqlDatabase connection() const;

    /// Absolute path to the directory that holds attachment files.
    QString attachmentsDirectory() const;

    /// Absolute path of the database file currently in use.
    QString databaseFilePath() const;

private:
    QString m_dataDir;
    QString m_connectionName;
};

} // namespace db
