#include "ui/ItemEditorDialog.h"

#include <QCheckBox>
#include <QComboBox>
#include <QDateEdit>
#include <QDesktopServices>
#include <QDialogButtonBox>
#include <QDoubleValidator>
#include <QFileDialog>
#include <QFileInfo>
#include <QFormLayout>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QIntValidator>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPixmap>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QScrollArea>
#include <QUrl>
#include <QVBoxLayout>

namespace ui {

namespace {
const QString kIsoDate = QStringLiteral("yyyy-MM-dd");
}

ItemEditorDialog::ItemEditorDialog(QSqlDatabase database,
                                   QString attachmentsDir,
                                   const model::Category &category,
                                   const QVector<model::FieldDefinition> &fields,
                                   QWidget *parent)
    : QDialog(parent)
    , m_db(database)
    , m_attachmentsDir(std::move(attachmentsDir))
    , m_category(category)
    , m_fields(fields)
    , m_items(database)
    , m_labels(database)
    , m_attachments(database, m_attachmentsDir)
{
    m_item.categoryId = category.id;
    setWindowTitle(tr("Neues Objekt – %1").arg(category.name));
    resize(560, 640);
    buildForm();
    reloadLabelList();
    reloadAttachmentList();
}

void ItemEditorDialog::buildForm()
{
    auto *outer = new QVBoxLayout(this);

    // Scroll area so categories with many fields stay usable on small screens.
    auto *scroll = new QScrollArea(this);
    scroll->setWidgetResizable(true);
    auto *container = new QWidget;
    auto *containerLayout = new QVBoxLayout(container);

    auto *formBox = new QGroupBox(tr("Angaben"), container);
    m_form = new QFormLayout(formBox);

    m_titleEdit = new QLineEdit(formBox);
    m_form->addRow(tr("Titel / Bezeichnung *:"), m_titleEdit);
    m_inventoryEdit = new QLineEdit(formBox);
    m_form->addRow(tr("Inventar-/Signaturnr.:"), m_inventoryEdit);
    m_locationEdit = new QLineEdit(formBox);
    m_form->addRow(tr("Standort:"), m_locationEdit);

    // Dynamic, per-category fields.
    for (const model::FieldDefinition &def : m_fields) {
        FieldWidget fw;
        fw.def = def;
        fw.editor = createEditor(def);
        if (def.type == model::FieldType::Date) {
            // Dates are often unknown in an archive, so make them optional via a
            // checkbox that enables/disables the date editor.
            fw.dateEnabled = new QCheckBox(tr("gesetzt"), formBox);
            fw.dateEnabled->setChecked(false);
            fw.editor->setEnabled(false);
            connect(fw.dateEnabled, &QCheckBox::toggled, fw.editor, &QWidget::setEnabled);
        }
        QString label = def.name;
        if (def.required)
            label += QStringLiteral(" *");
        label += QLatin1Char(':');

        if (fw.dateEnabled) {
            auto *row = new QWidget(formBox);
            auto *rowLayout = new QHBoxLayout(row);
            rowLayout->setContentsMargins(0, 0, 0, 0);
            rowLayout->addWidget(fw.dateEnabled);
            rowLayout->addWidget(fw.editor, 1);
            m_form->addRow(label, row);
        } else {
            m_form->addRow(label, fw.editor);
        }
        m_fieldWidgets.append(fw);
    }

    m_notesEdit = new QPlainTextEdit(formBox);
    m_notesEdit->setMaximumHeight(90);
    m_form->addRow(tr("Notizen:"), m_notesEdit);

    containerLayout->addWidget(formBox);

    // Labels.
    auto *labelBox = new QGroupBox(tr("Labels"), container);
    auto *labelLayout = new QVBoxLayout(labelBox);
    m_labelList = new QListWidget(labelBox);
    m_labelList->setMaximumHeight(120);
    labelLayout->addWidget(m_labelList);
    containerLayout->addWidget(labelBox);

    // Attachments.
    auto *attachBox = new QGroupBox(tr("Anhänge (Scans, Fotos, Dokumente …)"), container);
    auto *attachLayout = new QVBoxLayout(attachBox);
    m_attachmentList = new QListWidget(attachBox);
    m_attachmentList->setMaximumHeight(120);
    attachLayout->addWidget(m_attachmentList);
    auto *attachButtons = new QHBoxLayout;
    auto *addAttachButton = new QPushButton(tr("Hinzufügen …"), attachBox);
    auto *openAttachButton = new QPushButton(tr("Öffnen"), attachBox);
    auto *removeAttachButton = new QPushButton(tr("Entfernen"), attachBox);
    attachButtons->addWidget(addAttachButton);
    attachButtons->addWidget(openAttachButton);
    attachButtons->addWidget(removeAttachButton);
    attachButtons->addStretch(1);
    attachLayout->addLayout(attachButtons);
    containerLayout->addWidget(attachBox);

    containerLayout->addStretch(1);
    scroll->setWidget(container);
    outer->addWidget(scroll, 1);

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Save | QDialogButtonBox::Cancel, this);
    connect(buttons, &QDialogButtonBox::accepted, this, &ItemEditorDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::reject);
    outer->addWidget(buttons);

