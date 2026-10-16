# WordChamp

**15 in a row. Can you be the champion?**

En fungerande webbapp för glostävling i klassrummet. Elever spelar individuellt utan konto. Läraren väljer veckor och översättningsriktning; de första tre som når 15 rätt i rad vinner.

## Starta lokalt

Kräver **Node.js 24 LTS** och npm. Ingen separat databasserver behövs.

```sh
npm ci
npm run configure
npm start
```

`configure` frågar efter ett eget lärarlösenord (minst 12 tecken, dold inmatning) och sparar en scrypt-hash och en slumpad sessionsnyckel i den Git-ignorerade filen `.env`. Starta från projektets rot. Läraren väljer **Lärarrummet** i appens sidhuvud och loggar in med det valda lösenordet. Elever går till samma webbplats och anger spelkod och ett smeknamn.

För automatiserad **lokal utveckling** kan `node configure.js --local` användas. Det skapar bara konfiguration om `.env` saknas och sparar ett starkt slumpat lösenord i `var/teacher-password.txt` med filrättighet 0600. Denna fil är ignorerad av Git. Använd `npm run configure` för att byta till ett eget lösenord. Starta om servern efter byte. Dela aldrig `.env`, sessionsnyckeln eller lösenordsfilen med elever.

Molnmiljöer med skrivskyddad hemkatalog kan använda `npm ci --cache /tmp/wordchamp-npm`.

## Så spelar ni

1. Läraren skapar ett spelrum och visar PIN/QR-kod på projektorn.
2. Elever väljer ett unikt smeknamn. Undvik fullständiga namn.
3. Välj veckor med **minst 30 glosor**. En vecka i originalfilen har 25 glosor, så välj minst två. Välj engelska → svenska, svenska → engelska eller blandat.
4. Starta rundan. Varje elev får en egen slumpad frågeordning och fyra svarsalternativ, utan tidsgräns. Rätt svar ökar streaken, fel svar nollställer den. Rätt svar markeras direkt; eleven trycker själv på nästa glosa.
5. Första tre till 15 vinner. Vid en eller två deltagare räcker det att alla kommer i mål. Även frånkopplade deltagare behåller sin plats och kan återansluta; läraren kan alltid avsluta manuellt.
6. Se pallplats, antal deltagare, andel rätt och glosor med högst felprocent. Starta en ny runda i samma rum utan att eleverna ansluter igen.

Elever väntar i ett väntrum tills läraren trycker på start. Start kräver minst en ansluten elev. Elever som ansluter efter rundstart väntar till nästa runda; befintliga deltagare kan fortfarande återansluta efter avbrott. Sena elever räknas inte som deltagare i den redan pågående rundan. Slumpningen använder i första hand oanvända glosor bland valda veckor. När urvalet är uttömt fylls rundan med tidigare glosor, utan dubbletter inom rundans 30 frågor. Samma glosor kan återkomma när en elev fortsätter spela. Läromedel och alternativa svenska översättningar bevaras. Alternativ används för att undvika konkurrerande svar; spelet är flervalsfrågor, inte fritext.

Öppna **⛶-knappen** i resultatlistan för projektorläge. Escape lämnar helskärm. De 15 främsta visas, vinnarna först och sedan aktiva efter aktuell streak. Placering avgörs av i vilken ordning giltiga svar behandlas på servern, även när flera svar kommer samtidigt.

## Glosbank och import

`data/vocabulary.csv` är den oförändrade auktoritativa källfilen: **750 poster, 30 veckor**. Första serverstarten importerar den till SQLite. Senare starter behåller lärarens ändringar; en tom eller redigerad bank fylls inte på automatiskt. Rundor använder fristående ögonblicksbilder och påverkas inte när banken redigeras.

I **Glosbanken** kan läraren söka, filtrera, skapa, redigera, radera och importera utan kodändringar. CSV ska vara UTF-8 och kommaavgränsad; XLSX använder första bladet. Högst 5 MB via gränssnittet och 10 000 glosor per import. Importen valideras i sin helhet innan något sparas. Exakta dubbletter hoppas över; importer skriver inte över befintliga poster.

| Svensk rubrik              | Alternativ engelsk rubrik | Krävs                 |
| -------------------------- | ------------------------- | --------------------- |
| Vecka                      | week                      | Ja, 1–53              |
| Engelska                   | english                   | Ja                    |
| Svenska                    | swedish                   | Ja                    |
| Alternativa översättningar | alternatives              | Nej, separera med `;` |
| Kapitel                    | unit                      | Nej                   |
| Tema                       | topic                     | Nej                   |
| Läromedel                  | book                      | Nej                   |

