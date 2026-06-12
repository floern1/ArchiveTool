#pragma once

#include <QDateTime>
#include <QString>
#include <QStringList>
#include <QVariant>
#include <QVector>

/**
 * Plain data structures that mirror the database tables. They intentionally
 * contain no logic beyond a couple of convenience helpers so they can be passed
 * freely between the repository layer and the UI.
 */
namespace model {

/// A top-level grouping of archive objects, e.g. "Books", "Photographs",
/// "Films". Categories are created by the user at runtime.
struct Category {
    int id = -1;
    QString name;
    QString description;
    int position = 0;
};

/// The data type of a user-defined field.
enum class FieldType {
    Text,        ///< single line of text
    MultiLine,   ///< free-form, multi-line text
    Integer,     ///< whole number
    Real,        ///< decimal number
    Date,        ///< calendar date
    Boolean,     ///< yes / no
    Choice       ///< one value picked from a predefined list
};

/// A user-defined attribute attached to every item of a given category,
/// e.g. a "Books" category might define "Author", "Year", "ISBN".
struct FieldDefinition {
    int id = -1;
    int categoryId = -1;
    QString name;
    FieldType type = FieldType::Text;
    bool required = false;
    int position = 0;
    /// For FieldType::Choice: the list of allowed values.
    QStringList options;
};

/// A single archived object. Built-in attributes (title, inventory number,
/// location, notes) apply to every item; everything else lives in the flexible
/// per-category field values.
struct Item {
    int id = -1;
    int categoryId = -1;
    QString title;
    QString inventoryNo;   ///< inventory / signature number
    QString location;      ///< physical storage location in the archive
    QString notes;
    QDateTime createdAt;
    QDateTime updatedAt;

    /// fieldDefinitionId -> stored value (as text, interpreted via FieldType).
    QHash<int, QString> fieldValues;
};

/// A free-form tag that can be attached to any item across categories.
struct Label {
    int id = -1;
    QString name;
    QString color;  ///< "#rrggbb"
};

/// A file (scan, photo, video, document) attached to an item. The file itself
/// is copied into the archive's data directory; the database keeps the
/// relative path and metadata.
struct Attachment {
    int id = -1;
    int itemId = -1;
    QString originalName;  ///< file name as imported
    QString storedPath;    ///< path relative to the attachments directory
    qint64 size = 0;
    QDateTime addedAt;
};

inline QString fieldTypeToString(FieldType t)
{
    switch (t) {
    case FieldType::Text:      return QStringLiteral("text");
    case FieldType::MultiLine: return QStringLiteral("multiline");
    case FieldType::Integer:   return QStringLiteral("integer");
    case FieldType::Real:      return QStringLiteral("real");
    case FieldType::Date:      return QStringLiteral("date");
    case FieldType::Boolean:   return QStringLiteral("boolean");
    case FieldType::Choice:    return QStringLiteral("choice");
    }
    return QStringLiteral("text");
}

inline FieldType fieldTypeFromString(const QString &s)
{
    if (s == QLatin1String("multiline")) return FieldType::MultiLine;
    if (s == QLatin1String("integer"))   return FieldType::Integer;
    if (s == QLatin1String("real"))      return FieldType::Real;
    if (s == QLatin1String("date"))      return FieldType::Date;
    if (s == QLatin1String("boolean"))   return FieldType::Boolean;
    if (s == QLatin1String("choice"))    return FieldType::Choice;
    return FieldType::Text;
}

/// Human-readable label for a field type, used in the UI.
inline QString fieldTypeDisplayName(FieldType t)
{
    switch (t) {
    case FieldType::Text:      return QObject::tr("Text");
    case FieldType::MultiLine: return QObject::tr("Text (mehrzeilig)");
    case FieldType::Integer:   return QObject::tr("Ganzzahl");
    case FieldType::Real:      return QObject::tr("Dezimalzahl");
    case FieldType::Date:      return QObject::tr("Datum");
    case FieldType::Boolean:   return QObject::tr("Ja/Nein");
    case FieldType::Choice:    return QObject::tr("Auswahlliste");
    }
    return QObject::tr("Text");
}

} // namespace model
