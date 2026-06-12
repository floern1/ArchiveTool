#include "ui/CategoryManagerDialog.h"
#include "ui/FieldEditorDialog.h"

#include <QDialogButtonBox>
#include <QGroupBox>
#include <QHBoxLayout>
#include <QInputDialog>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSplitter>
#include <QVBoxLayout>

namespace ui {

CategoryManagerDialog::CategoryManagerDialog(QSqlDatabase database, QWidget *parent)
    : QDialog(parent)
    , m_db(database)
    , m_categories(database)
    , m_fields(database)
{
    setWindowTitle(tr("Kategorien & Felder verwalten"));
    resize(720, 480);

    auto *topLayout = new QVBoxLayout(this);
    auto *splitter = new QSplitter(Qt::Horizontal, this);

    // ---- Left: category list ---------------------------------------------
    auto *leftWidget = new QWidget(splitter);
    auto *leftLayout = new QVBoxLayout(leftWidget);
    leftLayout->setContentsMargins(0, 0, 0, 0);
    leftLayout->addWidget(new QLabel(tr("Kategorien:"), leftWidget));

    m_categoryList = new QListWidget(leftWidget);
    leftLayout->addWidget(m_categoryList, 1);

    auto *catButtons = new QHBoxLayout;
    auto *addCategoryButton = new QPushButton(tr("Neu …"), leftWidget);
    m_deleteCategoryButton = new QPushButton(tr("Löschen"), leftWidget);
    catButtons->addWidget(addCategoryButton);
    catButtons->addWidget(m_deleteCategoryButton);
    leftLayout->addLayout(catButtons);

    splitter->addWidget(leftWidget);

    // ---- Right: category details + fields ---------------------------------
    auto *rightWidget = new QWidget(splitter);
    auto *rightLayout = new QVBoxLayout(rightWidget);
    rightLayout->setContentsMargins(0, 0, 0, 0);

    auto *metaBox = new QGroupBox(tr("Kategorie"), rightWidget);
    auto *metaLayout = new QVBoxLayout(metaBox);
    metaLayout->addWidget(new QLabel(tr("Name:"), metaBox));
    m_nameEdit = new QLineEdit(metaBox);
    metaLayout->addWidget(m_nameEdit);
    metaLayout->addWidget(new QLabel(tr("Beschreibung:"), metaBox));
    m_descEdit = new QPlainTextEdit(metaBox);
    m_descEdit->setMaximumHeight(70);
    metaLayout->addWidget(m_descEdit);
    m_saveMetaButton = new QPushButton(tr("Änderungen speichern"), metaBox);
    metaLayout->addWidget(m_saveMetaButton, 0, Qt::AlignRight);
    rightLayout->addWidget(metaBox);

    auto *fieldBox = new QGroupBox(tr("Felder dieser Kategorie"), rightWidget);
    auto *fieldLayout = new QHBoxLayout(fieldBox);
    m_fieldList = new QListWidget(fieldBox);
    fieldLayout->addWidget(m_fieldList, 1);

    auto *fieldButtons = new QVBoxLayout;
    m_addFieldButton = new QPushButton(tr("Hinzufügen …"), fieldBox);
    m_editFieldButton = new QPushButton(tr("Bearbeiten …"), fieldBox);
    m_deleteFieldButton = new QPushButton(tr("Entfernen"), fieldBox);
    m_moveUpButton = new QPushButton(tr("▲ Nach oben"), fieldBox);
    m_moveDownButton = new QPushButton(tr("▼ Nach unten"), fieldBox);
    fieldButtons->addWidget(m_addFieldButton);
    fieldButtons->addWidget(m_editFieldButton);
    fieldButtons->addWidget(m_deleteFieldButton);
    fieldButtons->addSpacing(12);
    fieldButtons->addWidget(m_moveUpButton);
    fieldButtons->addWidget(m_moveDownButton);
    fieldButtons->addStretch(1);
    fieldLayout->addLayout(fieldButtons);
    rightLayout->addWidget(fieldBox, 1);

    splitter->addWidget(rightWidget);
    splitter->setStretchFactor(0, 0);
    splitter->setStretchFactor(1, 1);
    topLayout->addWidget(splitter, 1);

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Close, this);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::accept);
    connect(buttons, &QDialogButtonBox::accepted, this, &QDialog::accept);
    topLayout->addWidget(buttons);

    connect(m_categoryList, &QListWidget::currentRowChanged, this,
            &CategoryManagerDialog::onCategorySelectionChanged);
    connect(addCategoryButton, &QPushButton::clicked, this, &CategoryManagerDialog::onAddCategory);
    connect(m_deleteCategoryButton, &QPushButton::clicked, this, &CategoryManagerDialog::onDeleteCategory);
    connect(m_saveMetaButton, &QPushButton::clicked, this, &CategoryManagerDialog::onSaveCategoryMeta);
    connect(m_addFieldButton, &QPushButton::clicked, this, &CategoryManagerDialog::onAddField);
    connect(m_editFieldButton, &QPushButton::clicked, this, &CategoryManagerDialog::onEditField);
    connect(m_fieldList, &QListWidget::itemDoubleClicked, this, &CategoryManagerDialog::onEditField);
    connect(m_deleteFieldButton, &QPushButton::clicked, this, &CategoryManagerDialog::onDeleteField);
    connect(m_moveUpButton, &QPushButton::clicked, this, &CategoryManagerDialog::onMoveFieldUp);
    connect(m_moveDownButton, &QPushButton::clicked, this, &CategoryManagerDialog::onMoveFieldDown);

    reloadCategories();
}

