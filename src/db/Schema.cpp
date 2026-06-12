#include "db/Schema.h"

#include <QSqlError>
#include <QSqlQuery>
#include <QStringList>
#include <QVariant>

namespace db {

int Schema::currentVersion()
{
    return 1;
}

int Schema::readUserVersion(QSqlDatabase &database)
{
    QSqlQuery query(database);
    if (!query.exec(QStringLiteral("PRAGMA user_version")))
        return 0;
    if (query.next())
        return query.value(0).toInt();
    return 0;
}

bool Schema::writeUserVersion(QSqlDatabase &database, int version, QString *error)
{
    QSqlQuery query(database);
    // PRAGMA does not accept bound parameters, so the (validated, integer)
    // version is inlined.
    if (!query.exec(QStringLiteral("PRAGMA user_version = %1").arg(version))) {
        if (error)
            *error = query.lastError().text();
        return false;
    }
    return true;
}

static bool execOrFail(QSqlQuery &query, const QString &sql, QString *error)
{
    if (!query.exec(sql)) {
        if (error)
            *error = query.lastError().text() + QStringLiteral("\nSQL: ") + sql;
        return false;
    }
    return true;
}

bool Schema::applyVersion1(QSqlDatabase &database, QString *error)
{
    QSqlQuery query(database);

    const QStringList statements = {
        // Categories ---------------------------------------------------------
        QStringLiteral(
            "CREATE TABLE category ("
            "  id          INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  name        TEXT    NOT NULL,"
            "  description TEXT    NOT NULL DEFAULT '',"
            "  position    INTEGER NOT NULL DEFAULT 0"
            ")"),

        // Per-category field definitions ------------------------------------
        QStringLiteral(
            "CREATE TABLE field_definition ("
            "  id          INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  category_id INTEGER NOT NULL,"
            "  name        TEXT    NOT NULL,"
            "  type        TEXT    NOT NULL DEFAULT 'text',"
            "  required    INTEGER NOT NULL DEFAULT 0,"
            "  position    INTEGER NOT NULL DEFAULT 0,"
            "  options     TEXT    NOT NULL DEFAULT '',"
            "  FOREIGN KEY (category_id) REFERENCES category(id) ON DELETE CASCADE"
            ")"),
        QStringLiteral(
            "CREATE INDEX idx_field_definition_category "
            "ON field_definition(category_id)"),

        // Archive items ------------------------------------------------------
        QStringLiteral(
            "CREATE TABLE item ("
            "  id           INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  category_id  INTEGER NOT NULL,"
            "  title        TEXT    NOT NULL DEFAULT '',"
            "  inventory_no TEXT    NOT NULL DEFAULT '',"
            "  location     TEXT    NOT NULL DEFAULT '',"
            "  notes        TEXT    NOT NULL DEFAULT '',"
            "  created_at   TEXT    NOT NULL DEFAULT '',"
            "  updated_at   TEXT    NOT NULL DEFAULT '',"
            "  FOREIGN KEY (category_id) REFERENCES category(id) ON DELETE CASCADE"
            ")"),
        QStringLiteral("CREATE INDEX idx_item_category ON item(category_id)"),

        // Flexible field values (entity-attribute-value) --------------------
        QStringLiteral(
            "CREATE TABLE item_field_value ("
            "  item_id             INTEGER NOT NULL,"
            "  field_definition_id INTEGER NOT NULL,"
            "  value               TEXT    NOT NULL DEFAULT '',"
            "  PRIMARY KEY (item_id, field_definition_id),"
            "  FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE CASCADE,"
            "  FOREIGN KEY (field_definition_id) REFERENCES field_definition(id) ON DELETE CASCADE"
            ")"),

        // Labels -------------------------------------------------------------
        QStringLiteral(
            "CREATE TABLE label ("
            "  id    INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  name  TEXT    NOT NULL,"
            "  color TEXT    NOT NULL DEFAULT '#4a90d9'"
            ")"),
        QStringLiteral(
            "CREATE TABLE item_label ("
            "  item_id  INTEGER NOT NULL,"
            "  label_id INTEGER NOT NULL,"
            "  PRIMARY KEY (item_id, label_id),"
            "  FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE CASCADE,"
            "  FOREIGN KEY (label_id) REFERENCES label(id) ON DELETE CASCADE"
            ")"),

        // Attachments --------------------------------------------------------
        QStringLiteral(
            "CREATE TABLE attachment ("
            "  id            INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  item_id       INTEGER NOT NULL,"
            "  original_name TEXT    NOT NULL,"
            "  stored_path   TEXT    NOT NULL,"
            "  size          INTEGER NOT NULL DEFAULT 0,"
            "  added_at      TEXT    NOT NULL DEFAULT '',"
            "  FOREIGN KEY (item_id) REFERENCES item(id) ON DELETE CASCADE"
            ")"),
        QStringLiteral("CREATE INDEX idx_attachment_item ON attachment(item_id)"),
    };

    for (const QString &sql : statements) {
        if (!execOrFail(query, sql, error))
            return false;
    }
    return true;
}

bool Schema::migrate(QSqlDatabase &database, QString *error)
{
    int version = readUserVersion(database);
    if (version >= currentVersion())
        return true;

    // Each migration runs in its own transaction so a failure leaves the
    // database untouched rather than half-upgraded.
    if (version < 1) {
        if (!database.transaction()) {
            if (error)
                *error = database.lastError().text();
            return false;
        }
        if (!applyVersion1(database, error) || !writeUserVersion(database, 1, error)) {
            database.rollback();
            return false;
        }
        if (!database.commit()) {
            if (error)
                *error = database.lastError().text();
            database.rollback();
            return false;
        }
        version = 1;
    }

    // Future migrations (version < 2, < 3, ...) are appended here.

    return true;
}

} // namespace db
