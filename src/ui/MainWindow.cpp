#include "ui/MainWindow.h"

#include "db/Database.h"
#include "repository/CategoryRepository.h"
#include "repository/FieldRepository.h"
#include "repository/ItemRepository.h"
#include "repository/LabelRepository.h"
#include "ui/CategoryManagerDialog.h"
#include "ui/ItemEditorDialog.h"
#include "ui/ItemTableModel.h"
#include "ui/LabelManagerDialog.h"

#include <QAction>
#include <QComboBox>
#include <QDesktopServices>
#include <QFile>
#include <QFileDialog>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QKeySequence>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMenuBar>
#include <QMessageBox>
#include <QSplitter>
#include <QStatusBar>
#include <QTableView>
#include <QTextStream>
#include <QToolBar>
#include <QUrl>
#include <QVBoxLayout>

namespace ui {

MainWindow::MainWindow(db::Database *database, QWidget *parent)
    : QMainWindow(parent)
    , m_database(database)
{
    setWindowTitle(tr("Archiv-Tool – Geschichtsverein"));
    resize(1024, 680);

    buildUi();
    buildMenu();

    reloadLabelFilter();
    reloadCategories();
    maybeSeedStarterData();
}

void MainWindow::buildUi()
{
    auto *central = new QWidget(this);
    auto *layout = new QHBoxLayout(central);

    auto *splitter = new QSplitter(Qt::Horizontal, central);

    // ---- Left sidebar ------------------------------------------------------
    auto *sidebar = new QWidget(splitter);
    auto *sideLayout = new QVBoxLayout(sidebar);
    sideLayout->setContentsMargins(0, 0, 0, 0);

    sideLayout->addWidget(new QLabel(tr("Kategorien"), sidebar));
    m_categoryList = new QListWidget(sidebar);
    sideLayout->addWidget(m_categoryList, 1);

    sideLayout->addWidget(new QLabel(tr("Label-Filter:"), sidebar));
    m_labelFilter = new QComboBox(sidebar);
    sideLayout->addWidget(m_labelFilter);

    splitter->addWidget(sidebar);

    // ---- Main area ---------------------------------------------------------
    auto *mainArea = new QWidget(splitter);
    auto *mainLayout = new QVBoxLayout(mainArea);
    mainLayout->setContentsMargins(0, 0, 0, 0);

    auto *searchRow = new QHBoxLayout;
    searchRow->addWidget(new QLabel(tr("Suche:"), mainArea));
    m_search = new QLineEdit(mainArea);
    m_search->setPlaceholderText(tr("Titel, Inventarnummer, Standort, Feldinhalte …"));
    m_search->setClearButtonEnabled(true);
    searchRow->addWidget(m_search, 1);
    mainLayout->addLayout(searchRow);

    m_table = new QTableView(mainArea);
    m_model = new ItemTableModel(this);
    m_table->setModel(m_model);
    m_table->setSelectionBehavior(QAbstractItemView::SelectRows);
    m_table->setSelectionMode(QAbstractItemView::SingleSelection);
    m_table->setEditTriggers(QAbstractItemView::NoEditTriggers);
    m_table->setAlternatingRowColors(true);
    m_table->setSortingEnabled(false);
    m_table->horizontalHeader()->setStretchLastSection(true);
    m_table->verticalHeader()->setVisible(false);
    mainLayout->addWidget(m_table, 1);

    splitter->addWidget(mainArea);
    splitter->setStretchFactor(0, 0);
    splitter->setStretchFactor(1, 1);
    splitter->setSizes({240, 780});

    layout->addWidget(splitter);
    setCentralWidget(central);

    m_statusInfo = new QLabel(this);
    statusBar()->addWidget(m_statusInfo);

    connect(m_categoryList, &QListWidget::currentRowChanged, this, &MainWindow::onCategoryChanged);
    connect(m_search, &QLineEdit::textChanged, this, &MainWindow::onSearchChanged);
    connect(m_labelFilter, &QComboBox::currentIndexChanged, this, &MainWindow::onLabelFilterChanged);
    connect(m_table, &QTableView::doubleClicked, this, &MainWindow::onEditItem);
}

void MainWindow::buildMenu()
{
    auto *fileMenu = menuBar()->addMenu(tr("&Datei"));
    m_exportAction = fileMenu->addAction(tr("Aktuelle Liste als &CSV exportieren …"),
                                         this, &MainWindow::onExportCsv);
    fileMenu->addAction(tr("Daten&verzeichnis öffnen"), this, &MainWindow::onOpenDataFolder);
    fileMenu->addSeparator();
    fileMenu->addAction(tr("&Beenden"), this, &QWidget::close);

    auto *itemMenu = menuBar()->addMenu(tr("&Objekt"));
    m_newItemAction = itemMenu->addAction(tr("&Neues Objekt …"), this, &MainWindow::onNewItem);
    m_newItemAction->setShortcut(QKeySequence::New);
    m_editItemAction = itemMenu->addAction(tr("&Bearbeiten …"), this, &MainWindow::onEditItem);
    m_deleteItemAction = itemMenu->addAction(tr("&Löschen"), this, &MainWindow::onDeleteItem);
    m_deleteItemAction->setShortcut(QKeySequence::Delete);

    auto *manageMenu = menuBar()->addMenu(tr("&Verwaltung"));
    manageMenu->addAction(tr("&Kategorien & Felder …"), this, &MainWindow::onManageCategories);
    manageMenu->addAction(tr("&Labels …"), this, &MainWindow::onManageLabels);

    auto *helpMenu = menuBar()->addMenu(tr("&Hilfe"));
    helpMenu->addAction(tr("&Über …"), this, &MainWindow::onAbout);

    // Toolbar mirrors the most common item actions.
    auto *toolbar = addToolBar(tr("Aktionen"));
    toolbar->setMovable(false);
    toolbar->addAction(m_newItemAction);
    toolbar->addAction(m_editItemAction);
    toolbar->addAction(m_deleteItemAction);
}

int MainWindow::currentCategoryId() const
{
    QListWidgetItem *item = m_categoryList->currentItem();
    return item ? item->data(Qt::UserRole).toInt() : -1;
}

QVector<model::FieldDefinition> MainWindow::currentFields() const
{
    const int id = currentCategoryId();
    if (id <= 0)
        return {};
    repository::FieldRepository fields(m_database->connection());
    return fields.listForCategory(id);
}

void MainWindow::reloadCategories(int selectId)
{
    m_categoryList->blockSignals(true);
    m_categoryList->clear();
    int rowToSelect = -1;
    repository::CategoryRepository categories(m_database->connection());
    const auto list = categories.list();
    for (int i = 0; i < list.size(); ++i) {
        auto *item = new QListWidgetItem(list[i].name, m_categoryList);
        item->setData(Qt::UserRole, list[i].id);
        if (list[i].id == selectId)
            rowToSelect = i;
    }
    m_categoryList->blockSignals(false);

    if (rowToSelect < 0 && m_categoryList->count() > 0)
        rowToSelect = 0;
    m_categoryList->setCurrentRow(rowToSelect);
    onCategoryChanged();
}

void MainWindow::reloadLabelFilter()
{
    const int previous = m_labelFilter->currentData().toInt();
    m_labelFilter->blockSignals(true);
    m_labelFilter->clear();
    m_labelFilter->addItem(tr("(alle anzeigen)"), -1);
    repository::LabelRepository labels(m_database->connection());
    for (const model::Label &l : labels.list())
        m_labelFilter->addItem(l.name, l.id);
    const int index = m_labelFilter->findData(previous);
    m_labelFilter->setCurrentIndex(index >= 0 ? index : 0);
    m_labelFilter->blockSignals(false);
}

void MainWindow::reloadItems()
{
    const int categoryId = currentCategoryId();
    const bool hasCategory = (categoryId > 0);

    m_newItemAction->setEnabled(hasCategory);
    m_editItemAction->setEnabled(hasCategory);
    m_deleteItemAction->setEnabled(hasCategory);
    m_exportAction->setEnabled(hasCategory);

    if (!hasCategory) {
        m_model->setData({}, {}, {});
        m_statusInfo->setText(tr("Keine Kategorie ausgewählt. Legen Sie über "
                                 "„Verwaltung → Kategorien & Felder“ eine an."));
        return;
    }

    const QVector<model::FieldDefinition> fields = currentFields();
    const int labelFilter = m_labelFilter->currentData().toInt();

    repository::ItemRepository items(m_database->connection());
    const QVector<model::Item> list =
        items.listForCategory(categoryId, m_search->text(), labelFilter);

    // Build the label text for each visible item.
    repository::LabelRepository labels(m_database->connection());
    QHash<int, QString> labelText;
    for (const model::Item &item : list) {
        QStringList names;
        for (const model::Label &l : labels.labelsForItem(item.id))
            names << l.name;
        if (!names.isEmpty())
            labelText.insert(item.id, names.join(QStringLiteral(", ")));
    }

    m_model->setData(list, fields, labelText);
    m_table->resizeColumnsToContents();
    m_table->horizontalHeader()->setStretchLastSection(true);

    m_statusInfo->setText(tr("%n Objekt(e)", nullptr, list.size()));
}

void MainWindow::onCategoryChanged()
{
    reloadItems();
}

void MainWindow::onSearchChanged()
{
    reloadItems();
}

void MainWindow::onLabelFilterChanged()
{
    reloadItems();
}

void MainWindow::onNewItem()
{
    const int categoryId = currentCategoryId();
    if (categoryId <= 0)
        return;
    repository::CategoryRepository categories(m_database->connection());
    auto category = categories.get(categoryId);
    if (!category)
        return;

    ItemEditorDialog dialog(m_database->connection(), m_database->attachmentsDirectory(),
                            *category, currentFields(), this);
    if (dialog.exec() == QDialog::Accepted)
        reloadItems();
}

void MainWindow::onEditItem()
{
    const int categoryId = currentCategoryId();
    if (categoryId <= 0)
        return;
    const QModelIndex index = m_table->currentIndex();
    if (!index.isValid())
        return;
    const model::Item selected = m_model->itemAt(index.row());
    if (selected.id <= 0)
        return;

    repository::CategoryRepository categories(m_database->connection());
    auto category = categories.get(categoryId);
    if (!category)
        return;
    repository::ItemRepository items(m_database->connection());
    auto full = items.get(selected.id);
    if (!full)
        return;

    ItemEditorDialog dialog(m_database->connection(), m_database->attachmentsDirectory(),
                            *category, currentFields(), this);
    dialog.setItem(*full);
    if (dialog.exec() == QDialog::Accepted)
        reloadItems();
}

void MainWindow::onDeleteItem()
{
    const QModelIndex index = m_table->currentIndex();
    if (!index.isValid())
        return;
    const model::Item selected = m_model->itemAt(index.row());
    if (selected.id <= 0)
        return;

    if (QMessageBox::question(this, tr("Objekt löschen"),
                              tr("Objekt „%1“ wirklich löschen?").arg(selected.title))
        != QMessageBox::Yes)
        return;

    repository::ItemRepository items(m_database->connection());
    if (!items.remove(selected.id)) {
        QMessageBox::warning(this, tr("Fehler"), items.lastError());
        return;
    }
    reloadItems();
}

void MainWindow::onManageCategories()
{
    CategoryManagerDialog dialog(m_database->connection(), this);
    dialog.exec();
    const int keep = currentCategoryId();
    reloadCategories(keep);
}

void MainWindow::onManageLabels()
{
    LabelManagerDialog dialog(m_database->connection(), this);
    dialog.exec();
    reloadLabelFilter();
    reloadItems();
}

void MainWindow::onExportCsv()
{
    const int categoryId = currentCategoryId();
    if (categoryId <= 0)
        return;

    const QString path = QFileDialog::getSaveFileName(
        this, tr("Als CSV exportieren"), QStringLiteral("archiv.csv"),
        tr("CSV-Dateien (*.csv)"));
    if (path.isEmpty())
        return;

    QFile file(path);
    if (!file.open(QIODevice::WriteOnly | QIODevice::Text)) {
        QMessageBox::warning(this, tr("Fehler"),
                             tr("Datei konnte nicht geschrieben werden."));
        return;
    }

    const QVector<model::FieldDefinition> fields = currentFields();
    repository::ItemRepository itemRepo(m_database->connection());
    const QVector<model::Item> items =
        itemRepo.listForCategory(categoryId, m_search->text(),
                                 m_labelFilter->currentData().toInt());
    repository::LabelRepository labelRepo(m_database->connection());

    auto csvCell = [](QString value) {
        value.replace(QLatin1Char('"'), QStringLiteral("\"\""));
        return QStringLiteral("\"%1\"").arg(value);
    };

    QTextStream out(&file);
    out.setEncoding(QStringConverter::Utf8);
    // UTF-8 BOM so Excel opens umlauts correctly.
    out << QChar(0xFEFF);

    QStringList header = {tr("Titel"), tr("Inventar-/Signaturnr."), tr("Standort")};
    for (const model::FieldDefinition &f : fields)
        header << f.name;
    header << tr("Labels") << tr("Notizen");
    out << header.join(QLatin1Char(';')) << '\n';

    for (const model::Item &item : items) {
        QStringList row = {csvCell(item.title), csvCell(item.inventoryNo),
                           csvCell(item.location)};
        for (const model::FieldDefinition &f : fields)
            row << csvCell(item.fieldValues.value(f.id));
        QStringList names;
        for (const model::Label &l : labelRepo.labelsForItem(item.id))
            names << l.name;
        row << csvCell(names.join(QStringLiteral(", ")));
        row << csvCell(item.notes);
        out << row.join(QLatin1Char(';')) << '\n';
    }

    QMessageBox::information(this, tr("Export"),
                             tr("%n Objekt(e) wurden exportiert.", nullptr, items.size()));
}

void MainWindow::onOpenDataFolder()
{
    QDesktopServices::openUrl(QUrl::fromLocalFile(db::Database::defaultDataDirectory()));
}

void MainWindow::onAbout()
{
    QMessageBox::about(
        this, tr("Über Archiv-Tool"),
        tr("<h3>Archiv-Tool %1</h3>"
           "<p>Eine flexible Archivverwaltung für Geschichtsvereine und kleine "
           "Sammlungen.</p>"
           "<p>Kategorien, eigene Felder und Labels lassen sich frei anlegen. "
           "Alle Daten liegen in einer lokalen SQLite-Datenbank im "
           "Datenverzeichnis.</p>")
            .arg(QStringLiteral(ARCHIVETOOL_VERSION)));
}

void MainWindow::maybeSeedStarterData()
{
    repository::CategoryRepository categories(m_database->connection());
    if (!categories.list().isEmpty())
        return;

    if (QMessageBox::question(
            this, tr("Willkommen"),
            tr("Die Datenbank ist noch leer.\n\n"
               "Sollen einige Beispiel-Kategorien (Bücher, Bilder, Filme, "
               "Dokumente) mit passenden Feldern angelegt werden? "
               "Sie können diese später beliebig anpassen."))
        != QMessageBox::Yes)
        return;

    repository::FieldRepository fieldRepo(m_database->connection());

    auto addField = [&](int categoryId, const QString &name, model::FieldType type,
                        int position, const QStringList &options = {}) {
        model::FieldDefinition f;
        f.categoryId = categoryId;
        f.name = name;
        f.type = type;
        f.position = position;
        f.options = options;
        fieldRepo.insert(f);
    };

    auto addCategory = [&](const QString &name, const QString &description) {
        model::Category c;
        c.name = name;
        c.description = description;
        c.position = 0;
        categories.insert(c);
        return c.id;
    };

    const int books = addCategory(tr("Bücher"), tr("Bücher und Schriften"));
    addField(books, tr("Autor"), model::FieldType::Text, 0);
    addField(books, tr("Erscheinungsjahr"), model::FieldType::Integer, 1);
    addField(books, tr("Verlag"), model::FieldType::Text, 2);
    addField(books, tr("ISBN"), model::FieldType::Text, 3);
    addField(books, tr("Zustand"), model::FieldType::Choice, 4,
             {tr("sehr gut"), tr("gut"), tr("mittel"), tr("schlecht")});

    const int pictures = addCategory(tr("Bilder"), tr("Fotos, Gemälde, Grafiken"));
    addField(pictures, tr("Aufnahmedatum"), model::FieldType::Date, 0);
    addField(pictures, tr("Fotograf/Urheber"), model::FieldType::Text, 1);
    addField(pictures, tr("Motiv"), model::FieldType::Text, 2);
    addField(pictures, tr("Technik"), model::FieldType::Choice, 3,
             {tr("Schwarzweiß-Foto"), tr("Farbfoto"), tr("Gemälde"), tr("Zeichnung"), tr("Druck")});

    const int films = addCategory(tr("Filme"), tr("Filme und Tonaufnahmen"));
    addField(films, tr("Datum"), model::FieldType::Date, 0);
    addField(films, tr("Dauer (Minuten)"), model::FieldType::Integer, 1);
    addField(films, tr("Format"), model::FieldType::Choice, 2,
             {tr("VHS"), tr("Super 8"), tr("16 mm"), tr("DVD"), tr("Digital")});

    const int docs = addCategory(tr("Dokumente"), tr("Urkunden, Briefe, Akten"));
    addField(docs, tr("Datum"), model::FieldType::Date, 0);
    addField(docs, tr("Verfasser"), model::FieldType::Text, 1);
    addField(docs, tr("Art"), model::FieldType::Choice, 2,
             {tr("Urkunde"), tr("Brief"), tr("Akte"), tr("Karte"), tr("Zeitung")});

    reloadCategories(books);
}

} // namespace ui
