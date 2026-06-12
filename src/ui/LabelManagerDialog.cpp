#include "ui/LabelManagerDialog.h"

#include <QColorDialog>
#include <QDialogButtonBox>
#include <QFormLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QMessageBox>
#include <QPixmap>
#include <QPushButton>
#include <QVBoxLayout>

namespace ui {

namespace {

// Small modal editor for a label's name and colour. Returns true if accepted.
bool editLabel(QWidget *parent, QString *name, QString *color)
{
    QDialog dialog(parent);
    dialog.setWindowTitle(QObject::tr("Label"));
    auto *layout = new QVBoxLayout(&dialog);
    auto *form = new QFormLayout;

    auto *nameEdit = new QLineEdit(*name, &dialog);
    form->addRow(QObject::tr("Name:"), nameEdit);

    QString chosen = color->isEmpty() ? QStringLiteral("#4a90d9") : *color;
    auto *colorButton = new QPushButton(&dialog);
    auto applySwatch = [colorButton](const QString &c) {
        QPixmap pm(16, 16);
        pm.fill(QColor(c));
        colorButton->setIcon(QIcon(pm));
        colorButton->setText(c);
    };
    applySwatch(chosen);
    form->addRow(QObject::tr("Farbe:"), colorButton);
    layout->addLayout(form);

    QObject::connect(colorButton, &QPushButton::clicked, &dialog, [&]() {
        const QColor c = QColorDialog::getColor(QColor(chosen), &dialog,
                                                QObject::tr("Farbe wählen"));
        if (c.isValid()) {
            chosen = c.name();
            applySwatch(chosen);
        }
    });

    auto *buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, &dialog);
    QObject::connect(buttons, &QDialogButtonBox::accepted, &dialog, &QDialog::accept);
    QObject::connect(buttons, &QDialogButtonBox::rejected, &dialog, &QDialog::reject);
    layout->addWidget(buttons);

    if (dialog.exec() != QDialog::Accepted)
        return false;
    if (nameEdit->text().trimmed().isEmpty()) {
        QMessageBox::warning(parent, QObject::tr("Eingabe unvollständig"),
                             QObject::tr("Bitte einen Namen angeben."));
        return false;
    }
    *name = nameEdit->text().trimmed();
    *color = chosen;
    return true;
}

} // namespace

LabelManagerDialog::LabelManagerDialog(QSqlDatabase database, QWidget *parent)
    : QDialog(parent)
    , m_db(database)
    , m_labels(database)
{
    setWindowTitle(tr("Labels verwalten"));
    resize(360, 420);

    auto *layout = new QVBoxLayout(this);
    layout->addWidget(new QLabel(tr("Labels:"), this));

    m_list = new QListWidget(this);
    layout->addWidget(m_list, 1);

    auto *buttonRow = new QHBoxLayout;
    auto *addButton = new QPushButton(tr("Neu …"), this);
    auto *editButton = new QPushButton(tr("Bearbeiten …"), this);
    auto *deleteButton = new QPushButton(tr("Löschen"), this);
    buttonRow->addWidget(addButton);
    buttonRow->addWidget(editButton);
    buttonRow->addWidget(deleteButton);
    layout->addLayout(buttonRow);

    auto *closeButtons = new QDialogButtonBox(QDialogButtonBox::Close, this);
    connect(closeButtons, &QDialogButtonBox::rejected, this, &QDialog::accept);
    connect(closeButtons, &QDialogButtonBox::accepted, this, &QDialog::accept);
    layout->addWidget(closeButtons);

    connect(addButton, &QPushButton::clicked, this, &LabelManagerDialog::onAdd);
    connect(editButton, &QPushButton::clicked, this, &LabelManagerDialog::onEdit);
    connect(m_list, &QListWidget::itemDoubleClicked, this, &LabelManagerDialog::onEdit);
    connect(deleteButton, &QPushButton::clicked, this, &LabelManagerDialog::onDelete);

    reload();
}

int LabelManagerDialog::currentLabelId() const
{
    QListWidgetItem *item = m_list->currentItem();
    return item ? item->data(Qt::UserRole).toInt() : -1;
}

void LabelManagerDialog::reload(int selectId)
{
    m_list->clear();
    int rowToSelect = -1;
    const auto labels = m_labels.list();
    for (int i = 0; i < labels.size(); ++i) {
        const model::Label &l = labels[i];
        auto *item = new QListWidgetItem(l.name, m_list);
        item->setData(Qt::UserRole, l.id);
        QPixmap pm(14, 14);
        pm.fill(QColor(l.color));
        item->setIcon(QIcon(pm));
        if (l.id == selectId)
            rowToSelect = i;
    }
    if (rowToSelect >= 0)
        m_list->setCurrentRow(rowToSelect);
}

void LabelManagerDialog::onAdd()
{
    QString name;
    QString color = QStringLiteral("#4a90d9");
    if (!editLabel(this, &name, &color))
        return;
    model::Label label;
    label.name = name;
    label.color = color;
    if (!m_labels.insert(label)) {
        QMessageBox::warning(this, tr("Fehler"), m_labels.lastError());
        return;
    }
    reload(label.id);
}

void LabelManagerDialog::onEdit()
{
    const int id = currentLabelId();
    if (id <= 0)
        return;
    auto existing = m_labels.get(id);
    if (!existing)
        return;
    QString name = existing->name;
    QString color = existing->color;
    if (!editLabel(this, &name, &color))
        return;
    existing->name = name;
    existing->color = color;
    if (!m_labels.update(*existing)) {
        QMessageBox::warning(this, tr("Fehler"), m_labels.lastError());
        return;
    }
    reload(id);
}

void LabelManagerDialog::onDelete()
{
    const int id = currentLabelId();
    if (id <= 0)
        return;
    const int count = m_labels.itemCount(id);
    QString message = tr("Label wirklich löschen?");
    if (count > 0)
        message += QLatin1Char('\n')
                   + tr("Es ist derzeit %n Objekt(en) zugeordnet.", nullptr, count);
    if (QMessageBox::question(this, tr("Label löschen"), message) != QMessageBox::Yes)
        return;
    if (!m_labels.remove(id)) {
        QMessageBox::warning(this, tr("Fehler"), m_labels.lastError());
        return;
    }
    reload();
}

} // namespace ui
