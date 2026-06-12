#include "repository/AttachmentRepository.h"
#include "repository/SqlUtil.h"

#include <QDateTime>
#include <QDir>
#include <QFileInfo>
#include <QSqlError>
#include <QSqlQuery>
#include <QUuid>
#include <QVariant>

namespace repository {

namespace {
const QString kIsoFormat = QStringLiteral("yyyy-MM-ddTHH:mm:ss");
}

AttachmentRepository::AttachmentRepository(QSqlDatabase database, QString attachmentsDir)
    : m_db(std::move(database))
    , m_attachmentsDir(std::move(attachmentsDir))
{
}

QVector<model::Attachment> AttachmentRepository::listForItem(int itemId) const
{
    QVector<model::Attachment> result;
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "SELECT id, item_id, original_name, stored_path, size, added_at "
        "FROM attachment WHERE item_id = ? ORDER BY added_at, id"));
    query.addBindValue(itemId);
    if (!query.exec())
        return result;
    while (query.next()) {
        model::Attachment a;
        a.id = query.value(0).toInt();
        a.itemId = query.value(1).toInt();
        a.originalName = query.value(2).toString();
        a.storedPath = query.value(3).toString();
        a.size = query.value(4).toLongLong();
        a.addedAt = QDateTime::fromString(query.value(5).toString(), kIsoFormat);
        result.append(a);
    }
    return result;
}

bool AttachmentRepository::add(int itemId, const QString &sourceFilePath, model::Attachment *out)
{
    QFileInfo source(sourceFilePath);
    if (!source.exists() || !source.isFile()) {
        m_lastError = QObject::tr("Quelldatei existiert nicht: %1").arg(sourceFilePath);
        return false;
    }

    QDir().mkpath(m_attachmentsDir);

    // Store under a unique name to avoid collisions, but keep the extension so
    // the file opens with the right program.
    const QString suffix = source.suffix();
    QString storedName = QUuid::createUuid().toString(QUuid::Id128);
    if (!suffix.isEmpty())
        storedName += QLatin1Char('.') + suffix;

    const QString destPath = QDir(m_attachmentsDir).filePath(storedName);
    if (!QFile::copy(sourceFilePath, destPath)) {
        m_lastError = QObject::tr("Datei konnte nicht kopiert werden.");
        return false;
    }

    const QString now = QDateTime::currentDateTime().toString(kIsoFormat);
    QSqlQuery query(m_db);
    query.prepare(QStringLiteral(
        "INSERT INTO attachment (item_id, original_name, stored_path, size, added_at) "
        "VALUES (?, ?, ?, ?, ?)"));
    query.addBindValue(itemId);
    query.addBindValue(text(source.fileName()));
    query.addBindValue(text(storedName));
    query.addBindValue(source.size());
    query.addBindValue(now);
    if (!query.exec()) {
        m_lastError = query.lastError().text();
        QFile::remove(destPath); // keep the folder and database in sync
        return false;
    }

    if (out) {
        out->id = query.lastInsertId().toInt();
        out->itemId = itemId;
        out->originalName = source.fileName();
        out->storedPath = storedName;
        out->size = source.size();
        out->addedAt = QDateTime::fromString(now, kIsoFormat);
    }
    return true;
}

bool AttachmentRepository::remove(int attachmentId)
{
    QSqlQuery select(m_db);
    select.prepare(QStringLiteral("SELECT stored_path FROM attachment WHERE id = ?"));
    select.addBindValue(attachmentId);
    QString storedPath;
    if (select.exec() && select.next())
        storedPath = select.value(0).toString();

    QSqlQuery del(m_db);
    del.prepare(QStringLiteral("DELETE FROM attachment WHERE id = ?"));
    del.addBindValue(attachmentId);
    if (!del.exec()) {
        m_lastError = del.lastError().text();
        return false;
    }

    if (!storedPath.isEmpty())
        QFile::remove(QDir(m_attachmentsDir).filePath(storedPath));
    return true;
}

QString AttachmentRepository::absolutePath(const model::Attachment &attachment) const
{
    return QDir(m_attachmentsDir).filePath(attachment.storedPath);
}

} // namespace repository
