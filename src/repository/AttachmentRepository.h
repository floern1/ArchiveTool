#pragma once

#include "model/Models.h"

#include <QSqlDatabase>
#include <QVector>

namespace repository {

/**
 * Persists file attachments. The actual file bytes are copied into the
 * archive's attachments directory; the database stores a relative path plus
 * metadata so the archive folder stays self-contained and portable.
 */
class AttachmentRepository {
public:
    AttachmentRepository(QSqlDatabase database, QString attachmentsDir);

    QVector<model::Attachment> listForItem(int itemId) const;

    /// Copy @p sourceFilePath into the attachments directory and record it for
    /// @p itemId. On success fills @p out with the stored attachment.
    bool add(int itemId, const QString &sourceFilePath, model::Attachment *out);

    /// Remove the database row and delete the stored file.
    bool remove(int attachmentId);

    /// Absolute path to a stored attachment's file.
    QString absolutePath(const model::Attachment &attachment) const;

    QString lastError() const { return m_lastError; }

private:
    QSqlDatabase m_db;
    QString m_attachmentsDir;
    QString m_lastError;
};

} // namespace repository
