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

---

## Krok 5b — drzewo AX i uruchamianie w tle (2026-09-30)

Commit kroku 5a: `b9445f85`.

**Co** (`native/macos/`)
- `Sources/ComputerUseFixture/main.swift` + `build-fixture.sh` — testowa
  aplikacja AppKit (pole tekstowe z placeholderem, pole hasła, przycisk
  zmieniający etykietę, checkbox, lista rozwijana, wyłączony przycisk,
  zagnieżdżone `NSStackView`). Skrypt składa `.build/fixture/
  MoxxyComputerFixture.app` (`ai.moxxy.computer-fixture`), podpisuje ad-hoc i
  rejestruje w LaunchServices (`lsregister -f`). Nigdy nie jest pakowana.
- `Tree.swift` (czysta logika) — `NodeSnapshot`, `TreeBuilder.build`
  (spłaszcza kontenery układu bez nazwy/wartości/akcji, pomija paski
  przewijania, rola z `AXRoleDescription`, tekst statyczny jako tytuł,
  checkbox → stan `checked`, placeholder → opis, akcje bez oczywistych
  `AXPress`/`AXScrollToVisible`/`AXShowDefaultUI`/`AXShowAlternateUI`, klucz =
  ścieżka `rola:identyfikator|tytuł|#pozycja`, kolizje `~n`, limit →
  `truncated`), `IndexRegistry` (indeks żyje razem z kluczem, nigdy nie
  wraca do innego elementu).
- `AXReader.swift` — odczyt okna (`AXFocusedWindow` → `AXMainWindow` →
  pierwsze z `AXWindows`), `AXUIElementSetMessagingTimeout` 1 s (to jest
  „deadline operacji” z kroku 4), limity 4000 węzłów / głębokość 64; dla
  `AXSecureTextField` wartość w ogóle nie jest czytana.
- `AppState.swift` — `Targets`/`TargetState` (rejestr indeksów i żywe
  elementy AX dla wykonawcy z kroku 7), `AppLauncher` (`NSWorkspace
  .openApplication` z `activates = false`, czekanie na
  `isFinishedLaunching` i pierwsze okno do 5 s; proces, który właśnie się
  zamyka, jest uruchamiany ponownie), metoda `get_app_state {app,
  screenshot}` → `{tree, screenshotUnavailable?}`; brak zaufania AX →
  `permissions_not_granted`, nieznane ID → `app_not_found`, aplikacja bez
  okna → puste drzewo z przyczyną.

**Jak i dlaczego**
- Budowniczy drzewa jest czystą funkcją na danych `NodeSnapshot`, więc logikę
  testuje się bez AX. Prawdziwy AX sprawdza test integracyjny na fixture.
- Klucz opiera się na identyfikatorze lub prawdziwym tytule, nigdy na
  wartości — etykieta „Ready” → „Pressed 1” nie zmienia indeksu.
- Znalezisko z debugowania: test zabijał fixture i od razu pytał o stan;
  helper trafiał na umierający proces i 5 s czekał na okno. Poprawka dotyczy
  helpera (wykrycie `ESRCH` i ponowne uruchomienie), bo to realny przypadek
  „użytkownik właśnie zamknął aplikację”; test czeka też na zamknięcie.

**Testy (Red → Green)**
- Red Swift: `cannot find type 'NodeSnapshot' in scope`.
- Red TS: 2 testy na fixture czerwone — brak okna (opisany wyżej błąd
  uruchamiania), potem różnica nazwy roli (`checkbox`, nie `check box`,
  zgodnie z macOS) poprawiona w teście.
- Green: `swift test` 39/39; `src/macos/helper.test.ts` 10/10 (fixture
  uruchamiana w tle, drzewo bez `group`, wartość hasła nigdzie w JSON,
  indeksy stałe między obserwacjami, `app_not_found`).

**Walidacja**
- `swift test` 39/39; `build.sh` + `build-fixture.sh` OK; `npx vitest run`
  (plugin) 25 plików / 243 testy; `tsc --noEmit` OK; eslint 0 błędów;
  `pnpm check:deps` 0 błędów; `pnpm build` 88/88.

