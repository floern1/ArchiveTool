#include "repository/ItemRepository.h"
#include "repository/SqlUtil.h"

#include <QDateTime>
#include <QSqlError>
#include <QSqlQuery>
#include <QVariant>

namespace repository {

namespace {
const QString kIsoFormat = QStringLiteral("yyyy-MM-ddTHH:mm:ss");

model::Item itemFromQuery(const QSqlQuery &query)
{
    model::Item item;
    item.id = query.value(0).toInt();
    item.categoryId = query.value(1).toInt();
    item.title = query.value(2).toString();
    item.inventoryNo = query.value(3).toString();
    item.location = query.value(4).toString();
    item.notes = query.value(5).toString();
    item.createdAt = QDateTime::fromString(query.value(6).toString(), kIsoFormat);
    item.updatedAt = QDateTime::fromString(query.value(7).toString(), kIsoFormat);
    return item;
}
} // namespace

ItemRepository::ItemRepository(QSqlDatabase database)
    : m_db(std::move(database))
{
}

QVector<model::Item> ItemRepository::listForCategory(int categoryId,
                                                     const QString &search,
                                                     int labelId) const
{
    QVector<model::Item> result;

    QString sql = QStringLiteral(
        "SELECT i.id, i.category_id, i.title, i.inventory_no, i.location, "
        "       i.notes, i.created_at, i.updated_at "
        "FROM item i WHERE i.category_id = ?");

    if (labelId > 0) {
        sql += QStringLiteral(
            " AND EXISTS (SELECT 1 FROM item_label il "
            "WHERE il.item_id = i.id AND il.label_id = ?)");
    }
    if (!search.trimmed().isEmpty()) {
        sql += QStringLiteral(
            " AND (i.title LIKE ? OR i.inventory_no LIKE ? OR i.location LIKE ? "
            "OR i.notes LIKE ? OR EXISTS (SELECT 1 FROM item_field_value v "
            "WHERE v.item_id = i.id AND v.value LIKE ?))");
    }
    sql += QStringLiteral(" ORDER BY i.title COLLATE NOCASE, i.id");

    QSqlQuery query(m_db);
    query.prepare(sql);
    query.addBindValue(categoryId);
    if (labelId > 0)
        query.addBindValue(labelId);
    if (!search.trimmed().isEmpty()) {
        const QString pattern = QStringLiteral("%%%1%%").arg(search.trimmed());
        for (int i = 0; i < 5; ++i)
            query.addBindValue(pattern);
    }

    if (!query.exec()) {
        return result;
    }
    while (query.next())
        result.append(itemFromQuery(query));

    loadFieldValues(result);
    return result;
}

std::optional<model::Item> ItemRepository::get(int id) const
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT id, category_id, title, inventory_no, location, notes, "
        "       created_at, updated_at FROM item WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec() || !query.next())
        return std::nullopt;

    model::Item item = itemFromQuery(query);

    QSqlQuery values(m_db);
    values.prepare(QStringLiteral(
        "SELECT field_definition_id, value FROM item_field_value WHERE item_id = ?"));
    values.addBindValue(id);
    if (values.exec()) {
        while (values.next())
            item.fieldValues.insert(values.value(0).toInt(), values.value(1).toString());
    }
    return item;
}

void ItemRepository::loadFieldValues(QVector<model::Item> &items) const
{
    if (items.isEmpty())
        return;

    // Map id -> index for quick assignment.
    QHash<int, int> indexById;
    indexById.reserve(items.size());
    for (int i = 0; i < items.size(); ++i)
        indexById.insert(items[i].id, i);

    QStringList placeholders;
    for (int i = 0; i < items.size(); ++i)
        placeholders << QStringLiteral("?");

    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT item_id, field_definition_id, value FROM item_field_value "
        "WHERE item_id IN (%1)").arg(placeholders.join(QLatin1Char(','))));
    for (const model::Item &item : items)
        query.addBindValue(item.id);

    if (!query.exec())
        return;
    while (query.next()) {
        const int itemId = query.value(0).toInt();
        auto it = indexById.constFind(itemId);
        if (it != indexById.constEnd())
            items[it.value()].fieldValues.insert(query.value(1).toInt(),
                                                 query.value(2).toString());
    }
}

bool ItemRepository::writeFieldValues(int itemId, const QHash<int, QString> &values)
{
    QSqlQuery del(m_db);
    del.prepare(QStringLiteral("DELETE FROM item_field_value WHERE item_id = ?"));
    del.addBindValue(itemId);
    if (!del.exec()) {
        m_lastError = del.lastError().text();
        return false;
    }

    QSqlQuery ins(m_db);
    ins.prepare(QStringLiteral(
        "INSERT INTO item_field_value (item_id, field_definition_id, value) "
        "VALUES (?, ?, ?)"));
    for (auto it = values.constBegin(); it != values.constEnd(); ++it) {
        if (it.value().isEmpty())
            continue; // do not store empty values
        ins.addBindValue(itemId);
        ins.addBindValue(it.key());
        ins.addBindValue(text(it.value()));
        if (!ins.exec()) {
            m_lastError = ins.lastError().text();
            return false;
        }
    }
    return true;
}

bool ItemRepository::insert(model::Item &item)
{
    if (!m_db.transaction()) {
        m_lastError = m_db.lastError().text();
        return false;
    }

    const QString now = QDateTime::currentDateTime().toString(kIsoFormat);
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "INSERT INTO item (category_id, title, inventory_no, location, notes, "
        "created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"));
    query.addBindValue(item.categoryId);
    query.addBindValue(text(item.title));
    query.addBindValue(text(item.inventoryNo));
    query.addBindValue(text(item.location));
    query.addBindValue(text(item.notes));
    query.addBindValue(now);
    query.addBindValue(now);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        m_db.rollback();
        return false;
    }
    item.id = query.lastInsertId().toInt();
    item.createdAt = QDateTime::fromString(now, kIsoFormat);
    item.updatedAt = item.createdAt;

    if (!writeFieldValues(item.id, item.fieldValues)) {
        m_db.rollback();
        return false;
    }

    if (!m_db.commit()) {
        m_lastError = m_db.lastError().text();
        m_db.rollback();
        return false;
    }
    return true;
}

bool ItemRepository::update(const model::Item &item)
{
    if (!m_db.transaction()) {
        m_lastError = m_db.lastError().text();
        return false;
    }

    const QString now = QDateTime::currentDateTime().toString(kIsoFormat);
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "UPDATE item SET title = ?, inventory_no = ?, location = ?, notes = ?, "
        "updated_at = ? WHERE id = ?"));
    query.addBindValue(text(item.title));
    query.addBindValue(text(item.inventoryNo));
    query.addBindValue(text(item.location));
    query.addBindValue(text(item.notes));
    query.addBindValue(now);
    query.addBindValue(item.id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        m_db.rollback();
        return false;
    }

    if (!writeFieldValues(item.id, item.fieldValues)) {
        m_db.rollback();
        return false;
    }

    if (!m_db.commit()) {
        m_lastError = m_db.lastError().text();
        m_db.rollback();
        return false;
    }
    return true;
}

bool ItemRepository::remove(int id)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("DELETE FROM item WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    return true;
}

} // namespace repository
