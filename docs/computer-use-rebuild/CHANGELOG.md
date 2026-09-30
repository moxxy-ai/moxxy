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
  Uwaga (krok 3): sam `pnpm build` może wtedy przywrócić stary `dist` z cache
  turbo. Po przeniesieniu plików buduj pakiet z `--force`:
  `pnpm turbo run build --filter=@moxxy/plugin-computer-control --force`.

---

## Krok 2 — kontrakt narzędzi (2026-09-30)

Commit kroku 1: `504cae7e`.

**Przegląd wzorca (read-only)**
- Claude.app 2.16120.0, `app.asar` → `.vite/build/index.chunk-DkY0FFgk.js`:
  schematy `request_access`, `screenshot`, `zoom`, `left_click`…`hold_key`,
  `left_mouse_down/up`, `computer_batch` (płaski obiekt akcji z enumem),
  narzędzia `app_*` (tryb w tle: `element_index`, `target: focused`, `path`
  2–20 punktów, `overwrite_existing`), łatka pikseli 9×9.
  `index.chunk-kXuYPTnM.js`: budżet obrazu (28 px, 1568 px, 1568 kafelków,
  wyszukiwanie binarne szerokości), `scale` w [0,1; 1], parser akordów,
  listy kombinacji systemowych per platforma, flagi schowka z akordu,
  kategorie aplikacji (przeglądarka / terminal / trading).
- ChatGPT.app 26.928.21956, `@oai/sky`: `docs/skills/oai_sky_lib/macos/SKILL.md`
  (typ `Sky`, `get_app_state` z diffem i `disableDiff`, xdotool, `paste`
  text/md/html, settling ~1 s do 5 s), `targets/mac/errors.js` (kody serwera:
  `appNotAllowed`, `ambiguousApp`, `userIntervened`, `screenLocked`…),
  `window_result.js` (instrukcje per aplikacja pokazywane raz na aplikację).
- Kod piszemy sami; z wzorców wzięte są parametry, limity i zachowania.

**Co** (`packages/plugin-computer-control/src/contract/`)
- `tools.ts` — `computerTools`: 17 narzędzi (opis + schemat zod). Jeden słownik
  pól bez domyślnych; akcje (`click`, `type_text`, `paste`, `press_key`,
  `scroll`, `drag`, `set_value`, `select_text`, `perform_secondary_action`,
  `mouse`, `hold_key`, `wait`) są wspólne dla pojedynczych narzędzi (z `app`
  na początku) i `computer_batch` (≤ 50 kroków). `resolveTarget` →
  `element | point | focused`. Cel: dokładnie jeden z `element_index` albo
  `x`+`y`; dla pisania/wklejania także żaden (fokus).
- `keys.ts` — `parseKeyCombo` (xdotool → `{modifiers, key}`; `super`/`cmd`/`win`
  → `meta`; `Delete` = usuwanie w przód, `BackSpace` = wstecz; `KP_0` →
  `numpad_0`; `ctrl++`), `formatChord`, `isSystemKeyCombo` (darwin/win32),
  `clipboardFlagsFor`.
- `image.ts` — `IMAGE_LIMITS`, `imageBudget`, `scaledSize`, `imagePointToScreen`
  (ramka `image` + `bounds` w globalnych punktach ekranu, także ujemnych).
- `outcome.ts` — 27 kodów błędów z podpowiedzią następnego kroku,
  `actionResultSchema` (`delivered | ineffective | unsupported | blocked`,
  `code`, `hint`, `method: ax | input`), `describeResult`, `ComputerUseError`.
- `tree.ts` — `appTreeSchema` (odrzuca zduplikowane indeksy/klucze),
  `formatTree` (wcięcia, `[N]`, wartości w cudzysłowach JSON, limit długości,
  `value=<secure>` dla haseł), `diffTrees` (`+`/`~`/`-`; pełne drzewo przy
  zmianie okna lub gdy nic nie zostało bez zmian; zmiana indeksu = `~`).
- `untrusted.ts` — `wrapUntrusted`: `<app_content app="…" trust="untrusted">`,
  neutralizacja zamknięcia ogrodzenia i cudzysłowów w nazwie.

**Jak i dlaczego**
- Schemat pojedynczego narzędzia to płaski obiekt (JSON Schema `type: object`),
  bo dostawcy (Codex `/responses`) odrzucają unie na najwyższym poziomie.
  Krok batcha jest płaskim obiektem wszystkich pól (jak w Claude) i dopiero
  potem jest parsowany dokładnym schematem akcji, więc błąd wskazuje
  `actions.N`.
