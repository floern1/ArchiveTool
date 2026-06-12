#include "ui/FieldEditorDialog.h"

#include <QCheckBox>
#include <QComboBox>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QLabel>
#include <QLineEdit>
#include <QMessageBox>
#include <QPlainTextEdit>
#include <QVBoxLayout>

namespace ui {

FieldEditorDialog::FieldEditorDialog(QWidget *parent)
    : QDialog(parent)
{
    setWindowTitle(tr("Feld bearbeiten"));
    setMinimumWidth(380);

    auto *layout = new QVBoxLayout(this);
    auto *form = new QFormLayout;

    m_nameEdit = new QLineEdit(this);
    form->addRow(tr("Name:"), m_nameEdit);

    m_typeCombo = new QComboBox(this);
    const model::FieldType types[] = {
        model::FieldType::Text,      model::FieldType::MultiLine,
        model::FieldType::Integer,   model::FieldType::Real,
        model::FieldType::Date,      model::FieldType::Boolean,
        model::FieldType::Choice,
    };
    for (model::FieldType type : types)
        m_typeCombo->addItem(model::fieldTypeDisplayName(type),
                             static_cast<int>(type));
    form->addRow(tr("Typ:"), m_typeCombo);

    m_requiredCheck = new QCheckBox(tr("Pflichtfeld"), this);
    form->addRow(QString(), m_requiredCheck);

    m_optionsLabel = new QLabel(tr("Auswahlmöglichkeiten\n(eine pro Zeile):"), this);
    m_optionsEdit = new QPlainTextEdit(this);
    m_optionsEdit->setPlaceholderText(tr("z. B.\nOriginal\nKopie\nDigitalisat"));
    form->addRow(m_optionsLabel, m_optionsEdit);

    layout->addLayout(form);

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, this);
    connect(buttons, &QDialogButtonBox::accepted, this, &FieldEditorDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &FieldEditorDialog::reject);
    layout->addWidget(buttons);

    connect(m_typeCombo, &QComboBox::currentIndexChanged, this, &FieldEditorDialog::onTypeChanged);
    onTypeChanged();
}

void FieldEditorDialog::setField(const model::FieldDefinition &field)
{
    m_field = field;
    m_nameEdit->setText(field.name);
    const int index = m_typeCombo->findData(static_cast<int>(field.type));
    if (index >= 0)
        m_typeCombo->setCurrentIndex(index);
    m_requiredCheck->setChecked(field.required);
    m_optionsEdit->setPlainText(field.options.join(QLatin1Char('\n')));
    onTypeChanged();
}

void FieldEditorDialog::onTypeChanged()
{
    const auto type = static_cast<model::FieldType>(m_typeCombo->currentData().toInt());
    const bool isChoice = (type == model::FieldType::Choice);
    m_optionsLabel->setVisible(isChoice);
    m_optionsEdit->setVisible(isChoice);
}

model::FieldDefinition FieldEditorDialog::field() const
{
    model::FieldDefinition f = m_field;
    f.name = m_nameEdit->text().trimmed();
    f.type = static_cast<model::FieldType>(m_typeCombo->currentData().toInt());
    f.required = m_requiredCheck->isChecked();
    if (f.type == model::FieldType::Choice)
        f.options = m_optionsEdit->toPlainText().split(QLatin1Char('\n'), Qt::SkipEmptyParts);
    else
        f.options.clear();
    return f;
}

void FieldEditorDialog::accept()
{
    if (m_nameEdit->text().trimmed().isEmpty()) {
        QMessageBox::warning(this, tr("Eingabe unvollständig"),
                             tr("Bitte einen Namen für das Feld angeben."));
        return;
    }
    const auto type = static_cast<model::FieldType>(m_typeCombo->currentData().toInt());
    if (type == model::FieldType::Choice
        && m_optionsEdit->toPlainText().split(QLatin1Char('\n'), Qt::SkipEmptyParts).isEmpty()) {
        QMessageBox::warning(this, tr("Eingabe unvollständig"),
                             tr("Bitte mindestens eine Auswahlmöglichkeit angeben."));
        return;
    }
    QDialog::accept();
}

} // namespace ui
