#pragma once

#include "model/Models.h"

#include <QAbstractTableModel>
#include <QHash>
#include <QVector>

namespace ui {

/**
 * Table model that presents the items of a single category. The first columns
 * are the built-in attributes, followed by one column per custom field of the
 * category and a final column listing the item's labels.
 */
class ItemTableModel : public QAbstractTableModel {
    Q_OBJECT
public:
    explicit ItemTableModel(QObject *parent = nullptr);

    /// Replace the displayed data. @p labelText maps item id -> joined labels.
    void setData(const QVector<model::Item> &items,
                 const QVector<model::FieldDefinition> &fields,
                 const QHash<int, QString> &labelText);

    /// The item shown in @p row, or a default-constructed item if out of range.
    model::Item itemAt(int row) const;

    int rowCount(const QModelIndex &parent = QModelIndex()) const override;
    int columnCount(const QModelIndex &parent = QModelIndex()) const override;
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    QVariant headerData(int section, Qt::Orientation orientation,
                        int role = Qt::DisplayRole) const override;

private:
    QString displayValue(const model::Item &item, const model::FieldDefinition &field) const;

    QVector<model::Item> m_items;
    QVector<model::FieldDefinition> m_fields;
    QHash<int, QString> m_labelText;

    // Number of fixed, built-in columns shown before the custom fields.
    static constexpr int kBuiltinColumns = 3;
};

} // namespace ui
