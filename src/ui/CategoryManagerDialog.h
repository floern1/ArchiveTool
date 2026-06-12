#pragma once

#include "model/Models.h"
#include "repository/CategoryRepository.h"
#include "repository/FieldRepository.h"

#include <QDialog>
#include <QSqlDatabase>

class QListWidget;
class QLineEdit;
class QPlainTextEdit;
class QPushButton;

namespace ui {

/**
 * Lets the user create, rename and delete categories and manage the custom
 * fields of the selected category. All changes are written to the database
 * immediately.
 */
class CategoryManagerDialog : public QDialog {
    Q_OBJECT
public:
    explicit CategoryManagerDialog(QSqlDatabase database, QWidget *parent = nullptr);

private slots:
    void onCategorySelectionChanged();
    void onAddCategory();
    void onDeleteCategory();
    void onSaveCategoryMeta();

    void onAddField();
    void onEditField();
    void onDeleteField();
    void onMoveFieldUp();
    void onMoveFieldDown();

private:
    void reloadCategories(int selectId = -1);
    void reloadFields();
    int currentCategoryId() const;
    int currentFieldId() const;
    void moveField(int direction);

    QSqlDatabase m_db;
    repository::CategoryRepository m_categories;
    repository::FieldRepository m_fields;

    QListWidget *m_categoryList = nullptr;
    QLineEdit *m_nameEdit = nullptr;
    QPlainTextEdit *m_descEdit = nullptr;
    QPushButton *m_saveMetaButton = nullptr;

    QListWidget *m_fieldList = nullptr;
    QPushButton *m_addFieldButton = nullptr;
    QPushButton *m_editFieldButton = nullptr;
    QPushButton *m_deleteFieldButton = nullptr;
    QPushButton *m_moveUpButton = nullptr;
    QPushButton *m_moveDownButton = nullptr;
    QPushButton *m_deleteCategoryButton = nullptr;
};

} // namespace ui
