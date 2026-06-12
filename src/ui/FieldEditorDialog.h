#pragma once

#include "model/Models.h"

#include <QDialog>

class QLineEdit;
class QComboBox;
class QCheckBox;
class QPlainTextEdit;
class QLabel;

namespace ui {

/// Dialog for creating or editing a single custom field definition.
class FieldEditorDialog : public QDialog {
    Q_OBJECT
public:
    explicit FieldEditorDialog(QWidget *parent = nullptr);

    /// Pre-fill the dialog from an existing field.
    void setField(const model::FieldDefinition &field);

    /// The field as edited by the user (id/categoryId/position are preserved
    /// from setField()).
    model::FieldDefinition field() const;

private slots:
    void onTypeChanged();
    void accept() override;

private:
    model::FieldDefinition m_field;

    QLineEdit *m_nameEdit = nullptr;
    QComboBox *m_typeCombo = nullptr;
    QCheckBox *m_requiredCheck = nullptr;
    QLabel *m_optionsLabel = nullptr;
    QPlainTextEdit *m_optionsEdit = nullptr;
};

} // namespace ui
