#include "db/Database.h"
#include "ui/MainWindow.h"

#include <QApplication>
#include <QMessageBox>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    QApplication::setApplicationName(QStringLiteral("ArchiveTool"));
    QApplication::setOrganizationName(QStringLiteral("ArchiveTool"));
    QApplication::setApplicationVersion(QStringLiteral(ARCHIVETOOL_VERSION));
    QApplication::setWindowIcon(QIcon(QStringLiteral(":/icons/app.svg")));

    db::Database database;
    QString error;
    if (!database.open(db::Database::defaultDataDirectory(), &error)) {
        QMessageBox::critical(nullptr, QObject::tr("Archiv-Tool"),
                              QObject::tr("Das Archiv konnte nicht geöffnet werden:\n\n%1").arg(error));
        return 1;
    }

    ui::MainWindow window(&database);
    window.show();

    return app.exec();
}
