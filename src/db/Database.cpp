#include "db/Database.h"
#include "db/Schema.h"

#include <QDir>
#include <QSqlError>
#include <QSqlQuery>
#include <QStandardPaths>
#include <QUuid>

namespace db {

QString Database::defaultDataDirectory()
{
    // e.g. C:/Users/<name>/AppData/Roaming/ArchiveTool on Windows.
    const QString base =
        QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    QDir().mkpath(base);
    return base;
}

bool Database::open(const QString &dataDir, QString *error)
{
    close();

    m_dataDir = dataDir;
    QDir dir(m_dataDir);
    if (!dir.exists() && !QDir().mkpath(m_dataDir)) {
        if (error)
            *error = QObject::tr("Verzeichnis konnte nicht angelegt werden: %1").arg(m_dataDir);
        return false;
    }
    if (!QDir().mkpath(attachmentsDirectory())) {
        if (error)
            *error = QObject::tr("Anhang-Verzeichnis konnte nicht angelegt werden.");
        return false;
    }

    // Use a unique connection name so opening a different archive later does not
    // collide with an earlier one.
    m_connectionName = QStringLiteral("archive_%1")
                           .arg(QUuid::createUuid().toString(QUuid::Id128));

    QSqlDatabase database = QSqlDatabase::addDatabase(QStringLiteral("QSQLITE"), m_connectionName);
    database.setDatabaseName(databaseFilePath());

    if (!database.open()) {
        const QString message = database.lastError().text();
        QSqlDatabase::removeDatabase(m_connectionName);
        m_connectionName.clear();
        if (error)
            *error = QObject::tr("Datenbank konnte nicht geöffnet werden: %1").arg(message);
        return false;
    }

    // Enforce foreign keys (off by default in SQLite) and use a write-ahead log
    // for better concurrency/robustness. The query is scoped so its result set
    // is finalized before the migration's transaction commits (an open
    // statement would otherwise block COMMIT).
    {
        QSqlQuery pragma(database);
        pragma.exec(QStringLiteral("PRAGMA foreign_keys = ON"));
        pragma.exec(QStringLiteral("PRAGMA journal_mode = WAL"));
        pragma.finish();
    }

    if (!Schema::migrate(database, error)) {
        database.close();
        QSqlDatabase::removeDatabase(m_connectionName);
        m_connectionName.clear();
        return false;
    }

    return true;
}

void Database::close()
{
    if (m_connectionName.isEmpty())
        return;

    {
        QSqlDatabase database = QSqlDatabase::database(m_connectionName, false);
        if (database.isValid() && database.isOpen())
            database.close();
    }
    QSqlDatabase::removeDatabase(m_connectionName);
    m_connectionName.clear();
}

bool Database::isOpen() const
{
    if (m_connectionName.isEmpty())
        return false;
    QSqlDatabase database = QSqlDatabase::database(m_connectionName, false);
    return database.isValid() && database.isOpen();
}

QSqlDatabase Database::connection() const
{
    return QSqlDatabase::database(m_connectionName, false);
}

QString Database::attachmentsDirectory() const
{
    return QDir(m_dataDir).filePath(QStringLiteral("attachments"));
}

QString Database::databaseFilePath() const
{
    return QDir(m_dataDir).filePath(QStringLiteral("archive.sqlite"));
}

} // namespace db