**Dla następcy**
- Przed testami macOS: `native/macos/build.sh` i `native/macos/build-fixture.sh`.
- Pasek tytułu (przyciski zamknij/minimalizuj/pełny ekran, tytuł) trafia do
  drzewa — celowo, bo model może ich potrzebować.

---

## Krok 5c — obraz okna (2026-09-30)

Commit kroku 5b: `582234da`.

**Co** (`native/macos/Sources/ComputerUseCore/`)
- `Capture.swift`:
  - `ImageBudget.fit` — ten sam algorytm co `imageBudget` w TS (test
    parametryczny z wartościami policzonymi przez `dist/contract/image.js`:
    2880×1800 → 1389×868, 5120×2880 → 1456×819, 1568×1568 → 1092×1092 …).
  - `CoordinateFrame` — okno w globalnych punktach (górny-lewy początek,
    także ujemny) ↔ piksele obrazu; `imageRect(of:)` przycina element do
    okna, `screenPoint(x:y:)` dla akcji po współrzędnych (krok 7).
  - `WindowMatch.best` — `SCWindow` dla okna AX po pid + ramce (±2 pt) +
    tytule, bez prywatnego `_AXUIElementGetWindow`.
  - `WindowCapture.capture` — `SCShareableContent` →
    `SCContentFilter(desktopIndependentWindow:)` (samo okno, także
    zasłonięte/w tle), rozmiar = budżet z `pointPixelScale`, bez kursora i
    cienia, JPEG q=0,8; `Blocking.run` łączy async ScreenCaptureKit z
    synchroniczną kolejką żądań (limit 5 s → `timeout`).
- `AXReader.frame` (`AXPosition` + `AXSize`, z kontrolą typu `AXValue`),
  `NodeSnapshot.frame`/`TreeElement.frame`.
- `get_app_state` z `screenshot: true` → `screenshot {mediaType
  image/jpeg, base64, width, height}` i `frame` każdego widocznego elementu
  w pikselach obrazu; `TargetState.frame` zapamiętuje ramkę dla akcji. Brak
  Screen Recording lub błąd przechwycenia → `screenshotUnavailable` z
  przyczyną (stan drzewa i tak wraca).

**Testy (Red → Green)**
- Red: `cannot find 'ImageBudget' / 'WindowCandidate' / 'CoordinateFrame' in scope`.
- Green: `swift test` 46/46; integracja `src/macos/helper.test.ts` 11/11
  (JPEG `FF D8 FF`, rozmiar już w budżecie, ramka „Press” w granicach
  obrazu).
- Sprawdzenie wzrokowe: zrzut 920×504 zawiera tylko okno fixture, ramka
  „Press” (`x30 y222 120×52`) pokrywa się z przyciskiem.

**Walidacja**
- `swift test` 46/46; `build.sh` OK; `npx vitest run` (plugin) 25 plików /
  244 testy; `tsc --noEmit` OK; eslint 0 błędów; `pnpm check:deps` 0 błędów;
  `pnpm build` 88/88.

---

## Krok 5d — settling i adapter macOS w TS (2026-09-30)

Commit kroku 5c: `98a5ec9b`.

**Co**
- `native/macos/Sources/ComputerUseCore/Settle.swift`:
  - `SettlePolicy` (`afterAction`: min 1 s, cisza 0,3 s, max 5 s;
    `observeOnly`: bez minimum), `SettleClock` (czysta decyzja
    `isSettled`/`nextCheck` w funkcji czasu).
  - `BusyProbe` — spinner `AXBusyIndicator` w oknie albo `AXElementBusy`
    wydłuża czekanie (pasek postępu z wartością nie, bo może być stanem
    końcowym).
  - `Settler` — `AXObserver` na aplikacji (zmiana wartości, utworzenie i
    usunięcie elementu, układ, fokus, tytuł, zaznaczenie, liczba wierszy,
    `AXElementBusyChanged`, `AXLoadComplete`) na głównej pętli; każde
    zdarzenie budzi czekającego (semafor), a między zdarzeniami decyduje
    `SettleClock`. Kontekst callbacku jest trzymany do zdjęcia źródła i
    zwalniany na wątku głównym (bez wyścigu z trwającym callbackiem).