    connect(addAttachButton, &QPushButton::clicked, this, &ItemEditorDialog::onAddAttachment);
    connect(openAttachButton, &QPushButton::clicked, this, &ItemEditorDialog::onOpenAttachment);
    connect(m_attachmentList, &QListWidget::itemDoubleClicked, this, &ItemEditorDialog::onOpenAttachment);
    connect(removeAttachButton, &QPushButton::clicked, this, &ItemEditorDialog::onRemoveAttachment);
}

QWidget *ItemEditorDialog::createEditor(const model::FieldDefinition &field)
{
    // Note: the FieldWidget for Date fields also needs a checkbox; that is
    // created here and stored on the most recently appended FieldWidget by the
    // caller. To keep things simple we handle Date specially below.
    switch (field.type) {
    case model::FieldType::Text:
        return new QLineEdit(this);
    case model::FieldType::MultiLine: {
        auto *edit = new QPlainTextEdit(this);
        edit->setMaximumHeight(80);
        return edit;
    }
    case model::FieldType::Integer: {
        auto *edit = new QLineEdit(this);
        edit->setValidator(new QIntValidator(edit));
        return edit;
    }
    case model::FieldType::Real: {
        auto *edit = new QLineEdit(this);
        auto *validator = new QDoubleValidator(edit);
        validator->setNotation(QDoubleValidator::StandardNotation);
        edit->setValidator(validator);
        return edit;
    }
    case model::FieldType::Date: {
        auto *edit = new QDateEdit(this);
        edit->setCalendarPopup(true);
        edit->setDisplayFormat(QStringLiteral("dd.MM.yyyy"));
        edit->setDate(QDate::currentDate());
        return edit;
    }
    case model::FieldType::Boolean:
        return new QCheckBox(tr("Ja"), this);
    case model::FieldType::Choice: {
        auto *combo = new QComboBox(this);
        if (!field.required)
            combo->addItem(QString()); // allow "not set"
        combo->addItems(field.options);
        return combo;
    }
    }
    return new QLineEdit(this);
}

QString ItemEditorDialog::readFieldValue(const FieldWidget &fw) const
{
    switch (fw.def.type) {
    case model::FieldType::Text:
    case model::FieldType::Integer:
    case model::FieldType::Real:
        return qobject_cast<QLineEdit *>(fw.editor)->text().trimmed();
    case model::FieldType::MultiLine:
        return qobject_cast<QPlainTextEdit *>(fw.editor)->toPlainText();
    case model::FieldType::Date:
        if (fw.dateEnabled && !fw.dateEnabled->isChecked())
            return QString();
        return qobject_cast<QDateEdit *>(fw.editor)->date().toString(kIsoDate);
    case model::FieldType::Boolean:
        return qobject_cast<QCheckBox *>(fw.editor)->isChecked() ? QStringLiteral("1") : QString();
    case model::FieldType::Choice:
        return qobject_cast<QComboBox *>(fw.editor)->currentText();
    }
    return QString();
}