- Nazwy pól w `snake_case` konsekwentnie (także `clipboard_read`,
  `clipboard_write`, `system_key_combos`). Pole akcji drugorzędnej to
  `secondary_action`, a zdarzenie myszy to `event`, żeby nie kolidowały z
  `action` w batchu.
- Tekst drzewa i diff powstają w TS, a nie w helperach: jedna implementacja dla
  Swift i C++. Helper musi za to utrzymywać stabilny `key` i indeks elementu
  tak długo, jak element żyje (zapisane w kroku 5 w `todo.md`). Diff i tak
  wypisuje każdą zmianę indeksu, więc stary indeks nie wskaże innego elementu.
- `scroll` używa `pages` na obu platformach; helper Windows przeliczy strony na
  piksele (zmiana względem planu, README zaktualizowane).

**Testy (Red → Green → Refactor)**
- Red: `npx vitest run src/contract` — 6 plików czerwonych (`Cannot find module
  './keys.js'`, `'./image.js'`, `'./outcome.js'`, `'./tree.js'`,
  `'./untrusted.js'`, `'./tools.js'`).
- Green: 6 plików / 105 testów. Po drodze: schemat `z.object({app}).and(strict)`
  odrzucał `app` — przebudowane na rozszerzanie kształtu przed refinementem.
- Refactor: wspólny `chord()` zamiast dwóch bloków try/catch; testy ponownie
  105/105.

**Walidacja**
- `npx vitest run` (plugin) — 22 pliki / 189 testów.
- `npx tsc -p tsconfig.json --noEmit` (plugin) — OK.
- `npx eslint packages/plugin-computer-control` — 0 błędów, 1 istniejące
  ostrzeżenie (`readBounded`).
- `pnpm check:deps` — 0 błędów; ostrzeżenia `no-orphans` dla
  `contract/tree.ts` i `contract/untrusted.ts` (używa ich dopiero backend z
  kroku 3) + istniejące w desktop-host.
- `pnpm build` — 88/88.
- `pnpm --filter @moxxy/desktop-host exec vitest run src/computer-update.test.ts` — 11/11.
- `node --test scripts/computer-use-policy.test.mjs scripts/desktop-packaging.test.mjs` — 9/9.

**Dla następcy**
- Kontrakt nie jest jeszcze podpięty do działających narzędzi; robi to krok 3
  (fabryka narzędzi z `computerTools`) i krok 10 (przełączenie macOS).
- Kategorie aplikacji i domyślne poziomy zgody (przeglądarki `read`,
  terminale/IDE `click`) należą do `AccessRegistry` w kroku 3.

---

## Krok 3 — wspólny backend i zgody per aplikacja (2026-09-30)

Commit kroku 2: `d9169691`.

**Przegląd wzorca (read-only)**
- Claude.app 2.16120.0, `index.chunk-kXuYPTnM.js`: kategorie aplikacji
  (zbiory bundle ID i nazw: przeglądarki, terminale/IDE, trading) i mapowanie
  kategoria → poziom (`browser`/`trading` → `read`, `terminal`/`shell` →
  `click`, reszta → `full`); `request_access` z flagami schowka i skrótów
  systemowych (`index.chunk-DkY0FFgk.js`).
- ChatGPT.app 26.928.21956, `@oai/sky/.../targets/mac/computer-use-policy.js`:
  zgoda per aplikacja przez elicitation („Allow Computer Use to use X?”),
  trwałość `session`/`always`, decyzje polityki `allowed/denied/forbidden`.

**Co** (`packages/plugin-computer-control/src/`)
- `backend/turn-controls.ts` (+ test) — `TurnControls` przeniesione z
  `windows/control-service.ts` (`git mv`), bez zmian zachowania.
- `backend/access.ts` — `accessGrantSchema` (wynik narzędzia zgody),
  `accessFromLog` (fold po logu sesji), `checkAccess` (identyfikator lub nazwa,
  bez rozróżniania wielkości liter; `app_not_allowed`, `ambiguous_app`,
  `tier_insufficient`), `requiredTier` (`wait` → read; lewy klik bez
  modyfikatorów i scroll → click; reszta → full), `checkKeys` (skróty
  systemowe i schowka wymagają flag), `categorize`, `defaultTier`, `maxTier`.
- `backend/rpc.ts` — `CONTRACT_PROTOCOL_VERSION = 5` i schematy wyników metod
  helpera: `list_apps`, `resolve_apps`, `get_app_state` (`tree` +
  `screenshot` albo `screenshotUnavailable`), `act`, `batch`, `screenshot`,
  `zoom`.