- `get_app_state` czeka jak po akcji, gdy właśnie uruchomił aplikację albo
  `TargetState.lastAction` (ustawi wykonawca w kroku 7) jest świeże; inaczej
  tylko do braku spinnera.
- Fixture: spinner przez 1,2 s po starcie, potem etykieta „Loaded”.
- `src/macos/profile.ts` — `macosProfile` (`PlatformProfile` dla darwin:
  helper, protokół v5, weryfikacja artefaktu, limit 30 s na żądanie, bo
  uruchomienie + settling + zrzut mogą trwać kilka sekund).

**Jak i dlaczego**
- „Cisza” wymaga zegara z natury; zdarzenia AX skracają czekanie, a sonda
  spinnera co 0,25 s działa tylko wtedy, gdy aplikacja sama pokazuje, że
  ładuje.
- Twarde maksimum 5 s jak u Codexa: model dostaje stan, a nie czeka bez
  końca.

**Testy (Red → Green)**
- Red Swift: `cannot find 'SettlePolicy' / 'SettleClock' / 'BusyProbe'`.
- Red TS: stan fixture wracał po 823 ms bez „Loaded”; potem
  `Cannot read properties of undefined (reading 'helperPath')` (brak
  `macosProfile`).
- Po drodze: dwa testy `SettleClock` padły przez arytmetykę
  zmiennoprzecinkową w samych testach (1,2 − 0,9 < 0,3) — przepisane na
  wartości dokładne binarnie (0,25; 0,875; 1,125).
- Green: `swift test` 53/53; `src/macos/helper.test.ts` 13/13, w tym
  „czeka na załadowanie świeżo uruchomionej aplikacji” (< 6 s, jest
  „Loaded”, brak spinnera) i end-to-end `ComputerBackend` z `macosProfile`
  (zgoda na fixture `full`, stan jako JPEG + tekst z `button "Press"`, bez
  hasła).

**Walidacja**
- `swift test` 53/53; `build.sh` i `build-fixture.sh` OK.
- `npx vitest run` (plugin) — 25 plików / 246 testów.
- `tsc --noEmit` OK; eslint 0 błędów (1 istniejące ostrzeżenie);
  `pnpm check:deps` 0 błędów; `pnpm build` 88/88.
- desktop-host `computer-update.test.ts` 11/11; skrypty `node --test` 9/9.

**Dla następcy**
- Wybór okna przez `window_id` na macOS nie jest jeszcze obsługiwany
  (bierzemy okno z fokusem → główne → pierwsze); do rozważenia przy
  wielookienkowych aplikacjach.

---

## Krok 6 — kursor agenta na macOS (2026-09-30)

Commit kroku 5d: `bc45e9bb`.

**Wzorzec (Codex, tylko odczyt)**
- `~/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService`
  (`nm -gU | swift demangle`, `strings`): klasa `ComputerUse.ComputerUseCursor`
  z `move(to:aboveWindowID:relativeToWindow:nextInteractionTiming:animated:fadeIn:isDelegate:)`,
  `show(aboveWindowID:)`, `press(count:delay:)`, `orderOut()`,
  `targetWindowID`, stany `isMoving/isPressed/isPaused/isLoading`,
  `MotionConfiguration` (łuk: `arcSize`, `arcFlow`, `straightPathDistanceThreshold`;
  sprężyna: `springResponseScaler/Min/Max`, `springDampingFraction`;
  `boundsMargin`), `CloseEnoughConfiguration`. Wniosek: kursor to osobne okno
  porządkowane nad oknem celu, ruch po łuku z czasem zależnym od odległości,
  krótkie skoki prosto.
- Własny kod: prostsza wersja — łuk Béziera zamiast sprężyny, bez „scoot”.

**Co**
- SDK `computer-control.ts`: `computerCursorPhaseSchema`
  (`idle|moving|executing|delivered|failed`), `computerCursorSchema`
  (`{phase, x, y}`, x/y jako ułamek okna celu 0…1), `computerTargetSchema`
  (`{app, window|null}`); w `computerControlSnapshotSchema` opcjonalne
  `cursor` i `target`. Typy `ComputerCursor`, `ComputerTarget`.
