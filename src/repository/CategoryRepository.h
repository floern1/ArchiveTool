#pragma once

#include "model/Models.h"

#include <QSqlDatabase>
#include <QVector>
#include <optional>

namespace repository {

/// Persists model::Category rows.
class CategoryRepository {
public:
    explicit CategoryRepository(QSqlDatabase database);

    QVector<model::Category> list() const;
    std::optional<model::Category> get(int id) const;

    /// Inserts @p category and writes the new id back into it. Returns false on error.
    bool insert(model::Category &category);
    bool update(const model::Category &category);

    /// Removes the category and (via ON DELETE CASCADE) all of its fields and items.
    bool remove(int id);

    /// Number of items currently stored in the category.
    int itemCount(int id) const;

    QString lastError() const { return m_lastError; }

private:
    QSqlDatabase m_db;
    QString m_lastError;
};

} // namespace repository
