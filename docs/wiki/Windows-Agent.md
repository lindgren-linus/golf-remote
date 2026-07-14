# Windows-agent

## Installation

Ladda ned [GolfRemote-Setup-0.1.0.exe](https://github.com/lindgren-linus/golf-remote/releases/download/v0.1.0/GolfRemote-Setup-0.1.0.exe) och kör den som administratör.

Installern:

- installerar agenten i Program Files;
- skapar privata brandväggsregler för TCP 56789 och UDP 5353;
- startar agenten direkt;
- registrerar autostart vid Windows-inloggning.

## Efter installation

Högerklicka på Golf Remote-ikonen i systemfältet för att se anslutningsadresser, hantera parkopplade telefoner eller stoppa servern.

Om automatisk upptäckt inte fungerar, använd en IPv4-adress från ikonmenyn med port `56789` i mobilappens manuella anslutningsläge.

## Uppdatering

Hämta en nyare fil från [Releases](https://github.com/lindgren-linus/golf-remote/releases) och kör installern igen. Den ersätter den befintliga installationen och uppdaterar brandväggsreglerna.
