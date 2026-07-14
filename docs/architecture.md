# Arkitektur och tekniska beslut

## MVP-flöde

```text
Expo-app  -- ws://<LAN-IP>:56789/ws -->  .NET-agent  -->  Win32 (monitorer/SendInput)
```

Meddelanden är UTF-8 JSON med ett obligatoriskt protokollversionsfält. Rörelser är relativa och har sekvensnummer. Agenten ignorerar rörelser med ett äldre eller lika stort sekvensnummer från samma WebSocket-anslutning. Det är avsiktligt okej att tappa rörelser; klickmeddelanden behandlas i den ordning de tas emot.

## Val som gjorts

- **.NET 8 + ASP.NET Core/Kestrel**: finns i den delade .NET-runtime och undviker både Electron och en HTTP.sys-URL ACL. Kestrel kan lyssna på lokalt nätverk utan administratörsrättigheter.
- **Win32 bakom `IPointerPlatform`**: kärnlogik för val av region och begränsning testas utan att flytta den riktiga musen.
- **Systemfältsagent, inte Windows Service**: agenten måste kunna visa en parkopplingsdialog och påverka den inloggade användarens muspekare. Windows Services körs i Session 0 och får därför varken systemfältsikon eller säker åtkomst till den interaktiva sessionen. Agenten installeras därför som en per-användare trayapp med autostart vid inloggning.
- **Inno Setup-installation**: ett elevaterat setup-program publicerar en self-contained `win-x64`-exe, installerar den under Program Files, skapar privata brandväggsregler för TCP 56789/UDP 5353 och startar en autostart-registrering för den ursprungliga Windows-användaren.
- **`ClipCursor` plus programmatisk clamp**: den valda bildskärmen är både Windows faktiska pekregion och regionen som används för relativ förflyttning.
- **mDNS/DNS-SD för upptäckt**: Windows-agenten annonserar `_golfremote._tcp.local` med datornamn, port, stabilt ID och protokollversion via `DSoft.Makaretu.Dns.Multicast`. Mobilen använder `@inthepocket/react-native-service-discovery`, som bygger på Bonjour/NSNetServiceBrowser på iOS och NsdManager på Android. Det är native kod och kräver en Expo Development Build.
- **Manuell adress som reserv**: en dold reservväg för felsökning när multicast blockeras av nätverket. Senast angivna fungerande adress sparas i mobilappens lokala lagring.
- **Lokal parkoppling**: ett nytt klient-ID begär parkoppling via WebSocket. Agenten visar en lokal Windows-dialog och skapar vid godkännande en slumpmässig token. Telefonen sparar token i `expo-secure-store`; agenten sparar endast en SHA-256-hash i `%LOCALAPPDATA%\GolfRemote\paired-clients.json`. Alla styrmeddelanden kräver sedan en godkänd `client.hello`.
- **Air mouse utan magnetometer**: `expo-sensors` Device Motion levererar rotationshastighet. En separat, plattformsoberoende filtermodul använder dead zone, lågpassfilter och maximalt hastighetstak. Inmatning är aktiv bara medan användaren håller ytan nedtryckt, vilket gör återcentrering möjlig utan musrörelse.

## Protokoll v1

Exempel:

```json
{"version":1,"type":"pointer.move","sequence":42,"payload":{"dx":5.4,"dy":-2.1}}
```

Implementerat: `client.hello`, `client.pair.request`, `client.pair.confirm`, `display.list`, `display.select`, `pointer.move`, `pointer.click`, `pointer.doubleClick`, `pointer.scroll`, `keyboard.key`, `connection.ping` och `connection.pong`. `auth.required` och `auth.authenticated` är interna svarstyper för anslutningsflödet. Tangentbordet tillåter vanliga Unicode-tecken samt Enter, Escape, pilar, Backspace och Space.

## Nästa iterationer

1. Återanslutning med exponentiell backoff och synliga anslutningsfel.
2. Hantering av parade klienter i agentens systemfältsmeny: visa, återkalla och återställ alla.
3. QR-fallback, konfigurerbara skärmnamn, kodsignering, uppdateringsflöde och installerbara mobilbyggen.

## Begränsningar

- Agenten är Windows-specifik genom `user32.dll`.
- `ClipCursor` begränsar den faktiska systempekaren tills en annan skärm väljs eller agenten stängs.
- Expo Go fungerar inte för lokal nätverksupptäckt; använd en Development Build för mDNS.
- mDNS fungerar endast inom samma lokala broadcast-domän. Gästnät, AP-isolering och vissa mesh-/företagsnät kan blockera multicast.
