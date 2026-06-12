#pragma once

#include "model/Models.h"

#include <QSqlDatabase>
#include <QVector>
#include <optional>

namespace repository {

/**
 * Persists archive items together with their flexible per-category field
 * values. Insert/update run inside a transaction so an item and its field
 * values are always written atomically.
 */
class ItemRepository {
public:
    explicit ItemRepository(QSqlDatabase database);

    /// List items of a category, optionally filtered by a free-text search and
    /// by a label. @p search matches the built-in columns and any custom field
    /// value. Pass labelId <= 0 to disable the label filter. The returned items
    /// include their custom field values.
    QVector<model::Item> listForCategory(int categoryId,
                                         const QString &search = QString(),
                                         int labelId = -1) const;

    /// Full item including custom field values.
    std::optional<model::Item> get(int id) const;

    bool insert(model::Item &item);
    bool update(const model::Item &item);
    bool remove(int id);

    QString lastError() const { return m_lastError; }

private:
    bool writeFieldValues(int itemId, const QHash<int, QString> &values);
    void loadFieldValues(QVector<model::Item> &items) const;

    QSqlDatabase m_db;
    QString m_lastError;
};

} // namespace repository