- `src/backend/turn-controls.ts`: `cursor(session, turn, cursor|null)`,
  `target(session, turn, {app, window})` (przycina nazwy do 160/200 znaków).
  Snapshot nie pokazuje kursora po Stop, po awarii helpera ani po `null`.
- `src/backend/rpc.ts`: `cursorEventSchemaFor(version)` (zdarzenie
  `{version, event:"cursor", cursor:{…}|null}`) i `contractEventsFor(version)`
  — jeden rejestr zdarzeń dla każdego klienta helpera v5.
- `src/backend/backend.ts`: rejestruje zdarzenia kontraktu, kieruje `cursor`
  do `TurnControls` tej tury, a po każdym stanie ustawia `target`
  (nazwa z zgody + tytuł okna z drzewa).
- Swift `Cursor.swift`: `CursorPhase`, `OverlayGeometry` (prostokąt ekranu →
  ramka AppKit z marginesem, punkt → ułamek okna, ułamek/prostokąt → punkt
  w widoku), `CursorMotion` (czas 0,18–0,5 s rosnący z odległością, 0 przy
  Reduce Motion; prosto < 40 pt, dalej łuk w lewo od kierunku ruchu,
  maks. 60 pt), `CursorEvent.frame`. `Wire.event(name, fields)`.
