#pragma once

#include "repository/LabelRepository.h"

#include <QDialog>
#include <QSqlDatabase>

class QListWidget;

namespace ui {

/// Create, rename, recolour and delete the free-form labels used across items.
class LabelManagerDialog : public QDialog {
    Q_OBJECT
public:
    explicit LabelManagerDialog(QSqlDatabase database, QWidget *parent = nullptr);

private slots:
    void onAdd();
    void onEdit();
    void onDelete();

private:
    void reload(int selectId = -1);
    int currentLabelId() const;

    QSqlDatabase m_db;
    repository::LabelRepository m_labels;
    QListWidget *m_list = nullptr;
};

} // namespace ui
