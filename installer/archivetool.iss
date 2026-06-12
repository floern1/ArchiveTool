; Inno Setup script for ArchiveTool.
;
; This produces a self-contained Windows installer: every dependency (the Qt
; runtime DLLs and the SQLite database driver) is collected by windeployqt into
; the "dist" staging directory during the build and bundled here, so the target
; machine needs no separate Qt or runtime installation.
;
; The application version and the staging directory are passed in from the
; build (see .github/workflows/build-windows.yml):
;   iscc /DAppVersion=1.0.0 /DSourceDir=..\dist installer\archivetool.iss

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist"
#endif

[Setup]
AppId={{B2A6F4C1-7E3D-4F92-9C2A-1A3D5E7B9C10}
AppName=Archiv-Tool
AppVersion={#AppVersion}
AppPublisher=Geschichtsverein
DefaultDirName={autopf}\ArchiveTool
DefaultGroupName=Archiv-Tool
DisableProgramGroupPage=yes
OutputBaseFilename=ArchiveTool-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Allow installation without administrator rights when possible.
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Bundle everything produced by windeployqt (the executable plus all runtime
; dependencies).
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Archiv-Tool"; Filename: "{app}\ArchiveTool.exe"
Name: "{group}\{cm:UninstallProgram,Archiv-Tool}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Archiv-Tool"; Filename: "{app}\ArchiveTool.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\ArchiveTool.exe"; Description: "{cm:LaunchProgram,Archiv-Tool}"; Flags: nowait postinstall skipifsilent
