# Golf Remote MVP

En lokal fjärrkontroll för en Windows-baserad golfsimulator. Denna första, körbara version består av en Expo/React Native-app och en .NET 8-agent. All kommunikation sker via WebSocket på det lokala nätverket; ingen molntjänst, inloggning eller databas används.

## MVP: klart i denna version

- Automatisk lokal upptäckt med mDNS/DNS-SD: agenten annonserar `_golfremote._tcp.local` och appen ansluter automatiskt när exakt en dator hittas.
- Lista med datornamn när flera simulator-datorer finns på nätverket; manuell IP är endast reservväg.
- Expo-app för iOS och Android med stor touchpad, vänster-/högerklick, enkelt tangentbord och air mouse.
- WebSocket-protokoll med versionsfält och sekvensnummer för relativa rörelser.
- Windows-agent som listar aktiva bildskärmar, flyttar pekaren till vald skärms mitt och begränsar pekaren till den valda skärmen.
- Relativ musrörelse och vänster/dubbelklick via `SendInput`.
- Simuleringsläge som loggar inmatning utan att röra den verkliga muspekaren.
- Lokal parkoppling: Windows visar en Tillåt/Neka-dialog första gången en telefon ansluter. Telefonens token lagras säkert lokalt och agenten behåller enbart en hash.
- Air mouse med håll-för-att-styra, dead zone, lågpassfilter, hastighetstak och separat känslighetsinställning.
- Enhetsnära kärnlogik med körbara, paketfria tester.

## Projektstruktur

```text
apps/
  mobile/                 Expo / React Native-klient
  windows-agent/          .NET 8 Windows-agent och tester
docs/
  architecture.md         beslut, protokoll och nästa iterationer
```

## Förutsättningar

- Windows 10/11 med [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0).
- Node.js LTS och npm.
- Android Studio för Android Development Build. För iOS krävs macOS/Xcode för en lokal Development Build.
- Telefon och Windows-dator på samma lokala nätverk.

## Installera Windows-agenten

Hämta den färdiga installationsfilen från den privata GitHub-releasen:

