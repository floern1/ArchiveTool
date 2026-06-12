#pragma once

#include "model/Models.h"

#include <QMainWindow>
#include <QVector>

class QListWidget;
class QComboBox;
class QLineEdit;
class QTableView;
class QLabel;
class QAction;

namespace db {
class Database;
}

namespace ui {

class ItemTableModel;

/**
 * The application's main window: a category list and label filter on the left,
 * a search box on top and a table of the selected category's items in the
 * centre. Items, categories and labels are all managed from here.
 */
class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(db::Database *database, QWidget *parent = nullptr);

private slots:
    void onCategoryChanged();
    void onSearchChanged();
    void onLabelFilterChanged();

    void onNewItem();
    void onEditItem();
    void onDeleteItem();

    void onManageCategories();
    void onManageLabels();

    void onExportCsv();
    void onOpenDataFolder();
    void onAbout();

private:
    void buildUi();
    void buildMenu();
    void reloadCategories(int selectId = -1);
    void reloadLabelFilter();
    void reloadItems();
    void maybeSeedStarterData();

    int currentCategoryId() const;
    QVector<model::FieldDefinition> currentFields() const;

    db::Database *m_database = nullptr;

    QListWidget *m_categoryList = nullptr;
    QComboBox *m_labelFilter = nullptr;
    QLineEdit *m_search = nullptr;
    QTableView *m_table = nullptr;
    ItemTableModel *m_model = nullptr;
    QLabel *m_statusInfo = nullptr;

    QAction *m_newItemAction = nullptr;
    QAction *m_editItemAction = nullptr;
    QAction *m_deleteItemAction = nullptr;
    QAction *m_exportAction = nullptr;
};

} // namespace ui
