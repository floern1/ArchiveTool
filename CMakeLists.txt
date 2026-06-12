cmake_minimum_required(VERSION 3.21)

project(ArchiveTool
    VERSION 1.0.0
    DESCRIPTION "Flexible archive manager for local history associations"
    LANGUAGES CXX)

# ---------------------------------------------------------------------------
# Global build settings
# ---------------------------------------------------------------------------
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Qt tooling: run moc/uic/rcc automatically.
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTORCC ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

# A version string the application can display.
add_compile_definitions(ARCHIVETOOL_VERSION="${PROJECT_VERSION}")

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
# The SQLite backend ships with Qt's QtSql module (the QSQLITE driver), so no
# external database library is required.
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets Sql)

qt_standard_project_setup()

# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------
set(ARCHIVETOOL_SOURCES
    src/main.cpp

    src/db/Database.cpp
    src/db/Database.h
    src/db/Schema.cpp
    src/db/Schema.h

    src/model/Models.h

    src/repository/CategoryRepository.cpp
    src/repository/CategoryRepository.h
    src/repository/FieldRepository.cpp
    src/repository/FieldRepository.h
    src/repository/ItemRepository.cpp
    src/repository/ItemRepository.h
    src/repository/LabelRepository.cpp
    src/repository/LabelRepository.h
    src/repository/AttachmentRepository.cpp
    src/repository/AttachmentRepository.h

    src/ui/MainWindow.cpp
    src/ui/MainWindow.h
    src/ui/ItemTableModel.cpp
    src/ui/ItemTableModel.h
    src/ui/ItemEditorDialog.cpp
    src/ui/ItemEditorDialog.h
    src/ui/CategoryManagerDialog.cpp
    src/ui/CategoryManagerDialog.h
    src/ui/FieldEditorDialog.cpp
    src/ui/FieldEditorDialog.h
    src/ui/LabelManagerDialog.cpp
    src/ui/LabelManagerDialog.h
)

qt_add_executable(ArchiveTool WIN32 ${ARCHIVETOOL_SOURCES}
    resources/resources.qrc
)

target_include_directories(ArchiveTool PRIVATE src)

target_link_libraries(ArchiveTool PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Widgets
    Qt6::Sql
)

set_target_properties(ArchiveTool PROPERTIES
    OUTPUT_NAME "ArchiveTool"
)

# ---------------------------------------------------------------------------
# Installation
# ---------------------------------------------------------------------------
install(TARGETS ArchiveTool
    RUNTIME DESTINATION .
    BUNDLE DESTINATION .
)
