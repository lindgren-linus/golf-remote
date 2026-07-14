#ifndef MyAppVersion
  #define MyAppVersion "0.1.0"
#endif

#define MyAppName "Golf Remote Agent"
#define MyAppPublisher "Golf Remote"
#define MyAppExeName "GolfRemote.Agent.exe"
#define PublishDir "..\artifacts\publish"

[Setup]
AppId={{E2A4E9DF-3E80-4D10-9A0D-C760FE95A1A1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Golf Remote
DefaultGroupName=Golf Remote
DisableProgramGroupPage=yes
OutputDir=..\artifacts\installer
OutputBaseFilename=GolfRemote-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayName=Golf Remote Agent

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Golf Remote"; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Golf Remote (WebSocket)"" dir=in action=allow protocol=TCP localport=56789 profile=private"; Flags: runhidden waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""Golf Remote (mDNS)"" dir=in action=allow protocol=UDP localport=5353 profile=private"; Flags: runhidden waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Parameters: "--configure-autostart"; Flags: runasoriginaluser waituntilterminated
Filename: "{app}\{#MyAppExeName}"; Description: "Starta Golf Remote"; Flags: runasoriginaluser nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--disable-autostart"; Flags: waituntilterminated; RunOnceId: "GolfRemoteDisableAutostart"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Golf Remote (WebSocket)"""; Flags: runhidden waituntilterminated; RunOnceId: "GolfRemoteRemoveWebSocketFirewall"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Golf Remote (mDNS)"""; Flags: runhidden waituntilterminated; RunOnceId: "GolfRemoteRemoveMdnsFirewall"