Originalfilens `Nr` ignoreras eftersom banken tilldelar egna stabila ID:n. Alla innehållsfält bevaras. Filen räknas inte som instruktioner eller körbar kod.

## Arkitektur och integritet

- Express och Socket.IO, med en responsiv klient utan byggsteg eller externa CDN-beroenden.
- SQLite med WAL, parametriserade frågor, transaktionell import och beständig glosbank, anonym rundstatistik och ordstatistik.
- Servern väljer frågor, håller rätt svar hemligt tills eleven svarat, validerar varje svar och avvisar dubbletter/föråldrade fråge-ID:n. Klienten kan inte ange egen streak eller placering.
- Ett gemensamt lärarlösenord för installationen. Lärarsessioner lagras i SQLite, har åtta timmars giltighet och använder HttpOnly/SameSite-cookies; Secure-cookies används i produktion. Inloggningsförsök begränsas. Lärare autentiseras för varje skyddat API-anrop och när en resultattavla ansluts.
- Inga smeknamn, elevtoken, individuella resultat eller pallnamn skrivs till databasen. Dessa finns enbart i serverminnet för det pågående spelrummet och försvinner när rummet stängs, efter åtta timmars inaktivitet eller vid serveromstart.
- Elevens återanslutningstoken sparas i webbläsarens `sessionStorage` för aktuell flik. Omladdning/nätavbrott återupptar spel på samma server; stängd flik eller rensad lagring förlorar token. En token kan bara spela från en aktiv anslutning.
- **En serverprocess, en instans.** Aktiva rum överlever inte serveromstart. Glosor, ordstatistik, anonyma rundsummor och lärarsessioner består på disken. Starta inte om mitt under lektionen. Flera repliker kräver en separat delad spel-/Socket.IO-lagring och ingår inte i denna version.
- Rummen stödjer upp till 200 smeknamn och installationen upp till 100 samtidiga rum. Gränserna är skyddsräcken, inte ett verifierat kapacitetslöfte.

## Tester

```sh
npm test
npm run test:browser
```

`npm test` kör verkliga HTTP- och Socket.IO-klienter och SQLite mot tillfälliga databaser samt spelmotorns regler. Det kontrollerar bland annat 750-postersimport, beständig lagring, behörighet, CSV/XLSX, dubbletter, sena deltagare, återanslutning, tre vinnare och anonyma resultat.

Webbläsartestet använder Chromium på `/usr/bin/chromium` i molnmiljön. För en annan installation kan du ange `CHROMIUM_PATH=/sökväg/till/chromium`. Alternativt installera Playwrights Chromium med `npx playwright install chromium` och ange dess körbara sökväg. Testservern använder port 3100 och separat temporär databas och testlösenord. Den testar lärare och två separata mobila elevsessioner, liveuppdateringar, omladdning, rundbyte och glosredigering. Skärmbilder hamnar i ignorerade `test-results/`.

## Driftsättning

Använd en Node-server eller container med **beständig disk** och WebSocket-stöd. Kör en instans; undvik serverless-funktioner eller flyktig databasdisk. Publik driftsättning har inte utförts av projektets lokala tester.

1. Kör `npm ci --omit=dev` och skapa konfiguration med `npm run configure` på en betrodd maskin, eller tillför motsvarande värden via leverantörens skyddade miljövariabler.
2. Ange `PUBLIC_URL=https://din-domän.se` (utan avslutande snedstreck), `NODE_ENV=production` och `TRUST_PROXY=1` om exakt en betrodd reverse proxy ligger framför appen. `PUBLIC_URL` måste stämma med adressen eleverna använder; den styr QR-koden och ursprungskontrollen.
3. Ange `DB_PATH=/beständig-disk/wordchamp.sqlite`, och ge appens användare skrivrättighet till katalogen. `.env` ska inte ingå i Docker-image eller versionshantering.
4. Kör `npm start` bakom en HTTPS-proxy (t.ex. Caddy/Nginx). Proxyn ska stödja WebSocket-uppgradering och vidarebefordra Host och X-Forwarded-Proto. Exponera endast proxyn publikt; bind Node-porten till loopback eller privat nätverk. Vid `TRUST_PROXY=1` måste direkt trafik till Node blockeras.
5. Kontrollera `/health`, lärarinloggning och en riktig elevanslutning från en annan enhet över HTTPS. Skanna QR-koden på en mobil. Kontrollera att rundstart och svar uppdaterar projektorn.