void ItemEditorDialog::writeFieldValue(const FieldWidget &fw, const QString &value)
{
    switch (fw.def.type) {
    case model::FieldType::Text:
    case model::FieldType::Integer:
    case model::FieldType::Real:
        qobject_cast<QLineEdit *>(fw.editor)->setText(value);
        break;
    case model::FieldType::MultiLine:
        qobject_cast<QPlainTextEdit *>(fw.editor)->setPlainText(value);
        break;
    case model::FieldType::Date: {
        auto *edit = qobject_cast<QDateEdit *>(fw.editor);
        const QDate date = QDate::fromString(value, kIsoDate);
        const bool hasDate = date.isValid();
        if (fw.dateEnabled)
            fw.dateEnabled->setChecked(hasDate);
        edit->setEnabled(hasDate);
        edit->setDate(hasDate ? date : QDate::currentDate());
        break;
    }
    case model::FieldType::Boolean:
        qobject_cast<QCheckBox *>(fw.editor)->setChecked(value == QLatin1String("1"));
        break;
    case model::FieldType::Choice: {
        auto *combo = qobject_cast<QComboBox *>(fw.editor);
        const int index = combo->findText(value);
        combo->setCurrentIndex(index >= 0 ? index : 0);
        break;
    }
    }
}

void ItemEditorDialog::setItem(const model::Item &item)
{
    m_item = item;
    setWindowTitle(tr("Objekt bearbeiten – %1").arg(m_category.name));

    m_titleEdit->setText(item.title);
    m_inventoryEdit->setText(item.inventoryNo);
    m_locationEdit->setText(item.location);
    m_notesEdit->setPlainText(item.notes);

    for (const FieldWidget &fw : m_fieldWidgets) {
        const QString value = item.fieldValues.value(fw.def.id);
        writeFieldValue(fw, value);
    }

    reloadLabelList();
    reloadAttachmentList();
}

void ItemEditorDialog::reloadLabelList()
{
    if (!m_labelList)
        return;
    m_labelList->clear();

    QVector<int> assigned;
    if (m_item.id > 0) {
        for (const model::Label &l : m_labels.labelsForItem(m_item.id))
            assigned.append(l.id);
    }

    for (const model::Label &l : m_labels.list()) {
        auto *item = new QListWidgetItem(l.name, m_labelList);
        item->setData(Qt::UserRole, l.id);
        item->setFlags(item->flags() | Qt::ItemIsUserCheckable);
        item->setCheckState(assigned.contains(l.id) ? Qt::Checked : Qt::Unchecked);
        QPixmap pm(12, 12);
        pm.fill(QColor(l.color));
        item->setIcon(QIcon(pm));
    }
    if (m_labelList->count() == 0)
        m_labelList->addItem(tr("(noch keine Labels angelegt)"));
}

void ItemEditorDialog::reloadAttachmentList()
{
    if (!m_attachmentList)
        return;

    // Build the in-memory entry list from the database the first time (for an
    // existing item) or keep the working copy on later refreshes.
    if (m_item.id > 0 && m_attachmentEntries.isEmpty()) {
        for (const model::Attachment &a : m_attachments.listForItem(m_item.id)) {
            AttachmentEntry entry;
            entry.id = a.id;
            entry.displayName = a.originalName;
            m_attachmentEntries.append(entry);
        }
    }

    m_attachmentList->clear();
    for (int i = 0; i < m_attachmentEntries.size(); ++i) {
        const AttachmentEntry &entry = m_attachmentEntries[i];
        if (entry.removed)
            continue;
        auto *item = new QListWidgetItem(entry.displayName, m_attachmentList);
        item->setData(Qt::UserRole, i); // index into m_attachmentEntries
    }
}

