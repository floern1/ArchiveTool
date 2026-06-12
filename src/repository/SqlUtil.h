#pragma once

#include <QString>
#include <QVariant>

namespace repository {

/**
 * Returns a bind value for a text column that is never SQL NULL.
 *
 * A default-constructed or cleared QString is "null"; Qt binds that as SQL
 * NULL, which violates the NOT NULL constraints on our text columns. Wrapping
 * user-supplied strings with text() guarantees an empty string is stored
 * instead of NULL.
 */
inline QVariant text(const QString &value)
{
    return value.isNull() ? QVariant(QString::fromLatin1("")) : QVariant(value);
}

} // namespace repository
