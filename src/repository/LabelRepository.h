#pragma once

#include "model/Models.h"

#include <QSqlDatabase>
#include <QVector>
#include <optional>

namespace repository {

/// Persists model::Label rows and the item <-> label associations.
class LabelRepository {
public:
    explicit LabelRepository(QSqlDatabase database);

    QVector<model::Label> list() const;
    std::optional<model::Label> get(int id) const;

    bool insert(model::Label &label);
    bool update(const model::Label &label);
    bool remove(int id);

    /// Labels currently attached to an item.
    QVector<model::Label> labelsForItem(int itemId) const;

    /// Replace the set of labels attached to @p itemId with @p labelIds.
    bool setLabelsForItem(int itemId, const QVector<int> &labelIds);

    int itemCount(int labelId) const;

    QString lastError() const { return m_lastError; }

private:
    QSqlDatabase m_db;
    QString m_lastError;
};

} // namespace repository