- `backend/backend.ts` — `ComputerBackend` z `PlatformProfile` (ścieżka i
  argumenty helpera, wersja protokołu, platforma klawiszy, weryfikacja
  artefaktu). Jeden helper na sesję+turę, Stop kończy Computer Use do końca
  tury, `onTurnEnd`/`onShutdown` zamykają helper. Narzędzia powstają z
  `computerTools`. Stan aplikacji wraca jako `{mediaType, base64, forModel}`
  (model widzi obraz i tekst), tekst drzewa w `<app_content … untrusted>`,
  domyślnie diff względem ostatniego stanu z tej tury.
- `helper/transport.ts` — `HelperError {code, detail}`; backend zamienia znany
  kod na `ComputerUseError` z podpowiedzią.
- `contract/tools.ts` — `computer_request_access.full_access` (tylko aplikacje
  z `apps`); `contract/outcome.ts` — `isErrorCode`, nowa treść podpowiedzi
  `helper_failed`.
- Testy: `backend/access.test.ts`, `backend/backend.test.ts`,
  `backend/helper.fixture.ts`, `backend/contract-helper.fixture.mjs`;
  `tsconfig.json` wyklucza `*.fixture.ts` z buildu.

**Jak i dlaczego**
- Zgoda jest wynikiem narzędzia, a nie osobnym zdarzeniem. Plugin ładowany
  przez autodiscovery nie ma zapisu do logu, a `tool_result` zatwierdzonego
  wywołania `computer_request_access` i tak trafia do logu sesji. Fold
  uwzględnia tylko wynik `ok` z `tool_call_approved` dla tego narzędzia, więc
  odmowa, błąd, cudzy wynik i zniekształcony zapis nic nie dają. Desktop, TUI
  i kanały widzą ten sam stan; `/clear` zaczyna bez zgód.
- Decyzję o zgodzie podejmuje istniejący silnik uprawnień (prompt z listą
  aplikacji, `reason` i `full_access`). Zgodnie z `AGENTS.md` handler nie
  dodaje własnych bramek ponad silnik — patrz ryzyko niżej.
- Poziom sprawdza TS przed wysłaniem czegokolwiek do helpera (test dowodzi, że
  odrzucona akcja nie dociera do procesu). Bramki zależne od ekranu
  (frontmost, hit-test, łatka pikseli) zostają w helperze; dostaje on listę
  `allowed` przy każdej akcji.
- Drzewa do diffów żyją w turze (razem z helperem, który nadał indeksy), więc
  nowa tura zaczyna od pełnego drzewa.

**Testy (Red → Green → Refactor)**
- Red: `npx vitest run src/backend src/helper src/contract` — `Cannot find
  module './access.js'` (2 pliki), brak `full_access` w schemacie, brak
  `HelperError` (4 pliki czerwone, 2 testy).
- Green: 12 plików / 174 testy. Typy testów sprawdzone tymczasowym
  tsconfigiem obejmującym `*.test.ts` (domyślny je wyklucza) — poprawione 3
  pliki testów.
- Refactor: `maxTier` zamiast dwóch ręcznych porównań rang; 233/233.

**Walidacja**
- `npx vitest run` (plugin) — 24 pliki / 233 testy.
- `npx tsc -p tsconfig.json --noEmit` (plugin) — OK; testy przez tymczasowy
  tsconfig — OK.
- `npx eslint packages/plugin-computer-control` — 0 błędów, 1 istniejące
  ostrzeżenie (`readBounded`).
- `pnpm check:deps` — 0 błędów, 1 istniejące ostrzeżenie (desktop-host).
- `pnpm turbo run build --filter=@moxxy/plugin-computer-control --force` i
  `pnpm build` — 88/88; w `dist/` brak `windows/control-service.*` i fixture.
- `pnpm --filter @moxxy/desktop-host exec vitest run src/computer-update.test.ts` — 11/11.
- `node --test scripts/computer-use-policy.test.mjs scripts/desktop-packaging.test.mjs` — 9/9.

**Ryzyka i otwarte kwestie**
- Auto-approve rozmowy albo „zezwól na sesję/zawsze” dla
  `computer_request_access` przyznaje aplikacje bez pytania o każdą — tak jak
  dla każdego innego narzędzia. Jeśli ma być inaczej (Claude pyta zawsze),
  potrzebna decyzja i zmiana w silniku uprawnień, nie w handlerze.
- Obrazy stanu zostają w logu sesji jak dotychczasowe zrzuty Windows; ich
  wpływ na kontekst ograniczają elision i kompaktor.

