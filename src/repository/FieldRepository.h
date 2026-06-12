#pragma once

#include "model/Models.h"

#include <QSqlDatabase>
#include <QVector>
#include <optional>

namespace repository {

/// Persists model::FieldDefinition rows (the per-category custom fields).
class FieldRepository {
public:
    explicit FieldRepository(QSqlDatabase database);

    QVector<model::FieldDefinition> listForCategory(int categoryId) const;
    std::optional<model::FieldDefinition> get(int id) const;

    bool insert(model::FieldDefinition &field);
    bool update(const model::FieldDefinition &field);
    bool remove(int id);

    QString lastError() const { return m_lastError; }

private:
    static model::FieldDefinition fromQuery(const class QSqlQuery &query);

    QSqlDatabase m_db;
    QString m_lastError;
};

} // namespace repository