int CategoryManagerDialog::currentCategoryId() const
{
    QListWidgetItem *item = m_categoryList->currentItem();
    return item ? item->data(Qt::UserRole).toInt() : -1;
}

int CategoryManagerDialog::currentFieldId() const
{
    QListWidgetItem *item = m_fieldList->currentItem();
    return item ? item->data(Qt::UserRole).toInt() : -1;
}

void CategoryManagerDialog::reloadCategories(int selectId)
{
    m_categoryList->blockSignals(true);
    m_categoryList->clear();
    int rowToSelect = -1;
    const auto categories = m_categories.list();
    for (int i = 0; i < categories.size(); ++i) {
        const model::Category &c = categories[i];
        auto *item = new QListWidgetItem(c.name, m_categoryList);
        item->setData(Qt::UserRole, c.id);
        if (c.id == selectId)
            rowToSelect = i;
    }
    m_categoryList->blockSignals(false);

    if (rowToSelect < 0 && m_categoryList->count() > 0)
        rowToSelect = 0;
    m_categoryList->setCurrentRow(rowToSelect);
    onCategorySelectionChanged();
}

void CategoryManagerDialog::onCategorySelectionChanged()
{
    const int id = currentCategoryId();
    const bool hasSelection = (id > 0);

    m_nameEdit->setEnabled(hasSelection);
    m_descEdit->setEnabled(hasSelection);
    m_saveMetaButton->setEnabled(hasSelection);
    m_deleteCategoryButton->setEnabled(hasSelection);
    m_addFieldButton->setEnabled(hasSelection);

    if (!hasSelection) {
        m_nameEdit->clear();
        m_descEdit->clear();
        m_fieldList->clear();
        reloadFields();
        return;
    }

    if (auto category = m_categories.get(id)) {
        m_nameEdit->setText(category->name);
        m_descEdit->setPlainText(category->description);
    }
    reloadFields();
}

void CategoryManagerDialog::onAddCategory()
{
    bool ok = false;
    const QString name = QInputDialog::getText(this, tr("Neue Kategorie"),
                                               tr("Name der Kategorie:"), QLineEdit::Normal,
                                               QString(), &ok);
    if (!ok || name.trimmed().isEmpty())
        return;

    model::Category c;
    c.name = name.trimmed();
    c.position = m_categoryList->count();
    if (!m_categories.insert(c)) {
        QMessageBox::warning(this, tr("Fehler"), m_categories.lastError());
        return;
    }
    reloadCategories(c.id);
}

void CategoryManagerDialog::onDeleteCategory()
{
    const int id = currentCategoryId();
    if (id <= 0)
        return;

    const int count = m_categories.itemCount(id);
    QString message = tr("Kategorie wirklich löschen?");
    if (count > 0) {
        message += QLatin1Char('\n')
                   + tr("Achtung: %n darin gespeicherte(s) Objekt(e) werden ebenfalls gelöscht.",
                        nullptr, count);
    }
    if (QMessageBox::question(this, tr("Kategorie löschen"), message)
        != QMessageBox::Yes)
        return;

    if (!m_categories.remove(id)) {
        QMessageBox::warning(this, tr("Fehler"), m_categories.lastError());
        return;
    }
    reloadCategories();
}