En medföljande `Dockerfile` använder Node 24, en användare utan root-rättigheter och `/app/var` som datakatalog. Exempel:

```sh
docker build -t wordchamp .
docker volume create wordchamp-data
docker run -d --name wordchamp --restart unless-stopped \
  --env-file .env -e NODE_ENV=production -e TRUST_PROXY=1 \
  -e PUBLIC_URL=https://din-domän.se -e DB_PATH=/app/var/wordchamp.sqlite \
  -p 127.0.0.1:3000:3000 -v wordchamp-data:/app/var wordchamp
```

Vid en företagsproxy kan byggkommandot kompletteras med `--build-arg HTTP_PROXY --build-arg HTTPS_PROXY --build-arg NO_PROXY` och, om en extra betrodd rot-CA behövs, `--secret id=npm_ca,src=/sökväg/till/ca.pem`. Proxyvärdnamnet måste kunna lösas i byggnätverket. Certifikatet monteras endast under installationen; TLS- och paketverifiering behålls.

Caddy på samma värd kan terminera HTTPS med följande Caddyfile:

```text
din-domän.se {
    reverse_proxy 127.0.0.1:3000
}
```

Anpassa DNS, brandvägg och certifikat enligt driftmiljön. Kör inte `--local` för att ersätta produktionens lösenord automatiskt.

### Backup och uppdatering

`npm run backup` använder SQLite-backup-API:t för en konsistent kopia till `var/backups/`, även när WAL används. Säkerhetskopior innehåller lärarsessioner och ska skyddas som databasen. Kopiera dem till skyddad extern lagring enligt skolans policy. Vid återställning: stoppa appen, ersätt databasfilen och ta bort gamla `-wal`/`-shm` för den stoppade databasen innan appen startas. Prova återställning innan verklig användning.

Säkerhetskopiera före uppdatering, avsluta aktiva lektioner, installera med `npm ci`, kör tester och starta om. Behåll `SESSION_SECRET` stabil om befintliga lärarsessioner ska överleva. Byt nyckeln och starta om för att ogiltigförklara alla lärarsessioner. `npm run configure` byter lösenord för nya inloggningar; redan inloggade sessioner gäller annars tills utloggning/utgång.

`uuid` är låst via npm override till 11.1.1, eftersom ExcelJS annars drar in en äldre version med en känd sårbarhet. Excel-importen testas med denna version. Behåll låsfilen och kör `npm audit` vid uppdateringar.

## Gratis testadress på Render

`render.yaml` skapar en enda Docker-webbtjänst med **Free** vald, utan betald disk eller separat databas. I Render: välj **New → Blueprint**, anslut detta GitHub-repo och följ konfigurationen i `render.yaml`. Ange ett unikt lärarlösenord (minst 12 tecken) för `TEACHER_PASSWORD` direkt i Renders skyddade fält. Skriv det aldrig i GitHub eller chatten. Sessionsnyckeln genereras av Render. Appen använder automatiskt Renders `RENDER_EXTERNAL_URL` för QR-koder och ursprungskontroll, så `PUBLIC_URL` behöver inte fyllas i för den vanliga onrender.com-adressen.

Kontrollera att sammanställningen visar **Free / $0** innan du skapar tjänsten. Plattformens aktuella kontokrav och gratisvillkor avgör vad som är tillgängligt. Stanna om Render kräver betalning och kontrollera alternativen innan du fortsätter.

Gratisversionens databas är **tillfällig**. Vid omstart eller ny driftsättning kan egna glosändringar och statistik försvinna; originalets 750 glosor importeras igen om databasen saknas. Tjänsten kan somna vid inaktivitet och första besöket kan därför ta en stund. Spelrum finns i minnet och försvinner när processen stoppas. Använd testadressen för att prova funktionerna, inte för att spara unika undervisningsdata.

När driftsättningen är klar, öppna Renders HTTPS-adress och välj **Lärarrummet**. Logga in med lösenordet du angav i Render, skapa ett spelrum och testa från en separat mobil. Den som enbart använder denna Render-konfiguration behöver inte köra några terminalkommandon eller dela någon `.env`-fil.
