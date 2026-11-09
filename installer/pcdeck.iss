; Installeur PC Deck (Inno Setup 6). Construit par installer\build.ps1 :
;   ISCC /DAppVersion=0.2.0 /DStageDir=dist\stage /DOutDir=dist installer\pcdeck.iss
; Il faut les droits administrateur : pare-feu, tache planifiee (LibreHardwareMonitor), pilote PawnIO.

[Setup]
AppId={{B6E1D0A4-5C2F-4F7E-9A38-2D61C0E5F7A9}
AppName=PC Deck
AppVersion={#AppVersion}
AppPublisher=PC Deck
DefaultDirName={autopf}\PC Deck
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutDir}
OutputBaseFilename=PCDeck-Setup-{#AppVersion}
SetupIconFile=pcdeck.ico
UninstallDisplayIcon={app}\pcdeck.ico
UninstallDisplayName=PC Deck
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer une icône sur le Bureau"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "pcdeck.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\PC Deck"; Filename: "{app}\PC Deck.exe"; WorkingDir: "{app}"; IconFilename: "{app}\pcdeck.ico"; Check: HasTrayExe
Name: "{autodesktop}\PC Deck"; Filename: "{app}\PC Deck.exe"; WorkingDir: "{app}"; IconFilename: "{app}\pcdeck.ico"; Tasks: desktopicon; Check: HasTrayExe
Name: "{autoprograms}\PC Deck"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\tools\launch-hidden.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\pcdeck.ico"; Check: not HasTrayExe
Name: "{autodesktop}\PC Deck"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\tools\launch-hidden.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\pcdeck.ico"; Tasks: desktopicon; Check: not HasTrayExe

[Run]
; Droit de lire le trafic réseau par application (effectif après la prochaine ouverture de session Windows)
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Add-LocalGroupMember -SID S-1-5-32-559 -Member '{username}' -ErrorAction SilentlyContinue"""; Flags: runhidden; StatusMsg: "Droits de mesure du réseau..."
; Pare-feu : seulement le réseau de la maison (profil Privé / domaine), le sous-réseau local et Tailscale
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""PC Deck Server"""; Flags: runhidden; StatusMsg: "Règle du pare-feu..."
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""PC Deck Server"" dir=in action=allow program=""{app}\runtime\node.exe"" enable=yes profile=private,domain remoteip=localsubnet,100.64.0.0/10"; Flags: runhidden
; Le serveur web de LibreHardwareMonitor (port 8085) ne sert qu'à PC Deck, sur ce PC : on le ferme au réseau
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""PC Deck Capteurs (ce PC seulement)"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""PC Deck Capteurs (ce PC seulement)"" dir=in action=block protocol=TCP localport=8085 enable=yes profile=any"; Flags: runhidden
; Pilote de lecture des capteurs (signé), seulement s'il n'est pas déjà là
Filename: "{app}\pawnio\PawnIO_setup.exe"; Parameters: "-install -silent"; Check: NeedPawnIO; Flags: waituntilterminated runhidden; StatusMsg: "Pilote des capteurs (PawnIO)..."
; LibreHardwareMonitor : lancé à chaque ouverture de session avec les droits nécessaires, sans demande
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\register-lhm-task.ps1"" -App ""{app}"" -User ""{username}"""; Flags: runhidden; StatusMsg: "Capteurs de température..."
; Lancement de PC Deck (avec les droits de l'utilisateur, pas ceux de l'installeur)
Filename: "{app}\PC Deck.exe"; WorkingDir: "{app}"; Description: "Lancer PC Deck maintenant"; Flags: nowait postinstall skipifsilent runasoriginaluser; Check: HasTrayExe
Filename: "{app}\PC Deck.exe"; WorkingDir: "{app}"; Flags: nowait runasoriginaluser; Check: WizardSilent and HasTrayExe
Filename: "{sys}\wscript.exe"; Parameters: """{app}\tools\launch-hidden.vbs"""; WorkingDir: "{app}"; Description: "Lancer PC Deck maintenant"; Flags: nowait postinstall skipifsilent runasoriginaluser; Check: not HasTrayExe
Filename: "{sys}\wscript.exe"; Parameters: """{app}\tools\launch-hidden.vbs"""; WorkingDir: "{app}"; Flags: nowait runasoriginaluser; Check: WizardSilent and not HasTrayExe

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""PC Deck Server"""; Flags: runhidden; RunOnceId: "PcDeckFirewall"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""PC Deck Capteurs (ce PC seulement)"""; Flags: runhidden; RunOnceId: "PcDeckFirewallSensors"
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Unregister-ScheduledTask -TaskName 'PC Deck - LibreHardwareMonitor' -Confirm:$false -ErrorAction SilentlyContinue"""; Flags: runhidden; RunOnceId: "PcDeckTask"

[Code]
// PC Deck.exe n'est fourni que dans une version signée (sinon Windows 11 peut le bloquer)
function HasTrayExe: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\PC Deck.exe'));
end;

function NeedPawnIO: Boolean;
begin
  Result := not RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\PawnIO');
end;

// Ferme le serveur, l'icône et LibreHardwareMonitor de CETTE installation (pas ceux d'un autre dossier).
// Liste de noms précise : le désinstalleur et l'installeur ont aussi le dossier dans leur ligne de commande, il ne faut pas les fermer.
procedure StopPcDeck;
var
  Code: Integer;
  Script: string;
begin
  Script := '$a = ''' + ExpandConstant('{app}') + '''; ' +
    'Get-CimInstance Win32_Process | Where-Object { @(''node.exe'',''powershell.exe'',''wscript.exe'',''LibreHardwareMonitor.exe'',''PC Deck.exe'',''pcdeck-keys.exe'',''pcdeck-screen.exe'',''pcdeck-netmon.exe'',''pcdeck-procmon.exe'') -contains $_.Name -and $_.CommandLine -and $_.CommandLine.Contains($a) -and $_.ProcessId -ne $PID } | ' +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ' +
    'Get-Process LibreHardwareMonitor -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ($a + ''\*'') } | Stop-Process -Force -ErrorAction SilentlyContinue';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -Command "' + Script + '"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(800);
end;

// Réseau de type « Public » : Windows y bloque PC Deck, la tablette ne peut pas se connecter.
// On le signale et on propose de le passer en « Privé » (seulement si l'utilisateur dit oui).
procedure CurStepChanged(CurStep: TSetupStep);
var
  Code, I: Integer;
  PS, Tmp, List, Quoted, Name: string;
  Names: TArrayOfString;
begin
  if (CurStep <> ssPostInstall) or WizardSilent then Exit;
  PS := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Tmp := ExpandConstant('{tmp}\pcdeck-reseaux-publics.txt');
  Exec(PS, '-NoProfile -ExecutionPolicy Bypass -Command "Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq ''Public'' -and $_.InterfaceAlias -notmatch ''Tailscale'' } | ForEach-Object { $_.InterfaceAlias } | Set-Content -Encoding UTF8 ''' + Tmp + '''"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  if not LoadStringsFromFile(Tmp, Names) then Exit;
  List := '';
  Quoted := '';
  for I := 0 to GetArrayLength(Names) - 1 do
  begin
    Name := Trim(Names[I]);
    if Name <> '' then
    begin
      List := List + '   • ' + Name + #13#10;
      if Quoted <> '' then Quoted := Quoted + ',';
      Quoted := Quoted + '''' + Name + '''';
    end;
  end;
  if Quoted = '' then Exit;
  if MsgBox('Votre connexion réseau est de type « Public » :' + #13#10 + List + #13#10 +
            'Sur un réseau Public, Windows bloque PC Deck : la tablette ne pourra pas se connecter.' + #13#10#13#10 +
            'S''il s''agit du réseau de votre maison, le passer en « Privé » ? (recommandé)' + #13#10 +
            'Répondez Non s''il s''agit d''un Wi-Fi public (café, gare, hôtel...).',
            mbConfirmation, MB_YESNO) = IDYES then
    Exec(PS, '-NoProfile -ExecutionPolicy Bypass -Command "Set-NetConnectionProfile -InterfaceAlias ' + Quoted + ' -NetworkCategory Private"',
      '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopPcDeck;
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: string;
begin
  if CurUninstallStep = usUninstall then
  begin
    StopPcDeck;
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'PCDeck');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\PC Deck');
    if (not UninstallSilent) and DirExists(DataDir) then
      if MsgBox('Supprimer aussi vos réglages, vos boutons et la liste des appareils appairés ?' + #13#10#13#10 +
                'Choisissez Non pour les garder (utile si vous réinstallez PC Deck plus tard).',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
  end;
end;