- Swift `CursorOverlay.swift` (`@MainActor`): `NSPanel` bez ramki,
  `nonactivatingPanel`, `ignoresMouseEvents`, `sharingType = .none`,
  `hidesOnDeactivate = false` (helper nigdy nie jest aktywną aplikacją),
  `order(.above, relativeTo: windowID)`; warstwy: strzałka w kolorze
  `color.primary` (#D62A00) z białą obwódką, pierścień naciśnięcia, obrys
  elementu. `show/move/press/outline/hide`.
- Swift `AgentCursor.swift`: `AgentCursor` (pozycja kursora w ułamku okna,
  zmiany na wątku głównym przez `DispatchQueue.main.sync`, wysyła zdarzenie
  `cursor`), `WindowDirectory.onScreenWindowID` (numer okna z
  `CGWindowListCopyWindowInfo` dopasowany jak zrzut: pid + ramka + tytuł).
- `get_app_state` pokazuje kursor nad obserwowanym oknem i wysyła
  `cursor {phase: idle}` przed odpowiedzią. `main.swift` podaje
  `AgentCursor(emit: output.write)`; testy jednostkowe `Methods` bez kursora.

**Jak i dlaczego**
- Nakładka to jedno okno wielkości okna celu (+24 pt marginesu), a nie małe
  okno przesuwane za kursorem: ruch, pierścień i obrys to animacje warstw w
  jednym oknie, a okna leżące nad celem zasłaniają kursor tak jak cel.
- Pozycja jako ułamek okna: PiP (krok 11) rysuje ją nad strumieniem okna bez
  znajomości ekranu i skali.
- Okno na innej przestrzeni Spaces albo zminimalizowane nie dostaje nakładki
  (wisiałaby nad czymś innym), ale zdarzenie `cursor` idzie zawsze — PiP
  pokazuje okno także spoza ekranu. Wyszło to w teście: na tym komputerze
  bieżąca przestrzeń to aplikacja pełnoekranowa, a fixture otwiera się na
  pulpicie.
- Pola `cursor`/`target` są opcjonalne, żeby snapshoty starego backendu
  Windows dalej przechodziły. Runner przesyła je dopiero, gdy macOS przejdzie
  na nowy backend (krok 10); podbicie protokołu runnera jest w kroku 9.

**Testy (Red → Green)**
- Red SDK: nowy test snapshotu z `cursor`/`target` — schemat `strict`
  odrzucał pola.
- Red TS `turn-controls.test.ts`: `controls.target is not a function`,
  `controls.cursor is not a function`.
- Red TS `backend.test.ts`: helper-fixture wysyła `cursor` przy
  `get_app_state` → „protocol mismatch” (zdarzenie niezarejestrowane),
  6 testów czerwonych.
- Red Swift: `cannot find 'CursorMotion' / 'OverlayGeometry' / 'CursorEvent'`
  (+ `CursorOverlay`).
- Red TS `src/macos/helper.test.ts` (prawdziwy helper + fixture): brak
  zdarzenia `cursor`; po jego dodaniu stare testy padały, bo ich transport
  nie rejestrował zdarzenia → wspólne `contractEventsFor`.
- Testy `move/press/outline` nakładki dopisane po implementacji; sprawdzone
  mutacją (pozycja końcowa, brak animacji naciśnięcia, zły obrys) — wszystkie
  3 mutacje wykryte, kod przywrócony.
- Green: SDK 3/3 w pliku; `turn-controls` 5/5; backend 49/49 w
  `src/backend`; Swift 63/63 (w tym kolejność okien: panel dokładnie nad
  oknem celu, `kCGWindowSharingState == 0`); macOS integracja 14/14.

**Walidacja**
- `swift test` 63/63; `native/macos/build.sh` OK.
- `npx vitest run` (plugin) — 25 plików / 250 testów.
- `pnpm --filter @moxxy/sdk test` 47 plików / 464; `pnpm --filter
  @moxxy/runner test` 12 / 158; desktop `src/computer-control` 3/3;
  desktop-host `src/computer*` 12/12.
- `tsc --noEmit`: plugin, SDK, runner, desktop OK. Testy pluginu przez
  tymczasowy tsconfig: jedyny błąd w starym `src/tools/screenshot.test.ts`
  (istniał przed zmianą, plik do usunięcia w kroku 10).
- `pnpm lint` 0 błędów (96 ostrzeżeń, żadne nowe); `pnpm check:deps`
  0 błędów (1 istniejące ostrzeżenie `no-orphans` w desktop-host);
  `pnpm build` 88/88.
- Ręcznie: panel `order(.above, relativeTo:)` względem okna innej aplikacji
  (Arc na pełnym ekranie) trafił nad grupę jej okien (nad oknem-dzieckiem
  paska tytułu, co jest poprawne dla okien potomnych).

**Dla następcy**
- Kolejność nad oknem innej aplikacji spoza trybu pełnoekranowego trzeba
  jeszcze potwierdzić na fixture widocznej na bieżącej przestrzeni (krok 7
  albo benchmark w kroku 14).
- Pauza nie przyciemnia jeszcze kursora; fazy `moving/executing/…` wysyła
  wykonawca akcji w kroku 7 (`AgentCursor` dostanie `move/press/outline`).
- Przy pełnoekranowym zrzucie (krok 8) wykluczać własną aplikację filtrem
  `SCContentFilter`, nie polegać na `sharingType = .none` (od macOS 15
  ScreenCaptureKit może go nie respektować).

---

## Krok 7a — akcje AX po indeksie (2026-09-30)

Commit kroku 6: `467542f1`.

**Wzorzec (tylko odczyt)**
- Claude 2.16120.0, `.vite/build/index.chunk-DkY0FFgk.js` (napisy): odmowa,
  gdy użytkownik właśnie pisze („akcja NIE została wykonana, ponów po
  przerwie”); przeciąganie jako surowe wejście na chwilę aktywuje aplikację i
  przywraca poprzednią; w tle tylko return/escape/backspace/delete/cmd+a;
  okno na innej przestrzeni nie jest sterowalne w tle; nakładka przechwycona
  w hit-teście = „Retry”; kliknięcia w Dock/pulpit odrzucane. Te reguły
  wchodzą w 7b–7d.
- Codex (`SkyComputerUseService`, symbole): `prepareToInteract(with:cursorNextInteractionTiming:positionElement:)`,
  `positionElement`, `moveMouse(to:cursorNextInteractionTiming:)` — kursor
  jedzie do elementu także przy akcjach AX.

**Co**
- Swift `Action.swift` (czyste): `ActionRequest.parse` (click po indeksie
  lub punkcie, `set_value`, `perform_secondary_action`; reszta
  `notYetSupported`), `ActionResult` (JSON jak `actionResultSchema`),
  `AXLadder.click` (tylko pojedynczy klik bez modyfikatorów ma odpowiednik AX:
  lewy → `AXPress`, prawy → `AXShowMenu`, jeśli element je ma) i
  `AXLadder.outcome` (fail-closed: tylko `actionUnsupported`/`attributeUnsupported`
  pozwala na inną metodę; `invalidUIElement` → `stale_state`,
  `cannotComplete` → `timeout` bez powtórki, `apiDisabled` →
  `permissions_not_granted`, reszta → `helper_failed`).
- Swift `Act.swift`: metoda `act {app, action, allowed}`. Helper sam
  sprawdza `allowed` (`app_not_allowed`), bez obserwacji → `no_state`,
  indeks spoza ostatniego stanu albo martwy element → `stale_state`,
  akcja drugorzędna tylko z listy elementu, `set_value` tylko na atrybucie
  zapisywalnym (liczby dla suwaków/stepperów). Po akcji `lastAction`
  (settling jak po akcji) i świeży stan ze zrzutem w odpowiedzi.
- `AgentCursor.act`: `moving` → przejazd (czeka czas przejazdu) + obrys →
  `executing` → akcja → pierścień przy `delivered` → `delivered|failed`.
- `TargetState`: `window` (dla nakładki), `observed`.
- `AppCatalog.resolve(…, lookup:)` + `registered(id)`: identyfikator pakietu
  spoza skanowanych katalogów rozwiązywany przez LaunchServices, z nazwą z
  pakietu (jak dla działającej aplikacji). Tylko identyfikatory, nigdy nazwy.
- Fixture: `NSStepper` „count” (akcje `AXIncrement`/`AXDecrement`).

**Jak i dlaczego**
- Kliknięcia wielokrotne, z modyfikatorami i środkowym przyciskiem nie mają
  odpowiednika AX — pójdą przez fizyczne wejście z bramkami (7c). Do tego
  czasu zwracają `unsupported`, tak samo klik po punkcie.
- `cannotComplete` bywa zwracany, gdy akcja otworzyła modalny dialog: akcja
  mogła się wykonać, więc nie powtarzamy jej; model patrzy na świeży stan.
- Luka w `resolve_apps` wyszła przy pojedynczym uruchomieniu testu
  end-to-end: niedziałająca fixture (w `.build`) nie była znajdowana, choć
  LaunchServices ją zna. Wcześniej test przechodził tylko dzięki
  kolejności.

**Testy (Red → Green)**
- Red Swift: `cannot find 'AXLadder' / 'ActionRequest' / 'ActionResult'`;
  potem `extra argument 'lookup' in call`.
- Red TS (prawdziwy helper + fixture): `Unknown method act` (4 testy);
  end-to-end w izolacji: `granted: []`.
- Green: Swift 70/70; `src/macos/helper.test.ts` 18/18 — klik „Press” przez
  AX (`Pressed N+1`, fazy kursora `moving, executing, delivered`),
  `set_value` → „world”, `AXIncrement` na stepperze, odmowy (`AXRaise` nie z
  listy → `unsupported_action`, indeks 9999 → `stale_state` ze świeżym
  stanem, aplikacja spoza `allowed` → `app_not_allowed`, akcja przed
  obserwacją → `no_state`), `computer_click` przez narzędzie modelu.

**Walidacja**
- `swift test` 70/70; `build.sh`, `build-fixture.sh` OK.
- `npx vitest run` (plugin) — 25 plików / 254 testy.
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów; `pnpm check:deps`
  0 błędów; `pnpm build` 88/88.

**Dla następcy**
- 7b: klawiatura i tekst (`type_text`, `press_key`, `paste`,
  `select_text`) — zdecydować, czy TS wysyła do helpera już sparsowany
  akord (`parseKeyCombo`), żeby nie dublować parsera w Swift.
- 7c: fizyczna mysz z bramkami i przywracaniem wskaźnika; tu wraca fallback
  z `AXLadder` (`physical`/`fallBack`).
