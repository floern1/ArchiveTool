#include "ui/ItemTableModel.h"

#include <QDate>

namespace ui {

ItemTableModel::ItemTableModel(QObject *parent)
    : QAbstractTableModel(parent)
{
}

void ItemTableModel::setData(const QVector<model::Item> &items,
                             const QVector<model::FieldDefinition> &fields,
                             const QHash<int, QString> &labelText)
{
    beginResetModel();
    m_items = items;
    m_fields = fields;
    m_labelText = labelText;
    endResetModel();
}

model::Item ItemTableModel::itemAt(int row) const
{
    if (row < 0 || row >= m_items.size())
        return {};
    return m_items[row];
}

int ItemTableModel::rowCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;
    return m_items.size();
}

int ItemTableModel::columnCount(const QModelIndex &parent) const
{
    if (parent.isValid())
        return 0;
    // built-in columns + custom fields + label column
    return kBuiltinColumns + m_fields.size() + 1;
}

QString ItemTableModel::displayValue(const model::Item &item,
                                     const model::FieldDefinition &field) const
{
    const QString raw = item.fieldValues.value(field.id);
    if (raw.isEmpty())
        return QString();
    switch (field.type) {
    case model::FieldType::Boolean:
        return raw == QLatin1String("1") ? QObject::tr("Ja") : QString();
    case model::FieldType::Date: {
        const QDate date = QDate::fromString(raw, QStringLiteral("yyyy-MM-dd"));
        return date.isValid() ? date.toString(QStringLiteral("dd.MM.yyyy")) : raw;
    }
    default:
        return raw;
    }
}

QVariant ItemTableModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() >= m_items.size())
        return {};
    if (role != Qt::DisplayRole && role != Qt::ToolTipRole)
        return {};

    const model::Item &item = m_items[index.row()];
    const int col = index.column();

    if (col == 0)
        return item.title;
    if (col == 1)
        return item.inventoryNo;
    if (col == 2)
        return item.location;

    const int fieldIndex = col - kBuiltinColumns;
    if (fieldIndex >= 0 && fieldIndex < m_fields.size())
        return displayValue(item, m_fields[fieldIndex]);

    // Last column: labels.
    return m_labelText.value(item.id);
}

QVariant ItemTableModel::headerData(int section, Qt::Orientation orientation, int role) const
{
    if (role != Qt::DisplayRole)
        return {};
    if (orientation == Qt::Vertical)
        return section + 1;

    if (section == 0)
        return tr("Titel / Bezeichnung");
    if (section == 1)
        return tr("Inventar-/Signaturnr.");
    if (section == 2)
        return tr("Standort");

    const int fieldIndex = section - kBuiltinColumns;
    if (fieldIndex >= 0 && fieldIndex < m_fields.size())
        return m_fields[fieldIndex].name;

    return tr("Labels");
}

} // namespace ui