void ItemEditorDialog::onAddAttachment()
{
    const QStringList files = QFileDialog::getOpenFileNames(
        this, tr("Dateien als Anhang hinzufügen"));
    for (const QString &path : files) {
        AttachmentEntry entry;
        entry.sourcePath = path;
        entry.displayName = QFileInfo(path).fileName();
        m_attachmentEntries.append(entry);
    }
    reloadAttachmentList();
}

void ItemEditorDialog::onOpenAttachment()
{
    QListWidgetItem *selected = m_attachmentList->currentItem();
    if (!selected)
        return;
    const int index = selected->data(Qt::UserRole).toInt();
    if (index < 0 || index >= m_attachmentEntries.size())
        return;
    const AttachmentEntry &entry = m_attachmentEntries[index];

    QString path;
    if (entry.id > 0) {
        for (const model::Attachment &x : m_attachments.listForItem(m_item.id)) {
            if (x.id == entry.id) {
                path = m_attachments.absolutePath(x);
                break;
            }
        }
    } else {
        path = entry.sourcePath;
    }
    if (!path.isEmpty())
        QDesktopServices::openUrl(QUrl::fromLocalFile(path));
}

void ItemEditorDialog::onRemoveAttachment()
{
    QListWidgetItem *selected = m_attachmentList->currentItem();
    if (!selected)
        return;
    const int index = selected->data(Qt::UserRole).toInt();
    if (index < 0 || index >= m_attachmentEntries.size())
        return;

    // Mark as removed. An existing attachment (id > 0) is deleted from the
    // database on save; a pending one is simply never added.
    m_attachmentEntries[index].removed = true;
    reloadAttachmentList();
}

void ItemEditorDialog::accept()
{
    const QString title = m_titleEdit->text().trimmed();
    if (title.isEmpty()) {
        QMessageBox::warning(this, tr("Eingabe unvollständig"),
                             tr("Bitte einen Titel angeben."));
        return;
    }

    // Validate required custom fields.
    for (const FieldWidget &fw : m_fieldWidgets) {
        if (fw.def.required && readFieldValue(fw).isEmpty()) {
            QMessageBox::warning(this, tr("Eingabe unvollständig"),
                                 tr("Das Pflichtfeld \"%1\" muss ausgefüllt werden.")
                                     .arg(fw.def.name));
            return;
        }
    }

    m_item.title = title;
    m_item.inventoryNo = m_inventoryEdit->text().trimmed();
    m_item.location = m_locationEdit->text().trimmed();
    m_item.notes = m_notesEdit->toPlainText();
    m_item.fieldValues.clear();
    for (const FieldWidget &fw : m_fieldWidgets) {
        const QString value = readFieldValue(fw);
        if (!value.isEmpty())
            m_item.fieldValues.insert(fw.def.id, value);
    }

    bool ok = false;
    if (m_item.id > 0)
        ok = m_items.update(m_item);
    else
        ok = m_items.insert(m_item);
    if (!ok) {
        QMessageBox::critical(this, tr("Fehler"),
                              tr("Das Objekt konnte nicht gespeichert werden:\n%1")
                                  .arg(m_items.lastError()));
        return;
    }
    m_savedItemId = m_item.id;

    // Labels.
    QVector<int> labelIds;
    for (int i = 0; i < m_labelList->count(); ++i) {
        QListWidgetItem *item = m_labelList->item(i);
        if ((item->flags() & Qt::ItemIsUserCheckable)
            && item->checkState() == Qt::Checked)
            labelIds.append(item->data(Qt::UserRole).toInt());
    }
    m_labels.setLabelsForItem(m_item.id, labelIds);

    // Attachments: apply pending additions and removals.
    for (const AttachmentEntry &entry : m_attachmentEntries) {
        if (entry.id > 0 && entry.removed) {
            m_attachments.remove(entry.id);
        } else if (entry.id <= 0 && !entry.removed && !entry.sourcePath.isEmpty()) {
            m_attachments.add(m_item.id, entry.sourcePath, nullptr);
        }
    }

    QDialog::accept();
}

} // namespace ui
