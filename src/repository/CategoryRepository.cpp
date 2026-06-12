#include "repository/CategoryRepository.h"
#include "repository/SqlUtil.h"

#include <QSqlError>
#include <QSqlQuery>
#include <QVariant>

namespace repository {

CategoryRepository::CategoryRepository(QSqlDatabase database)
    : m_db(std::move(database))
{
}

QVector<model::Category> CategoryRepository::list() const
{
    QVector<model::Category> result;
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT id, name, description, position FROM category "
        "ORDER BY position, name COLLATE NOCASE"));
    if (!query.exec())
        return result;

    while (query.next()) {
        model::Category c;
        c.id = query.value(0).toInt();
        c.name = query.value(1).toString();
        c.description = query.value(2).toString();
        c.position = query.value(3).toInt();
        result.append(c);
    }
    return result;
}

std::optional<model::Category> CategoryRepository::get(int id) const
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT id, name, description, position FROM category WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec() || !query.next())
        return std::nullopt;

    model::Category c;
    c.id = query.value(0).toInt();
    c.name = query.value(1).toString();
    c.description = query.value(2).toString();
    c.position = query.value(3).toInt();
    return c;
}

bool CategoryRepository::insert(model::Category &category)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "INSERT INTO category (name, description, position) VALUES (?, ?, ?)"));
    query.addBindValue(text(category.name));
    query.addBindValue(text(category.description));
    query.addBindValue(category.position);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    category.id = query.lastInsertId().toInt();
    return true;
}

bool CategoryRepository::update(const model::Category &category)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "UPDATE category SET name = ?, description = ?, position = ? WHERE id = ?"));
    query.addBindValue(text(category.name));
    query.addBindValue(text(category.description));
    query.addBindValue(category.position);
    query.addBindValue(category.id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    return true;
}

bool CategoryRepository::remove(int id)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("DELETE FROM category WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    return true;
}

int CategoryRepository::itemCount(int id) const
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("SELECT COUNT(*) FROM item WHERE category_id = ?"));
    query.addBindValue(id);
    if (!query.exec() || !query.next())
        return 0;
    return query.value(0).toInt();
}

} // namespace repository
