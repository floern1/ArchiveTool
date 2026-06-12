#pragma once

#include "model/Models.h"
#include "repository/AttachmentRepository.h"
#include "repository/ItemRepository.h"
#include "repository/LabelRepository.h"

#include <QDialog>
#include <QSqlDatabase>
#include <QVector>

class QLineEdit;
class QPlainTextEdit;
class QListWidget;
class QFormLayout;
class QWidget;
class QCheckBox;

namespace ui {

/**
 * Create or edit a single archive item. The form is built dynamically from the
 * category's field definitions; built-in attributes (title, inventory number,
 * location, notes), labels and file attachments are always available.
 *
 * On accept the item, its field values, label assignments and attachment
 * changes are persisted. The new/updated item id is available via savedItemId().
 */
class ItemEditorDialog : public QDialog {
    Q_OBJECT
public:
    ItemEditorDialog(QSqlDatabase database,
                     QString attachmentsDir,
                     const model::Category &category,
                     const QVector<model::FieldDefinition> &fields,
                     QWidget *parent = nullptr);

    /// Switch the dialog into "edit" mode for an existing item.
    void setItem(const model::Item &item);

    int savedItemId() const { return m_savedItemId; }

private slots:
    void onAddAttachment();
    void onOpenAttachment();
    void onRemoveAttachment();
    void accept() override;

private:
    /// Editor widget bound to one custom field definition.
    struct FieldWidget {
        model::FieldDefinition def;
        QWidget *editor = nullptr;
        QCheckBox *dateEnabled = nullptr; // only for Date fields
    };

    /// In-memory model of an attachment row (existing, newly added or removed).
    struct AttachmentEntry {
        int id = -1;            // > 0 if it already exists in the database
        QString sourcePath;     // set for newly added (not yet saved) files
        QString displayName;
        bool removed = false;
    };

    void buildForm();
    QWidget *createEditor(const model::FieldDefinition &field);
    QString readFieldValue(const FieldWidget &fw) const;
    void writeFieldValue(const FieldWidget &fw, const QString &value);
    void reloadAttachmentList();
    void reloadLabelList();

    QSqlDatabase m_db;
    QString m_attachmentsDir;
    model::Category m_category;
    QVector<model::FieldDefinition> m_fields;

    repository::ItemRepository m_items;
    repository::LabelRepository m_labels;
    repository::AttachmentRepository m_attachments;

    model::Item m_item;       // current values (id < 0 => new item)
    int m_savedItemId = -1;

    QFormLayout *m_form = nullptr;
    QLineEdit *m_titleEdit = nullptr;
    QLineEdit *m_inventoryEdit = nullptr;
    QLineEdit *m_locationEdit = nullptr;
    QPlainTextEdit *m_notesEdit = nullptr;
    QListWidget *m_labelList = nullptr;
    QListWidget *m_attachmentList = nullptr;

    QVector<FieldWidget> m_fieldWidgets;
    QVector<AttachmentEntry> m_attachmentEntries;
};

} // namespace ui
