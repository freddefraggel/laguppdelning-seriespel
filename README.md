# Laguppdelning

Fördelar en barnlagstrupp över seriematcher så att alla spelar ungefär lika många
matcher och får en lagom blandning av nivå. Byggd för ett lag som anmält sig i
flera svårighetsnivåer samtidigt, till exempel ett lag i medelserien och ett i
lättserien.

En statisk sida. Ingen server, ingen byggkedja, inga beroenden. All data ligger i
en JSON-fil på din egen dator.

## Lägg upp den på GitHub Pages

1. Lägg filerna i repots rot och pusha till `main`.
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, mapp `/ (root)`.
3. Efter en minut ligger den på `https://<användarnamn>.github.io/<repo>/`.

Det går också att öppna `index.html` direkt från hårddisken. Allt fungerar likadant
där, så länge du är uppkopplad: typsnittet hämtas från Google Fonts.

## Så används den

1. **Matcher** – en rad per match med nivå, datum, tid, plats och motståndare.
   Matchnumret (L1, M3 …) följer datumet inom varje nivå.
   **Fyll på med exempel** lägger till tomma matcher på helgdatum, så många per
   nivå som du anger, och visar direkt hur många platser det ger och hur många
   matcher var och en i truppen då får. Använd det för att prova vilka serier
   och hur många matcher laget bör anmäla sig till innan spelschemat finns.
   **Rensa alla matcher** tömmer säsongen men behåller truppen.
2. **Spelare** – truppen med nivå och hur ofta var och en får flyttas ett steg
   upp eller ner.
3. **Inställningar** – spelform och avbytare per serie, målfördelningen och hur
   lika två matcher får bli.
4. **Schema** – tryck **Generera förslag**. Klicka i rutorna för att ändra för
   hand, och lås en match när den är spelad.

Klick i en ruta växlar mellan *spelar*, *kan inte spela* och *tom*. Markerar du
någon som inte kan spela byts en ersättare in automatiskt. `Ctrl+Z` ångrar,
`Ctrl+S` sparar.

## Reglerna förslaget följer

I fallande ordning. De tre första bryts aldrig:

1. Låsta matcher och *kan inte spela* rörs inte.
2. Ingen flyttas mer än **ett** nivåsteg. En Lätt-spelare kan spela Medel men
   aldrig Svår. Finns inget lag på spelarens egen nivå räknas närmaste nivå som
   rätt.
3. **Matchtruppen** fylls till exakt rätt antal, alltid.

Räcker inte spelarna släpps först *Nej* på svårare eller lättare, därefter
tillåts dubbelbokning samma datum. Mjukast av allt är likhetsgränsen, som hindrar
att två matcher i samma serie får för många gemensamma spelare. Allt som inte gick
att hålla visas som en varning efter genereringen.

Målfördelningen (som standard 25 / 50 / 25) går bara att nå om serierna har
ungefär så många platser som målet efterfrågar. Inställningar räknar ut detta och
säger till när det inte går.

## Filen

Appen håller en levande koppling till en JSON-fil och sparar automatiskt efter
varje ändring. Kopplingen minns mellan besök, men webbläsaren kan be om lov igen –
då räcker ett klick på Spara.

Det bygger på [File System Access API][fsa], som finns i Chrome, Edge och Opera.
I Safari och Firefox faller appen tillbaka på att öppna filen manuellt och ladda
ner den när du är klar; topplisten visar när den är i det läget.

Filen är vanlig JSON och går att läsa och versionshantera:

```json
{
  "version": 1,
  "team": "Brostorp P9",
  "settings": {
    "series": [{ "level": 1, "form": 5, "subs": 3 }],
    "targets": { "easier": 0.25, "right": 0.5, "harder": 0.25 },
    "grades": { "Nej": 0, "Ja, sällan": 0.5, "Ja": 1, "Ja, ofta": 1.5 },
    "maxShare": 0.625
  },
  "players": [{ "id": "p1", "name": "Alva", "level": 1, "harder": "Ja", "easier": "Ja" }],
  "matches": [{ "id": "m1", "level": 2, "date": "2027-04-25", "time": "11:30",
                "place": "Brostorps IP", "opponent": "Ekliden FF 2", "locked": false }],
  "picks": { "m1": ["p1"] },
  "out":   { "m1": [] }
}
```

`picks` och `out` pekar på spelar-id, inte på radordning, så det går att sortera
om och lägga till matcher utan att schemat hamnar fel.

## Filerna i repot

| Fil | Vad den gör |
| --- | --- |
| `index.html` | Sidans stomme |
| `app.css` | All formgivning |
| `app.js` | Gränssnittet och de fyra vyerna |
| `plan.js` | Fördelningsalgoritmen, fristående och testbar |
| `store.js` | Filkopplingen och automatsparandet |

`plan.js` fungerar också i Node:

```js
const { planeraBast } = require('./plan.js');
```

[fsa]: https://developer.mozilla.org/docs/Web/API/File_System_API