[GolfRemote-Setup-0.1.0.exe](https://github.com/lindgren-linus/golf-remote/releases/download/v0.1.0/GolfRemote-Setup-0.1.0.exe) · [alla releaser](https://github.com/lindgren-linus/golf-remote/releases)

Du behöver vara inloggad på GitHub med åtkomst till repot för att hämta filen.

Kör installationen som administratör. Den:

- installerar en fristående `win-x64`-version av agenten, utan krav på att .NET SDK finns på simulator-datorn;
- lägger till privata Windows-brandväggsregler för WebSocket (TCP 56789) och lokal upptäckt (UDP 5353);
- startar agenten direkt och registrerar den för automatisk start när den aktuella användaren loggar in;
- placerar en liten Golf Remote-ikon i systemfältet.

Högerklicka på ikonen för att se datornamn och anslutningsadresser, starta/stoppa servern, aktivera/inaktivera autostart och hantera parade telefoner. Avinstallationen tar bort brandväggsregler och autostart. Parkopplingsdata i `%LOCALAPPDATA%\GolfRemote` behålls tills den återställs från ikonmenyn.

Agenten körs medvetet som en systemfältsapp i den inloggade Windows-sessionen, inte som en traditionell Windows Service. En service kan inte säkert visa parkopplingsdialoger eller styra den interaktiva muspekaren i användarens skrivbordssession.

### Bygg installationsfilen igen

Installera [Inno Setup 6](https://jrsoftware.org/isdl.php) på byggdatorn och kör:

```powershell
cd .\apps\windows-agent\installer
.\build-installer.ps1 -Version "0.1.0"
```

Skriptet publicerar agenten som en self-contained, single-file Windows-applikation och lägger setupfilen i `apps/windows-agent/artifacts/installer`.

## Starta Windows-agenten

Öppna PowerShell i `apps/windows-agent` och kör:

```powershell
dotnet run --project .\src\GolfRemote.Agent\GolfRemote.Agent.csproj -- --port 56789
```

Agenten visas som en ikon i Windows systemfält. Högerklicka på ikonen och öppna **Anslutningsadresser** om du behöver manuell IP i Expo Go; mobilen ska annars normalt hitta den via mDNS. Avsluta via **Avsluta Golf Remote** i ikonmenyn; det tar bort musbegränsningen och mDNS-annonsen.

För att utveckla utan att flytta systempekaren:

```powershell
dotnet run --project .\src\GolfRemote.Agent\GolfRemote.Agent.csproj -- --simulate
```

### Brandvägg

Första gången kan Windows Defender Firewall fråga om åtkomst. Tillåt **privata nätverk**. Om ingen dialog visas, öppna en förhöjd PowerShell och skapa regeln:

```powershell
New-NetFirewallRule -DisplayName "Golf Remote (local WebSocket)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 56789 -Profile Private
New-NetFirewallRule -DisplayName "Golf Remote discovery (mDNS)" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 -Profile Private
```

Ta bort den senare vid behov:

```powershell
Remove-NetFirewallRule -DisplayName "Golf Remote (local WebSocket)"
Remove-NetFirewallRule -DisplayName "Golf Remote discovery (mDNS)"
```

Exponera inte porten på offentliga nätverk eller via port-forwarding.

## Installera Android-appen

Hämta den signerade Android-appen från den privata releasen:

[GolfRemote-0.1.1.apk](https://github.com/lindgren-linus/golf-remote/releases/download/v0.1.1/GolfRemote-0.1.1.apk) · [alla releaser](https://github.com/lindgren-linus/golf-remote/releases)

Öppna länken på Android-enheten, hämta APK-filen och godkänn **Tillåt från den här källan** när Android frågar. Appen är fristående: varken Expo Go eller en utvecklingsserver behövs efter installationen. Telefon och Windows-agent ska vara på samma Wi-Fi-nät. Du behöver vara inloggad på GitHub med åtkomst till det privata repot för att hämta filen.

## Bygga mobilappen med automatisk upptäckt

Automatisk upptäckt använder en native iOS/Android-modul och fungerar därför inte i Expo Go. I Expo Go visas i stället IP-adress och port direkt i appen, så att du kan ansluta manuellt till agenten. Bygg en Expo Development Build en gång per plattform för automatisk upptäckt:

```powershell
cd .\apps\mobile
npm install
npx expo prebuild --clean
npx expo run:android
```

Efter nya native-moduler eller permissions (som air mouse) kör du `npx expo prebuild --clean` och `npx expo run:android` igen. Starta sedan utvecklingsservern med:

```powershell
npx expo start --dev-client
```

På iOS kör du motsvarande `npx expo run:ios --device` från en Mac med Xcode. Appen ber om lokal nätverksåtkomst första gången. När exakt en Golf Remote-agent hittas ansluter appen automatiskt och väljer agentens första skärm. Vid flera datorer visas en lista med deras datornamn.

Om ingen dator hittas, kontrollera att båda enheterna är på samma nät och att Wi-Fi-nätet inte isolerar klienter. Använd länken **Anslut manuellt med IP-adress** som felsökningsreserv. Vid första anslutningen: välj **Tillåt** i Windows-dialogen. Vid senare anslutningar sker verifieringen automatiskt.

### Expo Go med manuell IP

Starta agenten på datorn och notera IPv4-adressen i raden `Mobilanslutning: ws://<IP-adress>:56789/ws`. Starta därefter Expo Go med `npx expo start` i `apps/mobile`, öppna projektet i Expo Go och skriv in IP-adressen samt port `56789`. Air mouse och säker parkoppling fungerar även här; endast automatisk mDNS-sökning kräver Development Build.

## Air mouse

Välj **Air mouse** i appen och godkänn rörelseåtkomst om telefonen frågar. Håll ned den stora ytan medan du vrider telefonen. När du släpper stannar pekaren, så att du kan vrida tillbaka telefonen utan att flytta musen. Känsligheten justeras under **Inställningar**.

## Verifiering

```powershell
dotnet build .\apps\windows-agent\GolfRemote.sln
dotnet run --project .\apps\windows-agent\tests\GolfRemote.Agent.Tests\GolfRemote.Agent.Tests.csproj
```

## Återstår

Automatisk återanslutning med backoff, QR-fallback, systemfältsgränssnitt, hantering av parade klienter (visa/återkalla/återställ), autostart och installerbara builds är planerade för följande iterationer. Se [arkitekturdokumentet](docs/architecture.md).
