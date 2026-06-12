#include "repository/FieldRepository.h"
#include "repository/SqlUtil.h"

#include <QSqlError>
#include <QSqlQuery>
#include <QVariant>

namespace repository {

namespace {
// Choice options are stored as a single newline-separated string.
QString encodeOptions(const QStringList &options)
{
    return options.join(QLatin1Char('\n'));
}

QStringList decodeOptions(const QString &raw)
{
    if (raw.isEmpty())
        return {};
    return raw.split(QLatin1Char('\n'), Qt::SkipEmptyParts);
}
} // namespace

FieldRepository::FieldRepository(QSqlDatabase database)
    : m_db(std::move(database))
{
}

model::FieldDefinition FieldRepository::fromQuery(const QSqlQuery &query)
{
    model::FieldDefinition f;
    f.id = query.value(0).toInt();
    f.categoryId = query.value(1).toInt();
    f.name = query.value(2).toString();
    f.type = model::fieldTypeFromString(query.value(3).toString());
    f.required = query.value(4).toBool();
    f.position = query.value(5).toInt();
    f.options = decodeOptions(query.value(6).toString());
    return f;
}

QVector<model::FieldDefinition> FieldRepository::listForCategory(int categoryId) const
{
    QVector<model::FieldDefinition> result;
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT id, category_id, name, type, required, position, options "
        "FROM field_definition WHERE category_id = ? "
        "ORDER BY position, id"));
    query.addBindValue(categoryId);
    if (!query.exec())
        return result;
    while (query.next())
        result.append(fromQuery(query));
    return result;
}

std::optional<model::FieldDefinition> FieldRepository::get(int id) const
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT id, category_id, name, type, required, position, options "
        "FROM field_definition WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec() || !query.next())
        return std::nullopt;
    return fromQuery(query);
}

bool FieldRepository::insert(model::FieldDefinition &field)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "INSERT INTO field_definition (category_id, name, type, required, position, options) "
        "VALUES (?, ?, ?, ?, ?, ?)"));
    query.addBindValue(field.categoryId);
    query.addBindValue(text(field.name));
    query.addBindValue(model::fieldTypeToString(field.type));
    query.addBindValue(field.required ? 1 : 0);
    query.addBindValue(field.position);
    query.addBindValue(text(encodeOptions(field.options)));
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    field.id = query.lastInsertId().toInt();
    return true;
}

bool FieldRepository::update(const model::FieldDefinition &field)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "UPDATE field_definition SET name = ?, type = ?, required = ?, position = ?, options = ? "
        "WHERE id = ?"));
    query.addBindValue(text(field.name));
    query.addBindValue(model::fieldTypeToString(field.type));
    query.addBindValue(field.required ? 1 : 0);
    query.addBindValue(field.position);
    query.addBindValue(text(encodeOptions(field.options)));
    query.addBindValue(field.id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    return true;
}

bool FieldRepository::remove(int id)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("DELETE FROM field_definition WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    return true;
}

} // namespace repository