void CategoryManagerDialog::onSaveCategoryMeta()
{
    const int id = currentCategoryId();
    if (id <= 0)
        return;
    if (m_nameEdit->text().trimmed().isEmpty()) {
        QMessageBox::warning(this, tr("Eingabe unvollständig"),
                             tr("Bitte einen Namen angeben."));
        return;
    }

    auto category = m_categories.get(id);
    if (!category)
        return;
    category->name = m_nameEdit->text().trimmed();
    category->description = m_descEdit->toPlainText();
    if (!m_categories.update(*category)) {
        QMessageBox::warning(this, tr("Fehler"), m_categories.lastError());
        return;
    }
    reloadCategories(id);
}

void CategoryManagerDialog::reloadFields()
{
    m_fieldList->clear();
    const int id = currentCategoryId();
    const bool hasFieldSelection = (id > 0);
    m_editFieldButton->setEnabled(false);
    m_deleteFieldButton->setEnabled(false);
    m_moveUpButton->setEnabled(false);
    m_moveDownButton->setEnabled(false);
    if (!hasFieldSelection)
        return;

    const auto fields = m_fields.listForCategory(id);
    for (const model::FieldDefinition &f : fields) {
        QString text = QStringLiteral("%1  (%2%3)")
                           .arg(f.name, model::fieldTypeDisplayName(f.type),
                                f.required ? tr(", Pflicht") : QString());
        auto *item = new QListWidgetItem(text, m_fieldList);
        item->setData(Qt::UserRole, f.id);
    }
    if (m_fieldList->count() > 0)
        m_fieldList->setCurrentRow(0);

    const bool any = m_fieldList->count() > 0;
    m_editFieldButton->setEnabled(any);
    m_deleteFieldButton->setEnabled(any);
    m_moveUpButton->setEnabled(any);
    m_moveDownButton->setEnabled(any);
}

void CategoryManagerDialog::onAddField()
{
    const int categoryId = currentCategoryId();
    if (categoryId <= 0)
        return;

    FieldEditorDialog dialog(this);
    if (dialog.exec() != QDialog::Accepted)
        return;

    model::FieldDefinition field = dialog.field();
    field.categoryId = categoryId;
    field.position = m_fieldList->count();
    if (!m_fields.insert(field)) {
        QMessageBox::warning(this, tr("Fehler"), m_fields.lastError());
        return;
    }
    reloadFields();
}

void CategoryManagerDialog::onEditField()
{
    const int fieldId = currentFieldId();
    if (fieldId <= 0)
        return;
    auto existing = m_fields.get(fieldId);
    if (!existing)
        return;

    FieldEditorDialog dialog(this);
    dialog.setField(*existing);
    if (dialog.exec() != QDialog::Accepted)
        return;

    model::FieldDefinition field = dialog.field();
    if (!m_fields.update(field)) {
        QMessageBox::warning(this, tr("Fehler"), m_fields.lastError());
        return;
    }
    reloadFields();
}

void CategoryManagerDialog::onDeleteField()
{
    const int fieldId = currentFieldId();
    if (fieldId <= 0)
        return;
    if (QMessageBox::question(this, tr("Feld entfernen"),
                              tr("Feld wirklich entfernen? Die bisher erfassten Werte "
                                 "dieses Feldes gehen verloren."))
        != QMessageBox::Yes)
        return;
    if (!m_fields.remove(fieldId)) {
        QMessageBox::warning(this, tr("Fehler"), m_fields.lastError());
        return;
    }
    reloadFields();
}

void CategoryManagerDialog::moveField(int direction)
{
    const int row = m_fieldList->currentRow();
    const int other = row + direction;
    if (row < 0 || other < 0 || other >= m_fieldList->count())
        return;

    const int categoryId = currentCategoryId();
    const auto fields = m_fields.listForCategory(categoryId);
    if (row >= fields.size() || other >= fields.size())
        return;

    // Swap positions of the two affected fields and persist.
    model::FieldDefinition a = fields[row];
    model::FieldDefinition b = fields[other];
    std::swap(a.position, b.position);
    m_fields.update(a);
    m_fields.update(b);

    reloadFields();
    m_fieldList->setCurrentRow(other);
}

void CategoryManagerDialog::onMoveFieldUp()
{
    moveField(-1);
}

void CategoryManagerDialog::onMoveFieldDown()
{
    moveField(1);
}

} // namespace ui