**Dla następcy**
- Helper Swift (krok 4) musi mówić protokołem v5 z `rpc.ts`: te same metody i
  kształty wyników co `contract-helper.fixture.mjs`.

---

## Krok 4 — szkielet helpera Swift (2026-09-30)

Commit kroku 3: `f23b22a3`.

**Przegląd wzorca (read-only)**
- Claude.app 2.16120.0: `Contents/Helpers/app-cu-helper` — uniwersalny plik
  wykonywalny (x86_64 + arm64), dziecko aplikacji, JSON-RPC, `NSApplication`,
  kody błędów w stylu `permission_denied`, `foreign_pid`, `context_menu`.
- ChatGPT.app 26.928.21956, `@oai/sky/.../targets/mac/native-pipe.js`:
  osobna aplikacja-serwis „Codex Computer Use.app” z gniazdem w Group
  Container i JSON-RPC 2.0.
- Wybór: model Claude'a (helper-dziecko przez stdio). Uprawnienia TCC należą
  do procesu odpowiedzialnego (Moxxy.app w desktopie, terminal w CLI), nie
  potrzeba osobnej podpisanej aplikacji ani gniazda.

**Co** (`packages/plugin-computer-control/`)
- `native/macos/Package.swift` — Swift 6, macOS 14; biblioteka
  `ComputerUseCore`, plik wykonywalny `moxxy-computer`, testy
  `ComputerUseCoreTests` (Swift Testing).
- `Sources/ComputerUseCore/Wire.swift` — `JSONValue` (Sendable),
  `LineDecoder` (limit 3 MB, jak w TS), `Wire` (koperta v5 identyczna z
  `helper/protocol.ts`, komunikat błędu ≤ 2048 znaków), `ProtocolSession`
  (dekodowanie ramek; po pierwszym błędzie protokołu nic więcej).
- `Dispatcher.swift` — metoda → handler; `HelperError` przechodzi z kodem,
  inny błąd to `helper_failed` bez treści systemowej, nieznana metoda to
  `unsupported_action`.
- `Methods.swift` — `status` (`AXIsProcessTrusted`,
  `CGPreflightScreenCaptureAccess`, lista braków) i `permissions.request`
  (`AXIsProcessTrustedWithOptions` z promptem / `CGRequestScreenCaptureAccess`
  + panel Ustawień `x-apple.systempreferences:…Privacy_Accessibility` /
  `Privacy_ScreenCapture`).
- `ParentWatch.swift` — `DispatchSource.makeProcessSource(.exit)`; `nil`, gdy
  rodzic już nie żyje.
- `Sources/moxxy-computer/main.swift` — `.accessory`, wątek czytający stdin:
  sterowanie od razu (`stop` → kod 20, pauza/wznowienie zarezerwowane dla
  kroku 7), żądania w szeregowej kolejce poza wątkiem głównym, jeden zapis do
  stdout pod blokadą; EOF kończy po obsłużeniu kolejki; błąd protokołu → kod
  65; brak `--parent` → kod 64.
- `native/macos/build.sh` — `swift build -c release --arch arm64 --arch x86_64`,
  podpis ad-hoc z identyfikatorem `ai.moxxy.computer-helper`, manifest
  `{"protocolVersion":5,"architecture":"universal","sha256":…}`
  (zapisy atomowe przez `.tmp` + `mv`).
- `src/macos/profile.ts` (`macosHelperPath`), `src/backend/rpc.ts`
  (`statusResultSchema`), `src/macos/helper.test.ts`.
- `.gitignore`: `native/macos/.build/`.

**Jak i dlaczego**
- Dekodowanie i wykonanie są rozdzielone, bo transport TS wysyła pauzę/stop
  „bokiem” — sterowanie nie może czekać za długim żądaniem AX.
- Żądania nie idą na wątek główny: nakładka kursora (krok 6) będzie go
  potrzebować do animacji.
- Ogólny „deadline operacji” z planu przeniesiony do kroku 5: jedynym
  realnie blokującym wywołaniem są zapytania AX, a dla nich właściwy
  mechanizm to `AXUIElementSetMessagingTimeout`. Do tego czasu limit 15 s
  trzyma transport TS (zabija helper).

**Testy (Red → Green)**
- Red Swift: najpierw pusty target (`target 'moxxy-computer' … is empty`),
  po dodaniu pustych źródeł — `cannot find 'SystemPermissions' in scope` i
  brak typów `JSONValue`, `LineDecoder`, `ParentWatch`.
