# Dziennik prac: przebudowa Computer Use

Każdy wpis opisuje jeden krok z [`todo.md`](todo.md): co zmieniono, jak i
dlaczego, jakie testy przeszły z czerwonych na zielone, jakie komendy walidacji
uruchomiono i z jakim wynikiem, co pominięto i co zostaje dla następnej osoby.
Hash commita danego kroku dopisuje kolejny wpis. Wersje pakietów i ich
`packages/*/CHANGELOG.md` generuje changesets; tego pliku nie należy mylić z nimi.

---

## Krok 0 — dokumenty planu i przekazania (2026-09-30)

**Co**
- `docs/computer-use-rebuild/README.md` — plan: stan wyjściowy, wnioski z
  raportów Codex i Claude, decyzje, kontrakt dla modelu, architektura, mapa
  plików referencyjnych, ryzyka.
- `docs/computer-use-rebuild/todo.md` — kroki 0–14 i sekcja „Gdzie jesteśmy”.
- `docs/computer-use-rebuild/CHANGELOG.md` — ten dziennik.
- `.changeset/computer-use-rebuild-plan.md` — pusty changeset (same dokumenty).

**Jak i dlaczego**
- Plan opiera się na dwóch raportach z 30.09.2026: Claude Desktop 2.16120.0
  i Codex Desktop 26.928.21956. Oba systemy robią to samo w podstawach, a różnią
  się punktem wyjścia obserwacji: AX u Codexa, zrzut u Claude'a. Łączymy
  kontrakt Codexa z bramkami, zgodami i batchem Claude'a.
- Wybór kontraktu: rygor aktualności stanu przenosimy z modelu do helpera,
  bo obecny kontrakt Windows zmusza model do przepisywania ID, a model je myli.
- Decyzje użytkownika: kursor jako nakładka (jak Codex), PiP jako osobny
  strumień dla człowieka (JPEG, potem H.264), bez poświaty krawędzi, bez SkyLight.
- Sprawdzone wersje aplikacji referencyjnych na tym komputerze: ChatGPT.app
  26.928.21956, Claude.app 2.16120.0; katalog `@oai` zawiera `browser-desktop`,
  `cua`, `cua-repl`, `sky`.

**Testy**
- Brak: krok nie zmienia kodu.

**Walidacja**
- Nie dotyczy (tylko dokumentacja). Kolejny krok uruchamia pełną bramkę.

**Dla następcy**
- Zacznij od „Gdzie jesteśmy” w `todo.md`. Źródła wzorców są w sekcji „Mapa
  plików referencyjnych” w `README.md`.

---

## Krok 1 — wspólny transport helpera (2026-09-30)

Commit kroku 0: `50a3cbc6`.

**Co**
- `src/windows/{protocol,transport,artifact}.ts` → `src/helper/` (przez `git mv`,
  historia zachowana), razem z testami.
- `helper/protocol.ts`: `MAX_FRAME_BYTES`, `controlCommandSchema`,
  `controlStateSchemaFor(version)`, `responseSchemaFor(version)`. Koperta
  protokołu zależy od wersji, a nie od stałej Windows.
- `helper/transport.ts`: konstruktor `new HelperTransport(command, args,
  {protocolVersion, timeoutMs?, events?, onEvent?})`. `control_state` jest
  wbudowany (wstrzymuje deadline żądania przy czekaniu na fokus/pauzie).
  Pozostałe zdarzenia (np. `cursor`, `preview_frame`) rejestruje profil
  platformy przez `events`. Nieznane lub źle zbudowane zdarzenie = błąd protokołu
  (fail-closed), jak dotąd.
- `helper/artifact.ts`: `validateHelperArtifact(bytes, manifest, protocolVersion)`
  rozpoznaje PE x64 i Mach-O (thin arm64/x86_64 oraz fat/universal z oboma
  plasterkami); manifest ma `architecture: x64 | arm64 | x86_64 | universal`.
- `windows/{contracts,backend,control-service,maintenance}.ts` korzystają ze
  wspólnych modułów; `windows/contracts.ts` wyprowadza `controlStateSchema` i
  `responseSchema` z fabryk dla v4.
- `apps/desktop/scripts/verify-desktop-resources.mjs`: import z
  `dist/helper/artifact.js` i jawna wersja protokołu Windows.

**Jak i dlaczego**
- Helper macOS (krok 4) i nowe zdarzenia kursora/PiP (kroki 6 i 11) potrzebują
  tego samego transportu. Zmiana jest czysto strukturalna, zachowanie Windows
  bez zmian.
- Zdarzenia nieskorelowane z żądaniem (klatki podglądu) mogą przyjść bez
  oczekującego żądania — transport przekazuje je od razu do `onEvent`.

**Testy (Red → Green)**
- Red: `vitest run src/helper` — 3 pliki czerwone (brak modułów `./transport.js`,
  `./protocol.js`, `./artifact.js` w `src/helper`).
- Nowe testy: `helper events` (zdarzenie zarejestrowane nie zakłóca żądania;
  zdarzenie bez oczekującego żądania dochodzi; nieznane/źle zbudowane = błąd
  protokołu), `speaks the protocol version it was configured with`,
  `response envelope`, Mach-O universal/thin i odrzucenie pomyłki platform.
- Green: plugin 16 plików / 84 testy zielone.

**Walidacja**
- `npx vitest run` (plugin) — 84/84.
- `npx tsc -p tsconfig.json --noEmit` (plugin) — OK.
- `npx eslint packages/plugin-computer-control apps/desktop/scripts/verify-desktop-resources.mjs`
  — 0 błędów, 1 ostrzeżenie w niezmienionym `readBounded` (`preserve-caught-error`).
- `pnpm check:deps` — 0 błędów (1 istniejące ostrzeżenie `no-orphans` w desktop-host).
- `pnpm build` — 88/88.
- `pnpm --filter @moxxy/desktop-host exec vitest run src/computer-update.test.ts` — 11/11.
- `node --test scripts/computer-use-policy.test.mjs scripts/desktop-packaging.test.mjs` — 9/9.

**Uwaga dla następcy**
- Po przenoszeniu plików w pakiecie usuń `dist` **i** `tsconfig.tsbuildinfo`
  przed przebudową, inaczej `tsc` uzna build za aktualny i nic nie wyemituje
  albo zostawi stare pliki w `dist/windows/`.
