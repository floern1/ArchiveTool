#include "repository/LabelRepository.h"
#include "repository/SqlUtil.h"

#include <QSqlError>
#include <QSqlQuery>
#include <QVariant>

namespace repository {

LabelRepository::LabelRepository(QSqlDatabase database)
    : m_db(std::move(database))
{
}

QVector<model::Label> LabelRepository::list() const
{
    QVector<model::Label> result;
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT id, name, color FROM label ORDER BY name COLLATE NOCASE"));
    if (!query.exec())
        return result;
    while (query.next()) {
        model::Label l;
        l.id = query.value(0).toInt();
        l.name = query.value(1).toString();
        l.color = query.value(2).toString();
        result.append(l);
    }
    return result;
}

std::optional<model::Label> LabelRepository::get(int id) const
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("SELECT id, name, color FROM label WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec() || !query.next())
        return std::nullopt;
    model::Label l;
    l.id = query.value(0).toInt();
    l.name = query.value(1).toString();
    l.color = query.value(2).toString();
    return l;
}

bool LabelRepository::insert(model::Label &label)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("INSERT INTO label (name, color) VALUES (?, ?)"));
    query.addBindValue(text(label.name));
    query.addBindValue(text(label.color));
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    label.id = query.lastInsertId().toInt();
    return true;
}

bool LabelRepository::update(const model::Label &label)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("UPDATE label SET name = ?, color = ? WHERE id = ?"));
    query.addBindValue(text(label.name));
    query.addBindValue(text(label.color));
    query.addBindValue(label.id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    return true;
}

bool LabelRepository::remove(int id)
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("DELETE FROM label WHERE id = ?"));
    query.addBindValue(id);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        return false;
    }
    return true;
}

QVector<model::Label> LabelRepository::labelsForItem(int itemId) const
{
    QVector<model::Label> result;
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT l.id, l.name, l.color FROM label l "
        "JOIN item_label il ON il.label_id = l.id "
        "WHERE il.item_id = ? "
        "ORDER BY l.name COLLATE NOCASE"));
    query.addBindValue(itemId);
    if (!query.exec())
        return result;
    while (query.next()) {
        model::Label l;
        l.id = query.value(0).toInt();
        l.name = query.value(1).toString();
        l.color = query.value(2).toString();
        result.append(l);
    }
    return result;
}

bool LabelRepository::setLabelsForItem(int itemId, const QVector<int> &labelIds)
{
    QSqlQuery del(m_db);
    del.prepare(QStringLiteral("DELETE FROM item_label WHERE item_id = ?"));
    del.addBindValue(itemId);
    if (!del.exec()) {
        m_lastError = del.lastError().text();
        return false;
    }

    QSqlQuery ins(m_db);
    ins.prepare(QStringLiteral(
        "INSERT INTO item_label (item_id, label_id) VALUES (?, ?)"));
    for (int labelId : labelIds) {
        ins.addBindValue(itemId);
        ins.addBindValue(labelId);
        if (!ins.exec()) {
            m_lastError = ins.lastError().text();
            return false;
        }
    }
    return true;
}

int LabelRepository::itemCount(int labelId) const
{
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral("SELECT COUNT(*) FROM item_label WHERE label_id = ?"));
    query.addBindValue(labelId);
    if (!query.exec() || !query.next())
        return 0;
    return query.value(0).toInt();
}

} // namespace repository