- Red TS: `Cannot find module './profile.js'`.
- W trakcie: rozdzielenie `ProtocolSession`/`Dispatcher` (patrz wyżej) —
  testy sesji przepisane przed implementacją.
- Green Swift: 23 testy w 7 zestawach (`swift test`), w tym realne
  zapytanie TCC i prawdziwy proces-rodzic (`/bin/sleep`).
- Green TS: 4 testy na prawdziwym binarium (weryfikacja artefaktu, `status`,
  nieznana metoda z kodem i dalsza obsługa, wyjście po EOF < 450 ms).
  Dopisane po Green (charakteryzujące, od razu zielone): wyjście po śmierci
  rodzica (kod 0) i brak `--parent` (kod 64).
- Błąd kompilacji po drodze: `kAXTrustedCheckOptionPrompt` nie jest
  bezpieczny współbieżnie w Swift 6 — użyta jego wartość
  `"AXTrustedCheckOptionPrompt"`.

**Walidacja**
- `cd native/macos && swift test` — 23/23.
- `./native/macos/build.sh` — `x86_64 arm64`, manifest zapisany.
- `npx vitest run` (plugin) — 25 plików / 239 testów.
- `npx tsc -p tsconfig.json --noEmit` — OK.
- `npx eslint packages/plugin-computer-control` — 0 błędów, 1 istniejące ostrzeżenie.
- `pnpm check:deps` — 0 błędów, 1 istniejące ostrzeżenie.
- `pnpm build` — 88/88.
- desktop-host `computer-update.test.ts` — 11/11; skrypty `node --test` — 9/9.

**Dla następcy**
- Test `src/macos/helper.test.ts` pomija się bez zbudowanego helpera: przed
  pracą nad macOS uruchom `packages/plugin-computer-control/native/macos/build.sh`.
- CI nie buduje jeszcze helpera macOS — do dodania razem z pakowaniem w
  kroku 10.

---

## Krok 5a — katalog aplikacji w helperze macOS (2026-09-30)

Commit kroku 4: `875ba3e8`.

**Przegląd wzorca (read-only)**
- ChatGPT.app 26.928.21956: `@oai/sky/.../targets/mac/list_apps.js` (id =
  bundle ID albo nazwa, `displayName`, `isRunning`, `lastUsedDate`,
  `useCount`), `client.js` (żądania `ComputerUseIPC…`), serwis
  `Codex Computer Use.app/Contents/MacOS/SkyComputerUseService` (napisy:
  „Removed element IDs”, `AccessibilityDifferenceLineBudgetExceeded`,
  `AXElementBusyChanged`, „values differ from index”, „Cannot set a value for
  an element that is not settable”) — wzorce dla kroków 5b–7.
- `lastUsedDate`/`useCount` pominięte: wymagają prywatnych danych Spotlight.

**Co** (`native/macos/Sources/ComputerUseCore/AppCatalog.swift`)
- `AppRecord`, `AppCatalog.merge` (uruchomione wygrywają nad zainstalowanymi
  tego samego bundle ID bez względu na wielkość liter; najpierw uruchomione,
  potem po nazwie), `page` (filtr po nazwie i ID, `truncated`), `resolve`
  (ID → nazwa, także z `.app` → ścieżka; `ambiguous`/`notFound`), `scan`
  (`NSWorkspace.runningApplications` z polityką `.regular` + katalogi
  `/Applications`, `/Applications/Utilities`, `/System/Applications`,
  `/System/Applications/Utilities`, `~/Applications`).
- Metody `list_apps {query?, limit 1–200}` i `resolve_apps {names ≤ 32}` w
  kształcie `listAppsResultSchema`/`resolveAppsResultSchema`; zły parametr →
  `invalid_params`.

**Testy (Red → Green)**
- Red: `swift test` — `cannot find type 'AppRecord' in scope`.
- Green: `swift test` — 31 testów w 9 zestawach (w tym skan prawdziwego
  systemu: Finder uruchomiony, Kalkulator zainstalowany, brak duplikatów).
- TS (`src/macos/helper.test.ts`): `list_apps`/`resolve_apps` przez transport
  na przebudowanym binarium — 7/7. Test TS dopisany przed przebudową, ale nie
  uruchomiony na starym binarium (Red pokazał Swift).

**Walidacja**
- `swift test` 31/31; `native/macos/build.sh` OK; `npx vitest run` (plugin)
  25 plików / 240 testów; eslint 0 błędów; `pnpm check:deps` 0 błędów;
  `pnpm build` 88/88.
