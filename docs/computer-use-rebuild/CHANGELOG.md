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

---

## Krok 7b — klawiatura, tekst, wklejanie, zaznaczanie (2026-09-30)

Commit kroku 7a: `30813364`.

**Wzorzec**
- Claude (`index.chunk-DkY0FFgk.js`): w tle działają tylko return, escape,
  backspace, delete i cmd+a; pozostałe skróty ⌘ wymagają paska menu.
  Potwierdzone sondą na fixture: w nieaktywnej aplikacji pozycje menu Edycja
  mają `AXEnabled = 0`, więc ani `postToPid` z ⌘, ani `AXPress` na pozycji
  menu nic nie robią.
- Sonda (nieaktywna fixture na innej przestrzeni): `AXSelectedText` wstawia
  tekst w miejscu kursora tekstowego, a `CGEvent.postToPid` dostarcza zwykłe
  klawisze do pola z fokusem — bez aktywowania aplikacji.
- Użytkownik potwierdził: klawiatura QWERTY, kopiowanie ⌘C, wklejanie ⌘V.
  Układ nie był przyczyną porażki ⌘ w tle; wyszukiwanie klawisza w
  bieżącym układzie zostaje dla układów innych niż US (np. QWERTZ).

**Co**
- TS `backend.ts` `forHelper`: do kroku dla helpera dochodzi `chord`
  (z `key`) i `held` (z `modifiers`) z jedynego parsera xdotool —
  helpery nie parsują składni klawiszy.
- Swift `Keyboard.swift` (czyste): `KeyCodes.named` (neutralne nazwy →
  kody wirtualne, Insert → Help), `KeyCodes.ansi` (zapas US), `KeyChord`
  (`parse`, `isSelectAll`, `needsMenuBar`), `TextLocator` (dopasowanie w
  UTF-16, `prefix`/`suffix`, `notFound`/`ambiguous(n)`), `Typing.chunks`
  (≤ 20 jednostek UTF-16 na zdarzenie, bez rozcinania znaków).
- Swift `KeyboardInput.swift`: zdarzenia z prywatnym stanem źródła,
  oznaczone `eventSourceUserData` (dla strażnika w 7d), wysyłane
  `postToPid`; `KeyLayout` (bieżący układ przez `UCKeyTranslate` na wątku
  głównym); `Clipboard` (zdjęcie wszystkich typów, zapis z oznaczeniem
  `org.nspasteboard.TransientType`, zwykły tekst jako zapas dla HTML,
  przywrócenie po 0,5 s tylko gdy użytkownik nic nie skopiował).
- Wykonawca: `type_text` (fokus tylko gdy element go nie ma — fokus w polu
  zaznacza całość; AX w miejscu kursora; zapas: zdarzenia porcjami z
  kontrolą fokusu między porcjami i podpowiedzią „wpisano X z Y”),
  `press_key` (⌘A → zaznaczenie całości przez AX; inne ⌘ poza przodem →
  `not_frontmost`; reszta przez `postToPid`), `paste` (tekst/MD przez AX bez
  schowka; HTML przez schowek i ⌘V tylko z przodu), `select_text`
  (zaznaczenie, kursor przed/po; pola haseł odmowa).
- `ActionResult.hint` — konkretna podpowiedź helpera zamiast ogólnej.
- Fixture: menu Edycja (Cofnij, Wytnij, Kopiuj, Wklej, Zaznacz wszystko), jak
  w każdej prawdziwej aplikacji.

**Testy (Red → Green)**
- Red TS: helper nie dostawał `chord` (`toMatchObject`).
- Red Swift: `cannot find 'KeyChord' / 'KeyCodes' / 'TextLocator' /
  'Typing'`, brak przypadków `typeText/pressKey/paste/selectText`; potem
  brak `isSelectAll/needsMenuBar`; potem `extra argument 'to'` (schowek).
- Red TS (helper + fixture): nowe kroki `unsupported`, brak `hint`; po
  pierwszej implementacji ⌘A i ⌘V przez `postToPid` nie działały (`'aZ'`,
  `'x'`) — przyczyna w menu nieaktywnej aplikacji, nie w kodzie klawiszy.
- Green: Swift 81/81; `src/macos/helper.test.ts` 22/22 (zaznaczanie i
  pisanie przez AX z aplikacją w tle, BackSpace przez zdarzenia, ⌘A przez
  AX, ⌘C w tle → `not_frontmost`, wklejenie tekstu bez zmiany schowka, HTML
  w tle → `not_frontmost`, powtórzony tekst → podpowiedź z liczbą);
  backend 50/50.

**Walidacja**
- `swift test` 81/81; `build.sh`, `build-fixture.sh` OK.
- `npx vitest run` (plugin) — 25 plików / 259 testów.
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów; `pnpm check:deps`
  0 błędów; `pnpm build` 88/88 (dist zawiera `forHelper`).

**Pominięcia i dla następcy**
- Pełna ścieżka HTML ⌘V (aplikacja z przodu) nie ma testu end-to-end:
  wymagałaby wyciągnięcia fixture na wierzch w trakcie pracy użytkownika.
  Części schowka są przetestowane na prywatnym schowku. Test z aktywacją
  dojdzie w 7c razem z krótką aktywacją aplikacji dla skrótów ⌘ (z
  kontrolą, czy użytkownik właśnie nie pisze — wzorzec Claude).
- `type_text`/`paste` po punkcie (x, y) — 7c (fizyczny klik ustawia fokus).

---

## Krok 7c — fizyczna mysz z bramkami (2026-10-01)

Commit kroku 7b: `01d8bff0`.

**Wzorzec**
- Claude (`dk.pretty.js`, `pixelCompare`): łatka wokół punktu o boku 9
  (`de=9`), przycięta przy krawędzi obrazu, porównana z zapisanym zrzutem —
  zmiana = odmowa kliknięcia po współrzędnych. Tolerujemy jedną kolumnę
  różnych pikseli (migający kursor tekstowy).
- Claude: `user_actively_typing` — aplikacji nie wyciąga się na wierzch,
  gdy użytkownik właśnie pisze (u nas: < 1 s od ostatniego klawisza →
  `user_intervened`); komunikaty o Docku i pulpicie („mogą otworzyć
  aplikacje spoza zgody”).
- Codex (`@oai/sky`): przewijanie stronami przez `AXScroll{Up,Down,Left,Right}ByPage`.
  Sonda na fixture: `NSScrollView` ogłasza tę akcję, ale odrzuca ją (-25205),
  więc dochodzi krok paska przewijania (`AXValue` 0…1 z `AXContentSize`),
  który działa w tle.

**Co**
- `Pointer.swift` (czyste): `HitTest.owner` (okno pid wskazanego przez AX,
  inaczej pulpit), `PointerGate.check` (punkt na ekranie, pulpit, Dock,
  własny proces hosta, inna aplikacja → `point_outside_frame` /
  `hit_test_mismatch` / `own_window` z podpowiedzią), `PixelPatch` (9×9,
  tolerancja kanału 24), `MouseScript` (klik z `mouseEventClickState`,
  drag po ścieżce w 60 Hz rozłożony na `duration_ms`, pojedyncze kroki
  down/move/up), `ScrollPlan` (strony AX, wartość paska, kółko w pikselach
  po ≤ 120, 0,9 widoku na stronę), `ActivationGate`.
- `MouseInput.swift`: `ScreenLayout` (okna z `CGWindowList`, hit-test przez
  `AXUIElementCopyElementAtPosition` systemowo — prostokąt okna Docka
  obejmuje cały ekran, kształty zna tylko AX), `PointerSession` (zdarzenia
  na `.cghidEventTap` z prywatnym źródłem i znacznikiem `0x6D6F7878`,
  przywrócenie wskaźnika `CGWarpMouseCursorPosition` +
  `CGAssociateMouseAndMouseCursorPosition` po 0,05 s; przy trzymanym
  przycisku dopiero po `up`; `release()` przy końcu helpera, Stop i śmierci
  rodzica), `Foreground` (`kAXFrontmostAttribute` + `AXRaise`, do 2 s na
  `isActive` i okno na ekranie; `NSWorkspace.frontmostApplication` w
  helperze bywa nieaktualne).
- `Action.swift`: modyfikatory jako `CGEventFlags` (wspólne
  `KeyCodes.flags` z parserem akordów), przypadki `scroll`, `drag`,
  `mouse`; `AXLadder.pointClick` (kontrolki do naciśnięcia przez AX pod
  punktem); `ActionResult.ineffective`.
- `Act.swift` (wykonawca): kolejność bramek dla punktu — stan → punkt w
  obrazie → okno w tym samym miejscu (±2 pt) → łatka pikseli → wyciągnięcie
  na wierzch (po nim ponowne celowanie) → hit-test → kursor → zdarzenia.
  Klik po punkcie najpierw próbuje AXPress kontrolki pod punktem (w tle).
  Pisanie i wklejanie po punkcie trafia w pole tekstowe pod punktem albo
  zwraca `unsupported` z podpowiedzią. `mouse` bez wciśniętego przycisku
  (hover) jest odrzucany, bo wskaźnik zawsze wraca do użytkownika.
- `Capture.swift`/`AppState.swift`: piksele RGBA (sRGB) ostatniego zrzutu w
  stanie celu; `AXReader`: `element(at:pid:)`, `takesText`, `lineage`,
  `scrollArea`, `contentSize`.
- `main.swift` helpera: wspólna `PointerSession`, `leave(code)` zwalnia
  przycisk przed wyjściem; `Methods.standard` dostaje pid hosta (rodzic).
- Fixture: płótno „Pad” (raportuje down/drag/up/wheel z modyfikatorami),
  przewijana lista 200×3000 w widoku 200×80 i etykieta „Offset”.

**Testy (Red → Green)**
- Red Swift: brak `HitTest`/`PointerGate`/`PixelPatch`/`MouseScript`/
  `ScrollPlan`/`ActivationGate`, brak przypadków `scroll`/`drag`/`mouse`.
  Po pierwszej implementacji hit-test z prostokątów okien wskazywał Dock w
  każdym punkcie — przepisany test na pid z AX (Red → Green).
- Red `barValue` przed krokiem paska (AX strony zwracały -25205, a kod
  raportował `delivered`).
- Red TS (6 nowych testów w `helper.test.ts`): uruchomione na starym helperze
  zbudowanym w tymczasowym worktree z `01d8bff0` — wszystkie 6 zwróciły
  `unsupported`.
- Green: `swift test` 99/99 (37 zestawów); `src/macos/helper.test.ts` 28/28:
  AXPress po punkcie w tle, pisanie w pole pod punktem i odmowa poza polem,
  `point_outside_frame` i `screen_changed`, podwójny klik z shiftem przez
  prawdziwy wskaźnik („Pad up 2 after 0 moves shift”) z powrotem wskaźnika,
  drag 200 ms i down/move/up z odmową hovera, przewinięcie listy przez AX
  (offset > 0) i płótna kółkiem.
- Refactor: usunięty nieużywany parametr `allowWhileHeld`; porównanie
  pozycji wskaźnika w testach z tolerancją 1 pt (gładzik zostawia wskaźnik
  między punktami, przywrócenie zaokrągla); limit 30 s dla zestawu akcji na
  fixture (każda akcja czeka ≥ 1 s na settling, jak u Codexa — 7 wywołań
  przekraczało domyślne 10 s).

**Walidacja**
- `swift test` (w `native/macos`) — 99/99; `./build.sh` OK (universal).
- `npx vitest run` (plugin) — 25 plików / 265 testów.
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów (96 ostrzeżeń, żadne z
  plików kroku); `pnpm check:deps` 0 błędów (1 wcześniejsze ostrzeżenie
  `no-orphans` w `desktop-host`); `pnpm build` 88/88.

**Pominięcia i dla następcy**
- Testy fizycznego wejścia na chwilę zabierają prawdziwy wskaźnik i mogą
  przełączyć przestrzeń/aplikację; gdy użytkownik pisze w trakcie testów,
  bramka `user_intervened` słusznie je blokuje (wynik `blocked`).
- Łatka 9×9 nie widzi zmian poza sobą (tak samo u Claude'a).
- Po wyciągnięciu na wierzch aplikacja docelowa zostaje z przodu;
  poprzedniej nie przywracamy, bo zamknęłoby to otwarte menu.
- Hover nie jest wspierany (wskaźnik wraca po każdej akcji).
- **Ryzyko:** dwa helpery jednocześnie potrafią zawiesić ScreenCaptureKit
  (odtworzone także na helperze z 7b). Test `screen_changed` zmienia pole
  przez System Events zamiast drugiego helpera. Osobne zadanie: „Fix
  ScreenCaptureKit hang with two macOS helpers”.
- 7c2: `computer_hold_key`, skróty ⌘ przez krótką aktywację z kontrolą
  pisania, test HTML ⌘V z aplikacją z przodu. 7d: strażnik, brak postępu,
  cache `unsupported`, ochrona okna zapisu.

---

## Krok 7c2 — przytrzymanie klawisza i skróty ⌘ z przodu (2026-10-01)

Commit kroku 7c: `2e9344cb`.

**Wzorzec**
- Claude (`dk.pretty.js`, `holdKey`): klawisze akordu w dół, czekanie w
  odcinkach ≤ 50 ms ze sprawdzaniem przerwania, zwolnienie zawsze (także po
  przerwaniu: „Key hold aborted (user interrupt)”); czas 0–100 s; akord
  systemowy wymaga `systemKeyCombos` (u nas sprawdza to już host, krok 3).
- Claude (`user_actively_typing`): akcja, która chwilowo wyciąga aplikację na
  wierzch, jest odrzucana, gdy użytkownik pisze. Claude robi to niewidocznie
  przez prywatne API; my bez SkyLight wyciągamy aplikację widocznie i
  zostawiamy ją z przodu (jak w 7c).

**Co**
- `Keyboard.swift` (czyste): `KeyEvent` i `KeyScript.hold` — modyfikatory w
  stałej kolejności (ctrl, alt, shift, cmd), każdy dokłada swoją flagę, potem
  klawisz (z Shiftem, gdy wymaga go układ); zwolnienie w odwrotnej kolejności.
- `KeyboardInput.swift`: `stroke(for:)` (klawisz akordu w bieżącym układzie),
  `post(KeyEvent)`, `KeySession` — trzyma należne zwolnienia; `release()`
  wysyła je dokładnie raz i budzi czekanie (semafor), więc Stop kończy
  przytrzymanie od razu. Zdarzenia idą `postToPid` (aplikacja w tle).
- `Action.swift`: `.holdKey(chord, duration)` z `duration_s` (0 < d ≤ 100).
- `Act.swift`: `hold_key`; `inFront` — skróty ⌘ (`press_key`, `hold_key`) i
  wklejanie HTML wyciągają aplikację przez `Foreground.bring` (odmowa
  `user_intervened`, gdy użytkownik pisze; `not_frontmost`, gdy nie wyszło)
  zamiast odrzucać `not_frontmost`.
- `Methods.standard(..., keys:)`, `main.swift`: wspólna `KeySession`,
  `leave()` zwalnia przycisk myszy i klawisze przed wyjściem.
- Fixture: etykieta „keys” („Held key N for X s” ze znaczników czasu zdarzeń,
  lokalny monitor `keyDown/keyUp/flagsChanged`), pozycja menu „Press Again”
  ⌘J (zwiększa licznik przycisku).

**Testy (Red → Green)**
- Red Swift: brak `KeyEvent`/`KeyScript`/`KeySession`/`.holdKey`; potem test
  przerwania przytrzymania: czekanie trwało 1,9 s zamiast skończyć się po
  `release()` → semafor.
- Red TS (helper z 7c, nowa fixture): `hold_key` → `unsupported`, ⌘J →
  `blocked`, HTML → `blocked`. Pierwsze podejście do ⌘J nie było Red, bo
  testy wskaźnika zostawiały fixture z przodu — test najpierw aktywuje
  Findera (aplikacja w tle to warunek wstępny).
- Green: `swift test` 103/103; `helper.test.ts` 31/31 przy bezczynnym
  wejściu: przytrzymanie Shift 0,5 s w tle („Held key 56 for 0.5 s”, aplikacja
  nie wychodzi na wierzch), ⌘J po wyciągnięciu na wierzch (licznik +1,
  fixture z przodu), wklejenie HTML ⌘V („xbold”, schowek użytkownika wraca).

- Refactor: kody modyfikatorów w jednym miejscu (`KeyScript.modifierOrder`
  z `KeyCodes.modifiers`).

**Walidacja**
- `swift test` 103/103; `./build.sh`, `./build-fixture.sh` OK.
- `npx vitest run` (plugin) — 24 pliki zielone; w `helper.test.ts` 266/268,
  bo użytkownik poruszył myszą w trakcie przebiegu (wskaźnik o 201 i 80 px
  od miejsca startu; akcje same w sobie zielone). `helper.test.ts`
  uruchomiony osobno po ≥ 30 s bezczynności wejścia — 31/31 na końcowym
  binarium.
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów; `pnpm check:deps`
  0 błędów (1 wcześniejsze ostrzeżenie); `pnpm build` 88/88.

**Pominięcia i dla następcy**
- Testy prawdziwego wejścia zależą od tego, czy użytkownik używa komputera:
  pisanie w trakcie daje słuszne `user_intervened`, a przełączenie aplikacji
  psuje asercje „kto jest z przodu”. Uruchamiać je przy bezczynnym wejściu
  (`ioreg -c IOHIDSystem` → `HIDIdleTime`).
- Klik po punkcie przez AX w tle czasem wraca jako `input` (2 z 6 przebiegów):
  hit-test AX nie znalazł kontrolki i zadziałał zapas fizyczny. Hipoteza
  (niepotwierdzona): okno fixture nie było na bieżącej przestrzeni. Kandydat
  do 7d: hit-test po ramkach z ostatniego stanu.
- `hold_key` nie generuje autopowtarzania (jedno `keyDown`, potem `keyUp`);
  aplikacje czytające stan klawisza dostają przytrzymanie, edytory tekstu nie
  powtórzą znaku.
- 7d: strażnik (Escape = Stop, ingerencja = pauza), brak postępu, cache
  `unsupported`, ochrona okna zapisu.

---

## Krok 7d1 — strażnik: Escape, pauza, ręka użytkownika (2026-10-01)

Commit kroku 7c2: `ce4e53d6`.

**Wzorzec**
- Claude (`index.chunk-*.js`, `[cu-esc]`): Escape jako globalny skrót, gdy
  sesja trzyma Computer Use; własne Escape modelu są liczone i pochłaniane.
  Globalny skrót zabiera Escape aplikacjom użytkownika — my używamy taps
  `listenOnly` (nic nie opóźnia ani nie zmienia), a własne zdarzenia
  rozpoznajemy po znaczniku `0x6D6F7878` (sonda: znacznik dociera do tapu).
- Claude: `user_actively_typing` / `user_active_in_app` — nie walczymy z
  użytkownikiem; czekanie do 6 × 400 ms na chwilę ciszy przed fizycznym
  wejściem.
- Windows (`native/src/control.cpp` `wait_for_access`): akcja w pauzie czeka
  (`paused_by_user`, wyłączony limit czasu transportu), a po wznowieniu
  kończy się „observe again” — nigdy nie jest odtwarzana.

**Co**
- `Guard.swift` (czyste): `UserInput.classify` (nasze / Escape / aktywność /
  komunikaty tapu), `QuietWait.next` (400 ms ciszy, do 6 prób),
  `ControlGate` (pauza i wznowienie z hosta; akcja czeka na warunku i
  zgłasza `paused_by_user` → `recovering`).
- `UserActivity.swift`: tap `listenOnly` na `cgSessionEventTap` na własnym
  wątku (ponowne włączenie po `tapDisabledBy*`); Escape użytkownika →
  `leave(userStopped)` jak Stop; bez tapu (brak Input Monitoring) zapas:
  tylko pisanie z `secondsSinceLastEventType`. `InputSessions` zbiera
  wskaźnik, klawisze, bramkę pauzy, aktywność i pid hosta (krótsze listy
  parametrów `Methods.standard`/`act`/`Executor`).
- `Act.swift`: akcja po pauzie → `user_intervened` z prośbą o świeży stan;
  `waitForQuiet` przed fizycznym wejściem (klik, przewijanie kółkiem, drag,
  `mouse`).
- `main.swift`: `CurrentRequest` (id żądania dla `control_state`), sterowanie
  `pause`/`resume` z czytnika do `ControlGate` i przygaszenia kursora
  (`AgentCursor.dim`, przezroczystość nakładki 0,35).

**Testy (Red → Green)**
- Red Swift: brak `UserInput`, `QuietWait`, `ControlGate`.
- Red TS (helper z 7c2): pauza nie dawała `control_state` (`[]`), klik
  fizyczny przy ruchach myszy „użytkownika” był `delivered`, Escape nie
  zatrzymywał helpera.
- Green: Swift 110/110; nowe testy e2e 3/3 — pauza trzyma klik (stan
  `paused_by_user`, po wznowieniu `user_intervened`, licznik przycisku bez
  zmian), ruchy myszy bez znacznika (JXA, w miejscu wskaźnika) → klik
  `user_intervened`, `key code 53` przez System Events → helper kończy się
  kodem 20 (`stoppedByUser`).

**Walidacja**
- `swift test` 110/110 (bez ostrzeżeń); `./build.sh` OK.
- `helper.test.ts` przy bezczynnym wejściu (≥ 30 s) — 34/34.
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów; `pnpm check:deps`
  0 błędów; `pnpm build` OK.

**Pominięcia i dla następcy**
- Escape użytkownika zatrzymuje Computer Use także wtedy, gdy zamyka nim
  okno we własnej aplikacji (tak samo u Claude'a). Bez uprawnienia Input
  Monitoring tap nie powstaje: Escape nie działa, a czekanie na ciszę widzi
  tylko pisanie — do pokazania w pasku sterowania (krok 9).
- Akcje AX w tle nie czekają na ciszę (nie ruszają wskaźnika).

---

## Krok 7d2 — brak postępu i pamięć odmów AX (2026-10-01)

Commit kroku 7d1: `a006a0c2`.

**Wzorzec**
- Plan (raporty Codex/Claude): oba systemy kończą pętle powtórzeń tylko
  przez model; to, że ta sama akcja nic nie zmienia, ma wykrywać runtime i
  kierować model na kolejną metodę (element → akcja drugorzędna → skrót →
  współrzędne). Kod `no_progress` istniał w kontrakcie od kroku 2.

**Co**
- `src/contract/progress.ts` (czyste, wspólne dla platform):
  `fingerprint(tree, image)` (SHA-256 drzewa i obrazu — zmiana samych
  pikseli na płótnie to też postęp), `ProgressTracker` (`check` przed
  wysłaniem, `record` po wyniku, `forget` po odmowie).
- `backend.ts`: `Turn.seen` (odcisk tego, co model ostatnio widział, per
  aplikacja; aktualizowany w `present`) i `Turn.progress`; `act` — trzecia
  identyczna akcja po dwóch bez zmian → `ComputerUseError('no_progress')`
  bez wysyłania; `judge` — pierwszy brak zmian dopisuje uwagę, drugi z
  rzędu zamienia wynik na `ineffective` + `no_progress`.
- Swift `Guard.swift`: `DeclineMemory` (3 odmowy akcji AX elementu → 5 s
  pomijania, sukces czyści licznik); `TargetState.declines`; `tryPress`
  pomija pamiętaną odmowę i od razu oddaje zapas (np. strony przewijania w
  `NSScrollView`, które zawsze odmawiają -25205, po 3 razach idą prosto do
  paska przewijania).

**Testy (Red → Green)**
- Red TS: brak modułu `./progress.js`; backend nie dopisywał „Nothing
  visible changed”.
- Red Swift: brak `DeclineMemory`.
- Green: `progress.test.ts` (odcisk, liczenie, reset po zmianie/innej
  akcji/innej aplikacji, `forget`); `backend.test.ts` — klik „Save” w
  skryptowanym helperze: uwaga → `Action ineffective (no_progress)` →
  trzeci klik odrzucony bez żądania `act`, a pisanie zeruje licznik;
  Swift 112/112.

**Walidacja**
- `swift test` 112/112; `./build.sh` OK.
- `npx vitest run` (plugin) przy bezczynnym wejściu — 26 plików / 276 testów.
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów; `pnpm check:deps`
  0 błędów; `pnpm build` 88/88.

**Pominięcia i dla następcy**
- `computer_batch` nie liczy postępu kroków (stan jest dopiero na końcu).
- Zrzut JPEG z migającym kursorem tekstowym może różnić się między
  przechwyceniami — wtedy brak zmian nie zostanie wykryty (bezpieczny
  kierunek: nigdy fałszywego `no_progress`).

---

## Krok 7d3 — ochrona okien zapisu (2026-10-01)

Commit kroku 7d2: `af1308b8`.

**Wzorzec**
- Claude.app 2.16120.0 (`app.asar`, read-only): listy chronionych miejsc dla
  paneli zapisu — katalogi w domu (`.ssh`, `.gnupg`, `.aws`, `.kube`,
  `.docker`, LaunchAgents/LaunchDaemons, konfiguracja fish i gita), katalogi
  systemowe (`/etc`, `/private/etc`, `/Library/Launch*`, `/System`), nazwy
  (pliki rc powłoki, `.gitconfig`, klucze SSH), rozszerzenia uruchamiane przy
  otwarciu (`.command`, `.webloc`, `.mobileconfig`, …), wnętrze `.git` i
  skrypty `bin/activate*`; sprawdzanie zarówno wpisywanego tekstu, jak i
  potwierdzenia zapisu. Dopasowanie (normalizacja) napisane od nowa.
- Identyfikatory AX `NSSavePanel` (macOS 26, sprawdzone sondą na fixture):
  arkusz `save-panel`, pole nazwy `saveAsNameTextField` (wartość bez
  rozszerzenia), menu „Gdzie” `where popup` (tylko nazwa folderu), przyciski
  `OKButton`/`CancelButton`, pole „Idź do” `PathTextField`.

**Co**
- `ProtectedPath.swift` (nowy, czysty): `ProtectedPath.refuses(path, home:)`
  i `normalized` (NFKC, usunięcie niewidocznych znaków, małe litery, `~`,
  podwójne ukośniki, kropki i spacje na końcu członu — jak widzi to system
  plików bez rozróżniania wielkości liter); `SaveGuard.refusesTyping` (tylko
  pola nazwy i „Idź do”) i `SaveGuard.refusesSaving(name:folder:)` (nazwa
  folderu z menu „Gdzie”).
- `Act.swift`: `guardSave(writing:into:replacing:)` przed `type_text`,
  `paste` i `set_value` (sprawdza sam tekst i wynik po wstawieniu);
  `guardSave(confirmedBy:byReturn:)` przed kliknięciem `OKButton` (po
  indeksie, po punkcie, akcja drugorzędna) i przed Return/Enter bez
  modyfikatorów, gdy fokus jest w arkuszu zapisu. Wynik `blocked
  protected_path` z podpowiedzią; nic nie jest wysyłane.
- `AXReader`: `identifier(_:)`, `descendant(of:identifier:depth:)`;
  `KeyChord.confirms`.
- Fixture: przycisk „Save…” (`save`) otwiera arkusz `NSSavePanel`; status
  „Saved” / „Not saved”.

**Testy (Red → Green)**
- Red Swift: brak `ProtectedPath`/`SaveGuard` (kompilacja). Red e2e na
  binarce z 7d2: `type_text ".zshrc"` w polu nazwy → `delivered`.
- Green: Swift 119/119 (`ProtectedPathTests` — katalogi, nazwy,
  rozszerzenia, `.git`, `activate`, wielkość liter, znaki pełnej szerokości i
  zerowej szerokości, zwykłe dokumenty przepuszczone; `SaveGuardTests`).
  e2e „save dialogs”: `type_text ".zshrc"` i `set_value "authorized_keys"`
  → `protected_path`, `set_value "Report"` → `delivered`, nazwa `.bashrc`
  wpisana z zewnątrz (System Events) + klik Save → `protected_path`, Cancel →
  „Not saved”.

**Walidacja**
- `swift test` 119/119; `./build.sh` OK.
- `npx vitest run` (plugin) przy bezczynnym wejściu — 26 plików / 277 testów.
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów (96 ostrzeżeń, wszystkie
  wcześniejsze); `pnpm check:deps` 0 błędów; `pnpm build` 88/88.

**Pominięcia i dla następcy**
- Pole „Idź do” (`PathTextField`) jest sprawdzane przy pisaniu, ale jego
  potwierdzenie Returnem sprawdza tylko nazwę i menu „Gdzie” — menu pokazuje
  nazwę folderu, nie pełną ścieżkę, więc folder o tej samej nazwie co
  chroniony (np. `hooks`) też jest odrzucany (bezpieczny kierunek).
- Zapis przeciągnięciem pliku albo przez skrót ⌘S w aplikacji bez panelu nie
  przechodzi przez tę bramkę; dotyczy tylko `NSSavePanel`.

---

## Krok 8 — batch, zrzut pełnoekranowy i zoom w helperze macOS (2026-10-01)

Commit kroku 7d3: `0ad9ec06`.

**Wzorzec**
- Claude.app 2.16120.0 (`app.asar`, read-only): `screenshot` liczy rozmiar
  jako budżet obrazu z natywnych pikseli ekranu, potem mnoży przez `scale`,
  i woła `captureExcluding(allowedBundleIds, 0.75, …)` (JPEG 0,75);
  `zoom` przelicza region na punkty ekranu, rozmiar = budżet(region ×
  skala piksela) × `scale`, i woła `captureRegion` z tą samą listą zgód.
  `computer_batch`: kroki po kolei, każdy przez własne bramki, stop na
  pierwszym błędzie.
- Kontrakt TS (`computer_batch`, `computer_screenshot`, `computer_zoom`)
  istniał od kroku 3; ten krok dokłada ich wykonanie w helperze Swift.

**Co**
- `Batch.swift` (nowy): czyste `Batch.run(steps, waitedOut:, perform:)` —
  stop na pierwszym nie-`delivered`, pauza użytkownika przed krokiem →
  `blocked user_intervened` i koniec; `Methods.batch` — wszystkie kroki
  parsowane przed pierwszym, krótkie ustalanie między krokami
  (`betweenSteps`: 0,1–2 s), świeży stan na końcu.
- `Screen.swift` (nowy): `ScreenCapture` — główny ekran przez
  `SCContentFilter(display:excludingApplications:)` (wszystkie aplikacje bez
  zgody i proces hosta ukryte), `includeMenuBar = false` (macOS 14.2+;
  starszy system → jawny błąd zamiast przecieku menu), tło czarne;
  `Methods.screenshot` (zapamiętuje ramkę i zestaw aplikacji w
  `Targets.screen`) i `Methods.zoom` (region ostatniego zrzutu aplikacji lub
  ekranu; `no_state` bez zrzutu, `point_outside_frame` poza nim,
  `stale_state` gdy okno przesunęło się od zrzutu; przy zoomie ekranu tylko
  aplikacje z obu zgód — wtedy i teraz).
- `Capture.swift`: wspólne `WindowCapture.render(filter, size, source,
  scale)` (budżet × `scale`, `sourceRect`, czarne tło przez stałą
  `CGColor.black` — `backgroundColor` nie zatrzymuje koloru, zwykły
  `CGColor` kończył się awarią), `capture(_:region:scale:)` dla zoomu okna,
  `ImageBudget.fit(width:height:scale:)`, `CoordinateFrame.screenRect(region:)`.
- `Act.swift`: wspólne `grantedApp`/`allowedApps`; `TargetState.root`
  (element AX okna) do ustalania między krokami i wykrywania przesunięcia.
- TS `backend.ts`: `computer_zoom` przekazuje helperowi `allowed` (każde
  żądanie sprawdza zgody na nowo).

**Testy (Red → Green)**
- Red Swift: brak `Batch`, `fit(scale:)`, `screenRect`. Red TS: `zoom` bez
  `allowed`. Red e2e: binarka z 7d3 nie znała metod `batch`/`screenshot`/
  `zoom` (`unsupported_action`); po pierwszej implementacji zoom ekranu
  padał (-3811 — filtr `including:` nie działa z `sourceRect` i przesuwał
  okno do rogu obrazu) — stąd filtr wykluczający; tło było białe — stąd
  czarne tło i sprawdzenie piksela.
- Green: Swift 125/125 (`BatchTests`, `CaptureSizeTests`,
  `ZoomRegionTests`); `backend.test.ts` 51/51; e2e 3/3 — batch: klik +
  `set_value` dostarczone, indeks 9999 → `stale_state`, czwarty krok nie
  wykonany, stan raz na końcu, aplikacja bez zgody → `app_not_allowed`;
  zrzut: rozmiar w budżecie, `scale 0.5` połowa, prawy górny róg czarny,
  środek okna fixture na swoim miejscu, zoom ekranu bez zrzutu → `no_state`;
  zoom okna: co najmniej natywna rozdzielczość, region poza → 
  `point_outside_frame`, bez zgody → `app_not_allowed`.

**Walidacja**
- `swift test` 125/125; `./build.sh` OK.
- `npx vitest run` (plugin) przy bezczynnym wejściu — 26 plików / 280 testów
  (test batcha nie zakłada już etykiety statusu po wcześniejszych testach).
- `pnpm typecheck` (plugin) OK; `pnpm lint` 0 błędów (96 ostrzeżeń,
  wcześniejsze); `pnpm check:deps` 0 błędów; `pnpm build` 88/88.

**Pominięcia i dla następcy**
- Zrzut pełnoekranowy obejmuje tylko główny ekran (wiele monitorów: krok 14).
- Akcje nie przyjmują współrzędnych zrzutu pełnoekranowego — wszystkie
  działają na aplikacji i jej zrzucie; pełny ekran i zoom służą do czytania.
- Batch nie liczy postępu (`ProgressTracker`) dla pojedynczych kroków.

## Krok 9 — status wypychany zdarzeniami i „Przejmij” (2026-10-01)

Poprzedni commit: `d9cd9481` (krok 8).

**Wzorzec**
- Codex pokazuje stan sterowania na żywo (bez odpytywania) i pozwala
  człowiekowi przejąć okno; Claude ma „Stop” zawsze dostępny. U nas jeden
  stan żyje w `TurnControls` (plugin) i jest wypychany do każdej powierzchni.

**Co**
- SDK: komenda `takeover`; `ComputerControlService.subscribe(listener)`
  (opcjonalne — starsze usługi go nie mają).
- Plugin: `TurnControls` trzyma słuchaczy per sesja i wypycha listę tur po
  każdej zmianie (bez powtórek identycznego stanu), także po zakończeniu
  procesu helpera (`HelperTransport.done`). `takeover` → `paused_by_user`,
  kursor zdjęty i ukryty do `resume`. Protokół helpera v5
  (`TAKEOVER_PROTOCOL_VERSION`); helper v4 dostaje zwykłe `pause`.
- Helper Swift: ramka sterująca `takeover` — pauza bramki, `cursor.hide()`
  (nakładka znika, zdarzenie `cursor: null`), zwolnienie trzymanych klawiszy
  i przycisków; `resume` przywraca kursor przy następnej akcji.
- Runner: notyfikacja `computer.changed`, `RUNNER_PROTOCOL_VERSION` 22 → 23,
  `FLOOR_RUNNER_PROTOCOL` 23; serwer subskrybuje usługę i rozsyła do
  wszystkich klientów; widok klienta ma `subscribe` (wymaga serwera v23).
- Desktop: `SessionDriver` przekazuje zmiany jako zdarzenie IPC
  `computer.changed {workspaceId, turns}`; `useComputerControl` — jedno
  czytanie i subskrypcja zamiast timera 1 s; pasek pokazuje cel
  (`aplikacja — okno`), stan tekstem i ikoną, przyciski Przejmij / Wznów /
  Stop (Stop aktywny także w trakcie innej komendy). Pasek pojawia się przy
  dowolnym narzędziu `computer_*` (wcześniej tylko `computer_app_catalog`
  z Windows).

**Testy (Red → Green)**
- `turn-controls.test.ts` 8/8 (wypchnięcie na zmianę, takeover, helper v4);
  `WireTests` (takeover); e2e helpera „lets the user take over…” — Red na
  starej binarce (kod wyjścia 65), Green 1/1.
- Runner: „pushes every Computer Use change to every attached client,
  without polling” — 159/159.
- `session-driver.test.ts` „forwards every Computer Use change…” — Red
  (timeout), Green 16/16.
- Desktop: `panel-model` (cel, ikona, `usesComputer`), `ComputerControlStrip`
  (klawiatura, Stop podczas `busy`), `useComputerControl` (jedno czytanie,
  inny workspace, zmiana przed odpowiedzią, takeover + koniec subskrypcji) —
  Red 11 testów, Green 13/13.

**Pominięcia i dla następcy**
- Kanał mobilny (`plugin-channel-mobile`) nie obsługuje komend
  `computer.*` ani zdarzenia — aplikacja mobilna nie ma paska sterowania.
- Przycisk „Pause” zniknął z paska (zastąpił go „Take over”); komenda
  `pause` zostaje w protokole dla strażnika helpera.

**Walidacja**
- `swift test` 125/125; `./build.sh` OK.
- `pnpm --filter @moxxy/sdk --filter @moxxy/runner --filter @moxxy/desktop-ipc-contract --filter @moxxy/desktop-host --filter @moxxy/desktop test`
  — 464, 159, 61, 802 (+1 pominięty), 874 testów zielonych.
- `npx vitest run` (plugin) przy bezczynnym wejściu — 26 plików / 284 testy.
  W pierwszym przebiegu test „presses a control under a point through
  accessibility” dostał `method: input` zamiast `ax` (okno fixture było
  zasłonięte innym oknem, hit-test trafił w cudzy proces); sam i w drugim
  pełnym przebiegu zielony — test zależy od tego, co leży nad fixture.
- `pnpm build` 88/88; `pnpm typecheck` 150/150; `pnpm lint` 0 błędów
  (96 wcześniejszych ostrzeżeń); `pnpm check:deps` 0 błędów.

## Krok 10 — macOS na natywnym helperze, sprzątanie, pakowanie (2026-10-01)

Poprzedni commit: `808bbfde` (krok 9).

**Wzorzec**
- Codex: SKILL.md `computer-use` (pętla stan → akcja → weryfikacja, indeksy
  przed współrzędnymi) i wskazówki per aplikacja pokazywane raz na aplikację
  w turze. Claude: reguły poziomów (przeglądarki tylko do odczytu, terminale
  tylko klik), zakaz klikania linków, odsyłanie stron do narzędzi
  przeglądarki. Teksty napisane od zera.

**Co**
- `src/index.ts`: darwin → `ComputerBackend(macosProfile)`; gdy
  `helperProblem()` (brak pliku, brak/nieczytelny manifest, inny protokół)
  zwraca powód — wtyczka ma tylko `computer_status` z tym powodem. Windows
  x64 bez zmian; reszta platform: `computer_status` „unsupported”.
- Usunięte: `src/tools/*` (osascript/screencapture/sips/AppleScript),
  `shell.ts`, `temporary-files.ts`, `tools.test.ts` i ich testy.
- Kontrakt: `computer_status {open_settings?}` — pyta helper o `status`,
  opcjonalnie otwiera panel Ustawień (`permissions.request`).
- `src/contract/guidance.ts`: 10 krótkich reguł pracy dopisywanych do
  `system` raz, gdy żądanie ma narzędzia `computer_*` (hook
  `onBeforeProviderCall` backendu); `super` nazwany per platforma.
- `src/backend/app-hints.ts` + `skills/computer-apps/*.md` (przeglądarki,
  Finder, pakiety biurowe, montaż wideo, narzędzia graficzne): każdy plik to
  zwykły skill z dodatkowym polem `apps` we frontmatterze; backend pokazuje
  treść przy pierwszym stanie aplikacji w turze (`Turn.hinted`). Dopasowanie
  po bundle ID lub nazwie, także z sufiksem wersji
  (`com.adobe.PremierePro.25`, „Adobe Photoshop 2026”).
- `skills/computer-control.md`: nowa część macOS (pętla zgoda → stan →
  akcja → sprawdzenie, wyniki, klawisze, batch, aplikacje bez elementów,
  kontrola użytkownika, uprawnienia); część Windows zostaje do kroku 12.
- Artefakt: `helperDigest` — dla Mach-O skrót liczony bez podpisów kodu
  (każdy slice do `LC_CODE_SIGNATURE`, z wyzerowanymi polami, które
  podpisywanie przepisuje: rozmiary `__LINKEDIT`, offset/rozmiar podpisu;
  bez nagłówka fat). Powód: electron-builder podpisuje ponownie każdy plik
  wykonywalny w aplikacji, po zapisaniu manifestu — zwykłe sha256 pliku
  przestawałoby się zgadzać w podpisanym wydaniu. PE (Windows) nadal
  haszowany w całości. `writeHelperManifest` (atomowo) używany przez
  `build.sh`; `helperProblem` (synchroniczny, bez czytania binarki).
- Pakowanie: `verify-desktop-resources.mjs` wymaga helpera macOS na darwin
  (tak jak exe na win32); `x64ArchFiles` zawiera `moxxy-computer` (plik
  identyczny w obu buildach arch); kroki „Build macOS Computer Use
  component” w `ci.yml` i `release.yml` przed `prepare:resources`.
- Katalog wtyczek i strona `apps/docs` opisują nowy zestaw.

**Testy (Red → Green)**
- Red: `index.test.ts` (stare narzędzia zamiast kontraktu), `skill.test.ts`,
  `artifact.test.ts` (brak `helperDigest`/`helperProblem`/
  `writeHelperManifest`), `app-hints.test.ts` i `guidance.test.ts` (brak
  modułów), `backend.test.ts` (brak `computer_status`, brak wskazówek),
  `desktop-packaging.test.mjs` (darwin przechodził bez helpera; brak
  `moxxy-computer` w `x64ArchFiles`).
- Green: plugin 24 pliki / 228 testów jednostkowych; test podpisu:
  `/usr/bin/true` podpisany dwa razy różnymi identyfikatorami i opcjami →
  ten sam digest, inne sha256 pliku; zmieniony bajt kodu → inny digest.
  e2e: prawdziwa wtyczka na tym Macu ma narzędzia kontraktu, a
  `computer_status` odpowiada helper. `desktop-packaging` 9/9.
- Ręcznie: zbudowany helper skopiowany i podpisany ponownie
  (`--options runtime`, inny identyfikator) przechodzi
  `verifyHelperArtifact` z oryginalnym manifestem.
- Próbne pakowanie `pnpm --filter @moxxy/desktop run package:dir`
  (bez certyfikatu, podpis ad-hoc): helper w
  `Resources/plugins-seed/.../bin/darwin-universal/` przechodzi
  `verifyHelperArtifact`. Pakowanie ujawniło, że `app.asar.unpacked`
  zabierało cały katalog `native/` wtyczki z wynikami `swift build`
  (531 MB) — dodane wykluczenie w `build.files`; po nim wtyczka zajmuje
  3 MB, a `app.asar.unpacked` 295 MB zamiast 826 MB.

**Walidacja**
- `swift test` 125/125; `./build.sh` OK (manifest przez `writeHelperManifest`).
- `npx vitest run` (plugin) przy bezczynnym wejściu — 25 plików / 268 testów
  (mniej niż w kroku 9, bo usunięto testy starych narzędzi macOS).
- `node --test scripts/desktop-packaging.test.mjs` 10/10.
- `pnpm build` 88/88; `pnpm typecheck` OK; `pnpm lint` 0 błędów (96
  wcześniejszych ostrzeżeń); `pnpm check:deps` 0 błędów;
  `pnpm --filter @moxxy/plugin-plugins-admin --filter @moxxy/core test` OK.

**Otwarte**
- Test e2e „presses a control under a point through accessibility, in the
  background” padł w 2 z 9 pełnych przebiegów (`method: input` zamiast
  `ax`), oba razy tuż po długim obciążeniu maszyny (pełny `pnpm test`,
  pakowanie). Z diagnostyką w helperze (rola i akcje elementu pod punktem)
  6 kolejnych przebiegów było zielonych: hit-test zwracał `AXButton` z
  `AXPress`. Nieodtworzone; diagnostyka usunięta. Jeśli wróci: zalogować
  wynik `AXReader.element(at:)` i kod `AXUIElementPerformAction`.
- Scalanie universal (`@electron/universal`) nie było uruchamiane lokalnie
  (`--dir` buduje tylko arm64) — sprawdzi je CI wydania; `x64ArchFiles`
  obejmuje `moxxy-computer`.
- Podpis Developer ID i notaryzacja helpera wymagają sekretów wydania —
  niesprawdzone lokalnie; digest manifestu jest na to odporny (test).
- W `~/.moxxy/plugins` użytkownika zostaje stara kopia wtyczki do czasu
  aktualizacji/seedowania z nowej aplikacji.

## Krok 11 — PiP: podgląd JPEG przez Surface (2026-10-01)

Poprzedni commit: `84833610` (krok 10).

**Wzorzec**
- Codex: podgląd dla człowieka jest osobnym strumieniem (latest-frame),
  niezależnym od obserwacji modelu; kursor rysowany po stronie klienta z
  pozycji podanej jako ułamek okna. Claude: `[cu-live-preview]` ≤2 kl./s.
  Kod napisany od zera.

**Co**
- Helper Swift: `Preview.swift` — `PreviewStream` (`SCStream` okna celu,
  `minimumFrameInterval` z fps, dłuższa krawędź ≤960 px, JPEG 0,6) i czysta
  `PreviewPolicy` (fps 1–5, rozmiar, kiedy restart strumienia). Metody
  `preview.start {fps}` / `preview.stop`; zdarzenie
  `preview_frame {seq, image?, error?}` idzie poza kolejką żądań. Gdy obraz
  się nie zmienia, co 1 s leci klatka bez obrazu („żyję”), żeby klient
  odróżnił nieruchome okno od martwego strumienia. Nakładka-kursor nie jest
  w obrazie (`sharingType = .none`).
- `src/preview/controller.ts`: `PreviewController` — licznik widzów, jedno
  źródło naraz (bieżąca tura), latest-frame z limitem fps (domyślnie 2,
  maks. 5), stany `live | stale | unavailable | stopped`, `stale` po 3 s
  ciszy, zatrzymanie producenta bez widzów i po turze.
- `src/preview/surface.ts`: `defineSurface({kind: 'computer-preview'})`;
  wejście `{type: 'configure', fps}`. Klatki idą wyłącznie jako
  `surface.data` — nie do modelu i nie do logu sesji.
- `ComputerBackend`: źródło podglądu per tura; żądania `preview.*` mają
  sygnał, który nigdy nie jest przerywany (przerwanie żądania zamyka cały
  transport helpera); odpięcie w `dispose` i po `transport.done`; po Stop
  nie ma obrazu.
- Desktop: `preview-model.ts` (czyste: stan widoku, etykieta, położenie
  kursora, ukrycie per rozmowa / wszędzie w `localStorage`),
  `useComputerPreview` (na `useSurface`, aktywny tylko gdy tura steruje
  komputerem), głupi `ComputerPreviewPip` (canvas + znacznik kursora z
  `computer.changed` + „Hide in this chat” / „Hide everywhere”);
  `ComputerControlStrip` ma „Show the live view”, gdy podgląd ukryty.

**Testy (Red → Green)**
- Red: brak modułów `preview/*`, brak `preview_frame` w schemacie zdarzeń,
  brak `surfaces` we wtyczce, brak `PreviewPolicy` w Swift, brak hooka i
  komponentu w desktopie — każdy test padał na brakującym symbolu lub
  zachowaniu.
- Green: `controller.test.ts` 9 (backpressure, stale, liczniki, sprzątanie,
  brak widzów = brak produkcji), `surface.test.ts` 2, `backend.test.ts`
  „live preview” 5, `PreviewTests.swift` 3, e2e `helper.test.ts` „live
  preview for the human” 2 (prawdziwy `SCStream` na aplikacji fixture),
  desktop `preview-model`, `useComputerPreview`, `ComputerPreviewPip`,
  `ComputerControlStrip`, `panel-model`.
- `ChatSurface.test.tsx`: atrapa `@moxxy/client-core` dostała `isConnected`
  i `toErrorMessage`, bo `ChatSurface` czyta teraz Surface.

**Walidacja**
- `swift test` 128/128; `./build.sh` OK.
- `npx vitest run` (plugin) przy bezczynnym wejściu — 27 plików / 286 testów.
- `pnpm --filter @moxxy/desktop test` — 146 plików / 887 testów.
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów (96
  wcześniejszych ostrzeżeń); `pnpm check:deps` 0 błędów.

**Otwarte**
- Pomiar CPU podglądu (JPEG) razem z H.264 w kroku 13.
- Podgląd na Windows — krok 12; kanał mobilny nie ma jeszcze `computer.*`.


## Krok 12 — Windows na wspólnym kontrakcie, z kursorem i PiP (2026-10-01)

Poprzedni commit: `1060794a` (krok 11).

**Wzorzec**
- Codex na Windows: aplikacja + okno jako cel, pełne drzewo UIA z indeksami,
  osobne akcje po elemencie i po punkcie obrazu. Claude: zgody per aplikacja,
  maskowanie aplikacji bez zgody na zrzucie pełnoekranowym, batch. Kod własny;
  z poprzedniego helpera zostały sprawdzone mechanizmy (UIA, WGC, `SendInput`,
  strażnik wejścia, panel Pause/Resume/Stop, mutex, katalog aplikacji).

**Co**
- TS: `src/windows/profile.ts` — profil Windows dla wspólnego
  `ComputerBackend` (protokół 5). `createComputerControlPlugin` ma jedną
  ścieżkę dla obu platform. Usunięte `src/windows/{backend,contracts,
  guidance}.ts` z testami (stare 21 narzędzi). `maintenance.ts` używa
  `CONTRACT_PROTOCOL_VERSION`.
- Helper C++ (`native/src`): `desktop.cpp` przepisany na „stan celu” per
  aplikacja — stabilny identyfikator aplikacji (ścieżka exe małymi literami
  albo AppUserModelID), rejestr klucz → indeks (indeks nie wraca do obiegu),
  ramki elementów w pikselach obrazu, `stale_state` po ruchu okna, dialog
  lub menu przesłaniające okno staje się stanem. `input.cpp`: neutralne
  nazwy klawiszy, ścieżka przeciągania, `mouse` down/move/up, powrót
  wskaźnika użytkownika. `capture.cpp`: trwała sesja WGC, zrzut ekranu GDI,
  maska aplikacji bez zgody wg kolejności Z. `cursor.cpp`: okno warstwowe
  click-through poza zrzutami + zdarzenia `cursor`. `preview.cpp`: 1–5
  kl./s, krawędź ≤960 px, JPEG. `main.cpp`: komenda `takeover`.
- Skill `computer-control.md`: jedna instrukcja, krótka sekcja „Windows x64”.
- Desktop: `computer-approval-focus.ts` zna nowe narzędzia i przekazuje
  `app`; sonda aktualizacji (`computer-update-runtime.ts`) sprawdza nowy
  zestaw narzędzi zamiast `protocolVersion`; skrypty
  `smoke-computer-use.mjs`, `smoke-computer-update.mjs`,
  `verify-desktop-resources.mjs` i `Build-Windows.ps1` na protokole 5.
- `native/tests/Run-ComputerUseTests.ps1` napisany od nowa dla protokołu 5
  (te same parametry, raporty i kod wyjścia 2 bez pulpitu).
- Dokumenty: `docs/computer-use-windows.md` (kontrakt), strona pakietu.

**Testy (Red → Green)**
- Red: `index.test.ts` (Windows x64 dostaje narzędzia kontraktu i surface
  podglądu) padał, bo Windows miał stary backend; `skill.test.ts` padał na
  starych narzędziach w `allowed-tools`; `computer-update-runtime.test.ts`
  padał, bo sonda wymagała `computer_open` i `protocolVersion`.
- Green: plugin 19 plików / 226 testów (bez e2e macOS — te nie dotyczą
  kroku), `desktop-host` 75 plików / 805 testów (nowy
  `computer-approval-focus.test.ts` 3), desktop 146 / 887.
- Natywne testy przenośne (`ctest`: geometry, approval-focus) lokalnie 2/2.

**Walidacja**
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów (96
  wcześniejszych ostrzeżeń); `pnpm check:deps` 0 błędów.
- Helper C++ i testy na prawdziwym pulpicie: tylko CI
  `Computer Use Windows` — wynik i poprawki dopisane niżej.

**Otwarte**
- Lokalnie brak Windows: pierwsza kompilacja nowego C++ odbywa się w CI.
- Zadanie `installer` workflow (smoke zainstalowanych zasobów) uruchamia się
  tylko ręcznie (`workflow_dispatch`).

**Wynik CI Windows (commity `a846016c` → poprawki)**
- Pierwsza kompilacja nowego C++ przeszła od razu; 17 z 28 testów zielonych.
- Poprawka 1: dialog otwarty przez ostatnią akcję pojawia się chwilę po
  kliknięciu, więc okna zasłaniającego szukamy po odczekaniu (`settle`), nie
  przed nim. Reszta czerwonych testów była następstwem otwartego dialogu.
- Poprawka 2: indeksy elementów trzymane per okno (dialog nie kasuje
  indeksów okna pod spodem); okno celu jest podnoszone na wierzch także
  wtedy, gdy ma już fokus (aplikacja uruchomiona w tle); pisanie z
  `element_index` najpierw ustawia fokus przez UIA, klik jest zapasem.
- Poprawka 3: wskaźnik użytkownika wraca 40 ms po akcji — zwolnienie
  przycisku bierze pozycję z chwili obsługi przez Windows, więc zbyt szybki
  powrót gubił koniec przeciągania (test niestabilny).
- Run `36811088154`: sukces, 29 testów × 2 przebiegi (w tym prawdziwy
  Notatnik, schowek, panel strażnika, zabicie helpera w trakcie
  przeciągania).

## Krok 13 — podgląd jako wideo H.264 z zapasem JPEG (2026-10-01)

Poprzedni commit: `a8241c09` (krok 12).

**Wzorzec**
- Codex: podgląd dla człowieka to strumień wideo niezależny od obserwacji
  modelu. Dokumentacja WebCodecs (Context7, `/w3c/webcodecs`, rejestracja
  AVC): bez `description` w konfiguracji dekoder przyjmuje strumień Annex B —
  dlatego helper wysyła Annex B z zestawami parametrów przed każdą klatką
  kluczową i nie potrzeba kontenera.

**Co**
- Helper Swift: `Video.swift` — `VideoEncoder` (`VTCompressionSession`,
  H.264 Main, tryb czasu rzeczywistego, bez przestawiania klatek, klatka
  kluczowa co najwyżej co 10 s i na żądanie), czyste `H264.annexB` i
  `H264.codec` (nazwa `avc1.PPCCLL` z SPS). `PreviewStream` ma kodek;
  `preview.start {fps, codec?}`, nowe `preview.keyframe`. Dla nieruchomego
  okna klatka kluczowa powstaje z ostatniego obrazu. Zdarzenie
  `preview_chunk {seq, key, codec, data, timestamp, width, height}`.
- TS: `PreviewController` negocjuje kodek — wideo tylko wtedy, gdy helper je
  robi (`PlatformProfile.previewCodecs`, macOS: `h264`+`jpeg`) i każdy widz
  umie je pokazać; inaczej JPEG dla wszystkich. Widz w strumieniu wideo nie
  dostaje nic do najbliższej klatki kluczowej (po dołączeniu, po zgubionym
  fragmencie, na własną prośbę). Surface: `configure {codecs}` i `keyframe`.
  Helper bez wideo nie dostaje pola `codec` (Windows odrzuca nieznane pola).
- Desktop: `video-preview.ts` — `gateChunk` (czysta polityka: delty są
  porzucane, gdy kolejka dekodera > 3, aż do klatki kluczowej) i
  `createVideoPainter` (WebCodecs `VideoDecoder` → canvas, nowy dekoder po
  błędzie lub zmianie rozmiaru). `useComputerPreview` zgłasza `h264`, gdy
  przeglądarka ma WebCodecs; `ComputerPreviewPip` oddaje canvas dekoderowi.

**Testy (Red → Green)**
- Red: brak `VideoChunk`/`H264`/`VideoEncoder` w Swift (błąd kompilacji
  testów); `controller.accept/chunk/keyframe is not a function`; brak modułu
  `video-preview`; hook nie wysyłał `configure`; komponent nie renderował
  canvas dla wideo.
- Green: `VideoTests.swift` 5 (w tym prawdziwy enkoder systemowy: klucz →
  delty → klucz na żądanie), `controller.test.ts` +7, `surface.test.ts` +1,
  `backend.test.ts` +2, e2e `helper.test.ts` +1 (prawdziwy `SCStream` →
  H.264 z okna fixture), desktop `video-preview.test.ts` 7,
  `preview-model` +1, `useComputerPreview` +2, `ComputerPreviewPip` +1.
- Granica WebCodecs ma w testach jednostkowych atrapę (jsdom jej nie ma);
  prawdziwe dekodowanie sprawdzone osobno: 40 fragmentów z helpera
  zdekodowanych w Electronie 43.4.0 (Chrome 150) aplikacji — 40 klatek,
  0 błędów, kodek `avc1.4d001f`, 960×648.

**Pomiar** (`node native/macos/measure-preview.mjs 15`, aplikacja fixture,
5 kl./s, zmiana treści co ~0,4 s, M-series)

| kodek | obrazy | kB/s | CPU helpera | mediana opóźnienia |
|---|---|---|---|---|
| JPEG | 47 | 120,4 | 4,3% | 38 ms |
| H.264 | 47 | 3,5 | 2,8% | 43 ms |

Opóźnienie liczone od prośby o zmianę do pierwszego obrazu po niej; nie
obejmuje dekodowania w rendererze.

**Walidacja**
- `swift test` 133/133; `./build.sh` OK (universal).
- Plugin przy bezczynnym wejściu: 20 plików / 279 testów (z e2e).
- Desktop 147 plików / 898 testów; `desktop-host` 75 / 805.
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów;
  `pnpm check:deps` 0 błędów.

**Odstępstwo od planu**
- Windows Media Foundation nie jest zrobione. Runner CI (Windows Server)
  nie gwarantuje enkodera H.264, a lokalnie nie ma Windows, więc kod nie
  miałby żadnej weryfikacji. Windows ogłasza tylko `jpeg` i działa przez tę
  samą negocjację; dodanie enkodera to zmiana w `preview.cpp` + wpis
  `previewCodecs` w `windows/profile.ts`.

## Krok 14 — aplikacja testowa, próby w moxxy, dokumentacja (2026-10-01)

**Co**
- Fixture macOS (`native/macos/Sources/ComputerUseFixture/main.swift`): oś czasu
  bez elementów AX (klipy A i B: przeciągnięcie przesuwa, prawa krawędź
  przycina, przyciąganie co 10), przycisk `Shift` (przesuwa układ), przycisk
  `Dud` (bez efektu), pozycje menu New Window (⌘N) i Close Window (⌘W) — stan
  „aplikacja bez okna”.
- `native/macos/Tests/run-computer-use-tests.sh` (`--wait-idle`, `--filter=`):
  testy Swift, build helpera i fixture, testy end-to-end.
- `docs/computer-use-macos.md`, `docs/computer-use-rebuild/benchmark.md`, strona
  pakietu w `apps/docs`.

**Próby w prawdziwym moxxy** (`moxxy -p`, `openai-codex` / `gpt-6-astra`;
szczegóły i tabela w [`benchmark.md`](benchmark.md)). Znalazły trzy błędy,
których testy nie łapały:
1. Model wypełnia nieużywane pola (`x: 0, y: 0, modifiers: ""`, `null`); schemat
   odrzucał każde kliknięcie i tura kończyła się wykryciem pętli. Poprawka:
   `dropFiller` / `dropStepFiller` w `contract/tools.ts` (preprocess przed
   walidacją; `value: ""` w `set_value` zostaje, punkt `0,0` bez indeksu też).
2. Aplikacja bez okna nie przyjmowała klawiszy (`unsupported_action`).
   Poprawka: `TargetState.pid`, `press_key`/`hold_key` idą do procesu,
   `Foreground.bring(pid:window:)` wyciąga na wierzch także aplikację bez okna
   (przez `NSRunningApplication.activate()`, bo prośba AX jest wtedy
   ignorowana — sprawdzone na TextEdit).
3. Działająca aplikacja z przetłumaczoną nazwą nie była znajdowana po nazwie
   pakietu. Poprawka: `AppRecord.bundleName` w `AppCatalog.resolve` i `page`.

**Testy (Red → Green)**
- `tools.test.ts` „ignores the filler…”: Red `Give exactly one target`, potem
  `Key combo is empty` dla kroku batcha → Green.
- `helper.test.ts` „sends a Command shortcut to an app that has no open
  window”: Red `unsupported` zamiast `delivered` → Green.
- `AppCatalogTests.findsAnAppShownUnderALocalizedNameByItsBundleName`: Red
  `.notFound` → Green.
- Nowe testy e2e z tego kroku: oś czasu (przesunięcie, przycięcie, wybór),
  przesunięcie układu, kontrolka bez efektu → `no_progress`.
- Test listy aplikacji sprawdza teraz identyfikator, nie nazwę (nazwa zależy od
  języka systemu).

**Wynik prób** po poprawkach: formularz, oś czasu i Kalkulator — sukces,
potwierdzony odczytem stanu przez System Events; TextEdit — sprawdzony na
poziomie narzędzi (bez modelu), bo konto dostawcy osiągnęło limit (429).
Fałszywych sukcesów: 0.

**Walidacja**
- `swift test` 134/134; `./build.sh` OK (universal); `./build-fixture.sh` OK.
- Plugin przy bezczynnym wejściu: 20 plików / 283 testy (z e2e).
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów;
  `pnpm check:deps` 0 błędów.
- Windows CI: run 36811088154 zielony; instalator (run 36811436283) zielony;
  run 36812455639 po commicie kroku 13 czerwony („Helper exited before
  answering” od pierwszego testu stanu, bez zmian w kodzie Windows w tym
  commicie); run 36816291229 z commita kroku 14 (`ad6de5d8`) zielony, więc
  tamta porażka była jednorazowa (runner), nie regresja. Przyczyna nieustalona.

**Niezrobione / otwarte**
- Próg benchmarku ≥90% niepotwierdzony: zadania 3, 6–9 bez prób z modelem;
  realna aplikacja montażowa niezainstalowana.
- Windows: brak enkodera H.264 (krok 13), brak prób z modelem.
- Kopia pluginu 0.41.1 w `~/.moxxy/plugins` użytkownika przesłania kopię z
  repozytorium; na czas prób była odsuwana i przywracana.

## Próby na `gpt-6-luna` i poprawki z nich — 2026-10-01

**Dlaczego:** próby z modelem prowadzi się tylko na `gpt-6-luna`. Poprzednie
(na `gpt-6-astra`) nie liczą się; benchmark powtórzony w całości. Pełna tabela
prób: [`benchmark.md`](benchmark.md).

**Co i jak**
- `src/contract/tools.ts`: krok batcha bierze tylko pola swojej akcji; indeks
  i prawdziwy punkt naraz → celem jest punkt; cel opcjonalny z samymi zerami →
  element z fokusem. Komunikat „Give exactly one target” zostaje tylko dla
  braku celu.
- `src/contract/keys.ts`: aliasy `ArrowUp/Down/Left/Right`.
- `Act.swift`: podpowiedź przy pisaniu w punkt bez pola tekstowego.
- `Preview.swift`: `stop()` czeka na zatrzymanie przechwytywania.
- `skills/computer-apps/office.md`: arkusze (Return, edytor formuły, odczyt).

**Testy (Red → Green)**
- `tools.test.ts` „ignores, in a batch step, the fields that belong to other
  actions…”: Red `Unrecognized key(s)` → Green.
- `tools.test.ts` „ignores the filler…” rozszerzony trzy razy (indeks + punkt,
  indeks 0 + punkt, same zera przy celu opcjonalnym): za każdym razem Red
  (`Give exactly one target` albo zbędne `element_index: 0`) → Green.
- `keys.test.ts` `ArrowDown`, `shift+ArrowLeft`: Red `unknown key` → Green.
- `helper.test.ts`: test pisania w punkt sprawdza nową podpowiedź.
- Test podglądu: raz czerwony w pełnym przebiegu (`expected 12 to be 11`,
  klatka po `preview.stop`), po poprawce dwa pełne przebiegi zielone.

**Po drodze** reguła „indeks wygrywa z punktem” okazała się błędna (próba
luna8d kliknęła kontener zamiast komórki) i została odwrócona.

**Walidacja**
- `swift test` 134/134; `./build.sh` OK.
- Plugin przy bezczynnym wejściu: 20 plików / 285 testów (z e2e).
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów (96
  ostrzeżeń); `pnpm check:deps` 0 błędów (1 ostrzeżenie).

**Niezrobione / otwarte**
- Próg benchmarku niespełniony: 2 fałszywe sukcesy modelu w Numbers.
- Zadanie 7 częściowe, zadanie 9 nieuruchomione (brak aplikacji).
- Windows: zmiany w schemacie są wspólne, ale bez prób z modelem; brak
  enkodera H.264.

## Drzewo stron, element pod punktem, porównanie z `open-computer-use` — 2026-10-01

**Co i jak**
- `Tree.swift`: stan „collapsed” tylko dla ról, które się rozwijają; pusta
  wartość tylko dla pól tekstowych; akcja własna pokazywana po nazwie, a
  `perform_secondary_action` odnajduje ją po tej nazwie (`Act.swift`).
  Powód: w Safari każdy element strony miał `value="" collapsed`, a akcje
  własne zajmowały trzy wiersze.
- `Act.swift`, `AppState.swift`, `Action.swift` (`FrameHit`): element pod
  punktem brany też z ramek zapamiętanego stanu. Wzorzec: `clickCandidates` /
  `bestElement(containing:)` w `open-computer-use`.
- `helper.test.ts`: test nieaktualnych pikseli wyciąga aplikację testową na
  wierzch, bo System Events nie sięga okna na innym biurku.
- [`open-computer-use-comparison.md`](open-computer-use-comparison.md).

**Testy (Red → Green)**
- `WebContentTreeTests` (2 testy): Red błąd kompilacji (`no member 'action'`)
  → Green.
- `FrameHitTests`: Red `cannot find 'FrameHit'` → Green.
- e2e „presses a control under a point…”: uruchomiony sam, z oknem na innym
  biurku, czerwony (`method: input` zamiast `ax`) → zielony.

**Próba z modelem:** Safari na lokalnej stronie (luna7b) — tytuł i nagłówek
odczytane poprawnie.

**Walidacja:** `swift test` 137/137; plugin 20 plików / 285 testów (z e2e);
`pnpm build` 88/88; typecheck OK; lint 0 błędów; `check:deps` 0 błędów.

## Mysz w tle, 12 narzędzi, dokładny zrzut okna, `xhigh`, status na telefonie, wideo na Windows — 2026-10-01

Decyzje właściciela z tego dnia: „opcja 1” (prywatne wywołania do myszy w tle,
z zapasem na prawdziwe wejście), „opcja 2” (odchudzenie zestawu narzędzi),
próby z modelem na `reasoning.effort: xhigh`.

**Wzorzec:** `open-computer-use` (`sky_click`), commit `93b8175`; opis w
[`open-computer-use-comparison.md`](open-computer-use-comparison.md).

**Co i jak**
- `BackgroundInput.swift` (nowy), `MouseInput.swift`, `Act.swift`: klik,
  przeciąganie i kółko wysyłane do okna w tle przez `SLEventPostToPid` i
  pokrewne, szukane w czasie działania. Helper sprawdza skutek (piksele okna do
  0,6 s albo zmiana drzewa). Bez skutku, przy powtórzeniu tego samego gestu,
  przy prawym i środkowym przycisku i dla okna poza ekranem używa prawdziwego
  wejścia. Wynik helpera podaje trasę: `ax`, `background`, `input`.
- `src/contract/tools.ts`, `src/backend/backend.ts`: 12 narzędzi zamiast 19.
  `computer_drag` bierze punkt początku i końca. Helpery nadal znają batch,
  screenshot, mouse, hold_key, paste i select_text (protokół v5 bez zmian).
- `Capture.swift` (`CaptureRoute`): okno na bieżącym ekranie jest zrzucane
  przez swój ekran, z samym tym oknem. Powód: powierzchnia okna CapCut (Qt)
  jest większa niż jego ramka i zrzut samego okna był przeskalowany o ok. 1%,
  więc punkt odczytany z obrazu mijał krawędź klipu o 5–7 px.
- `Capture.swift` (`Attempts`): okno, którego system przez chwilę nie ma na
  liście, jest szukane do 4 razy co 0,25 s. Powód: w próbie luna9g dwa
  wywołania pod rząd skończyły się „The window is not capturable”.
- Poziom `xhigh` dla `context.reasoning.effort`: SDK (`ReasoningEffort`),
  core, config, runner, kontrakt IPC, ustawienia desktopu, dostawca Codex.
  Anthropic dostaje `high`.
- `packages/cli/src/setup/context-config.ts`: `context.reasoning` z configu
  jest stosowane przy starcie sesji. Wcześniej działało tylko po zmianie
  configu w trakcie pracy, więc `moxxy -p` zawsze szło na `medium`. Wszystkie
  wcześniejsze próby luna szły więc na `medium`.
- Kanał mobilny: `computer.snapshot` i zdarzenie `computer.changed`;
  `computer.snapshot` na liście komend zdalnych. `computer.control` celowo nie:
  pauza, wznowienie i przejęcie zostają przy komputerze, telefon zatrzymuje
  turę przez `session.abortTurn`. Aplikacja mobilna nie ma jeszcze paska stanu.
- Windows: `native/src/video.cpp` (enkoder H.264 z Media Foundation),
  `video-format.hpp` (rozmiar, nazwa kodeka, NV12), `preview.cpp` (zdarzenia
  `preview_chunk`, `preview.keyframe`). Gdy system nie ma enkodera, helper
  wysyła obrazy JPEG, a `PreviewController` je pokazuje.

**Testy (Red → Green)**
- Swift: `PointerRouteTests`, `WindowEventTests`, `VisibleChangeTests`,
  `CaptureRouteTests` (Red `cannot find 'CaptureRoute' in scope`),
  `AttemptsTests` (Red `cannot find 'Attempts' in scope`), `DragMotionTests`,
  `BlankImageTests`, `KeyRouteTests`.
- Plugin: `tools.test.ts` przepisany pod 12 narzędzi; `helper.test.ts` — klik,
  przeciąganie i kółko w tle, zapas na prawdziwe wejście;
  `controller.test.ts` „shows the pictures of a producer that was asked for
  video…” (Red `expected [] to deeply equal ['still']`).
- `xhigh`: `reasoning-config.test.ts` (Red `ZodError`), `validation.test.ts`
  (Red `Invalid enum value`), `integration.test.ts` runnera (Red
  `invalid_enum_value`), `effort.test.ts` (Red brak modułu),
  `context-config.test.ts` (Red brak modułu).
- Mobile: `single-session-host.test.ts` (Red `no handler for
  computer.snapshot`), `remote.test.ts` (Red brak `computer.snapshot`).
- C++: `tests/video-format.cpp` (Red brak nagłówka), uruchamiany także lokalnie
  przez `cmake` + `ctest`.

**Próby z modelem:** tabela w [`benchmark.md`](benchmark.md). Żądanie do
dostawcy sprawdzone na łączu: `gpt-6-luna {"effort":"xhigh"}`.

**Walidacja**
- `swift test` 155/155; `./build.sh` OK; `cmake` + `ctest` lokalnie 3/3.
- Plugin przy bezczynnym wejściu: 20 plików / 282 testy (z e2e).
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów (96
  ostrzeżeń); `pnpm check:deps` 0 błędów (1 ostrzeżenie).
- Pakiety: cli 454, config 128, core 532, sdk 464, runner 159,
  desktop-host 805, desktop 898, desktop-ipc-contract 61,
  plugin-channel-mobile 70, ipc-server-ws 72, dostawcy Codex 91 i Anthropic 60.

**Niezrobione / otwarte**
- Enkoder Windows jest napisany bez lokalnego Windows; jego wynik w CI jest
  w następnym wpisie.
- Próg benchmarku nie jest zmierzony powtórzeniami (seria A: 11/11, każda
  próba raz).
- Lista w [`todo.md`](todo.md), sekcja „Otwarte”.

## Wynik CI Windows dla enkodera H.264 — 2026-10-01

- Commit `c58ac4a8`, run 36892710179: kompilacja i `ctest` (10/10) zielone,
  helper wysłał wideo, ale test był czerwony: „The key picture does not begin
  with its parameter sets”. Enkoder Microsoftu zaczyna klatkę kluczową od
  znacznika AUD (typ 9), potem SPS, PPS i obraz. Błąd był w teście, nie w
  strumieniu.
- Commit `b0ec73f4`, run 36893271486: zielony. Test sprawdza teraz kolejność
  jednostek (SPS przed obrazem, PPS obecny), numerację kawałków i klatkę
  kluczową po `preview.keyframe`.
- Nie sprawdzono: dekodowania tego strumienia w oknie desktopu na prawdziwym
  Windows (WebCodecs) ani systemu bez enkodera (zapas JPEG ma tylko test
  `PreviewController`).

## Powtórzenia benchmarku, cztery poprawki i czas kroku — 2026-10-01

**Co**
- Powtórzenia serii A: 16/21 (76%), próg nie spełniony; szczegóły i przyczyny
  w [`benchmark.md`](benchmark.md), wynik D.
- SDK: `ToolDef.liveState` i strażnik pętli liczący takie narzędzia tylko
  jedno po drugim (`mode/stuck-loop.ts`, `tool-dispatch.ts`, `define.ts`).
- SDK/core/CLI: leniwe ładowanie narzędzi włącza się samo powyżej 200 narzędzi
  (`tool-gating.ts`: `shouldGateTools`, rodziny `prefix_*`, `matchLoadableTools`;
  `load_tool` przyjmuje `computer_*`). `context.lazyTools` nieustawione = auto.
- Helper macOS: `RepeatKey` i `lastSoft` (ponowiona akcja AX bez zmiany idzie
  prawdziwym kliknięciem, a gdy i ono nic nie zmienia, wynik to `ineffective`),
  `AXReader.strayFocus` + `NodeSnapshot.adopting` (pole zmiany nazwy Findera),
  `Typing.takesNoText`, `WebContent.isLoaded` i ponawianie stanu przeglądarki
  (`web: true`, `contentPending`), `Foreground.awaitOnTop` po wyniesieniu okna.
- Backend: wynik `ineffective` z helpera liczy się do limitu `no_progress`;
  narzędzia patrzące mają `liveState`; notatka, gdy strona się nie wczytała.
- Windows: helper przyjmuje i pomija pole `web` (sprawdza to tylko CI).
- Wskazówki: nazwij aplikację od razu, wynik akcji ma już świeży stan, kilka
  akcji w jednej odpowiedzi, cały tekst jednym wywołaniem.

**Jak (decyzje)**
- Powolność nie leżała w helperze (ok. 1,4 s na akcję), tylko w żądaniu do
  dostawcy: 513 schematów narzędzi w każdym. Stąd auto-leniwe ładowanie, a nie
  skracanie odczekania po akcji.
- Niższy poziom rozumowania jest szybszy, ale model mylił cyfry; zostaje `xhigh`.
- Eskalacja do prawdziwego kliknięcia dopiero przy powtórce, żeby pierwsza
  próba nie zabierała użytkownikowi fokusu.

**Testy (Red → Green)**
- `stuck-loop.test.ts` (liveState), `tool-gating.test.ts` (próg, rodziny),
  `synthesize.test.ts` (`load_tool` z `prefix*`), `context-config.test.ts`.
- `backend.test.ts`: `web` dla przeglądarki, notatka `contentPending`, „does
  not send again an action the helper itself found ineffective” (Red: trzecie
  wywołanie nie było odrzucane).
- Swift: `WebContentTests`, `RepeatKeyTests`, `StrayFocusTests`,
  `TextTargetTests`. E2E: „clicks for real a control that accepts an
  accessibility press and does nothing, once asked again” (przycisk Stubborn
  w fixture).

**Walidacja**
- `swift test` 160/160; `./build.sh` OK.
- Plugin przy bezczynnym wejściu: 20 plików / 287 testów (z e2e).
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów (96
  ostrzeżeń); `pnpm check:deps` 0 błędów (1 ostrzeżenie).
- Pakiety: sdk 471, core 533, cli 455, config 128, plugin-cli 335, runner 159.

**Niezrobione / otwarte**
- Pełne 5 powtórzeń po poprawkach; po poprawkach każda z czterech prób poszła raz.
- Zmiana w `desktop.cpp` nie była kompilowana lokalnie; CI Windows dla commita
  `40d310ea` (run 36920417527) jest zielone.
- Krok trwa ok. 5 s; model nadal wysyła jedną akcję na odpowiedź.

## Scenariusz Safari właściciela: trzy błędy z próby w desktopie — 2026-10-01

**Co**
- Helper macOS: `WireKey` (klucz dłuższy niż 512 jednostek dostaje skrót całej
  ścieżki i czytelny koniec, więc zostaje unikalny), `String.fitting` (limity
  w jednostkach UTF-16, bez cięcia znaku), tytuł w kluczu skrócony do 64.
- Helper macOS: `insertAtCaret` sprawdza `TextFootprint` (wartość i kursor
  tekstu) i przy braku zmiany oddaje pisanie klawiszom (`Typing.landed`).
- Helper macOS: `OverlayPanel` nie pozwala AppKit zsuwać nakładki pod pasek menu.
- Backend: błąd „invalid … result” podaje pole, które nie przeszło walidacji.
- Fixture: pole „deaf” (przyjmuje tekst przez accessibility i go gubi).

**Jak (decyzje)**
- Kontrakt zostaje ścisły (unikalne klucze, limity); poprawiony jest helper,
  który go łamał.
- Tekst wpisany przez accessibility jest sprawdzany do 0,3 s; aplikacje
  Chromium zgłaszają nową wartość z opóźnieniem.

**Testy (Red → Green)**
- Swift: `WireLimitTests` (Red: brak `fitting`), `InsertionCheckTests` (Red:
  brak `TextFootprint`), `coversAWindowThatTouchesTheMenuBarWithoutSlidingDown`
  (Red: ramka nakładki inna niż oczekiwana).
- E2E: „types with keys into a field that accepts text through accessibility
  and drops it” (Red: `method: 'ax'` zamiast `'input'`).
- `backend.test.ts`: „names the field of a helper result that breaks the
  contract” (napisany po zmianie, bez osobnego Red).

**Walidacja**
- `swift test` 165/165; `./build.sh` OK.
- Plugin przy bezczynnym wejściu: 20 plików / 289 testów (z e2e).
- `pnpm build` 88/88; `pnpm -r typecheck` OK; `pnpm lint` 0 błędów;
  `pnpm check:deps` 0 błędów (1 ostrzeżenie).
- Próba z modelem: [`benchmark.md`](benchmark.md), wynik E.

**Niezrobione / otwarte**
- Scenariusz Safari poszedł po poprawce raz, w CLI, nie w aplikacji desktopowej.
- Raz Safari w tle przestało udostępniać treść strony (22 elementy zamiast 700);
  po wyniesieniu okna na wierzch wróciła. Nie odtworzone ponownie; model
  dostaje wtedy notatkę, że strona nie jest czytelna.
- Stan strony YouTube to ok. 700 elementów i 220 KB; nie skracano go.
- Helper Windows: nie sprawdzano, czy ma ten sam błąd z kluczami.

## Strona, której przeglądarka nie udostępnia: budzenie accessibility — 2026-10-01

**Wzorzec.** `SkyComputerUseService` (Codex) ma `AXEnablementAssertion`,
`enableEnhancedUserInterface` i `enableElectronAccessibility` oraz napisy
`AXEnhancedUserInterface`, `AXManualAccessibility` (odczyt `strings`). Nasz
helper nie ustawiał żadnego z nich. W `app.asar` Claude tych napisów nie
znaleziono.

**Co**
- `AccessibilityWake`: przy pierwszej obserwacji aplikacji włącza oba
  przełączniki; przy wyjściu helpera wyłącza te, które sam włączył.
- `WebContent.awaited`: gdy strona nadal się nie pokazuje, okno jest raz
  wynoszone na wierzch i odczyt jest ponawiany. Dopiero potem model dostaje
  notatkę `contentPending`.
- `WebContent.isPending`: czekamy tylko na stronę, której brakuje (pusty
  `AXWebArea` albo pusta grupa kart). Strona startowa Safari nie ma na co
  czekać: odczyt 1,8 s zamiast 7,9 s.

**Testy (Red → Green)**: `AccessibilityWakeTests`,
`keepsReadingWhileThePageLoadsWithoutTakingTheScreen`,
`bringsTheWindowForwardOnceWhenThePageNeverShowsInTheBackground`,
`waitsOnlyForAPageThatIsMissingNotForAWindowWithoutOne` (Red: brak typu lub
funkcji).

**Walidacja**: `swift test` 170/170; plugin 289/289 (z e2e); `pnpm build`
88/88; typecheck i lint bez błędów.

**Niezrobione / otwarte**
- Stanu „22 elementy” nie udało się odtworzyć, więc poprawka nie jest
  sprawdzona na tym przypadku, tylko testami jednostkowymi i na zwykłych
  stronach w tle.
- Nie sprawdzono na Chrome ani innych aplikacjach Electron poza ChatGPT.

## Skille poza zasięgiem i krótszy stan stron WWW — 2026-10-01

**Co**
- SDK: `skillsWithinReach` — skill z listą `allowed-tools` nie trafia do
  indeksu, gdy żadnego z tych narzędzi nie ma w sesji (końcowe `*` to prefiks).
  Użyte w pętli domyślnej (`react-loop.ts`) i w trybie research.
- Helper macOS, `TreeBuilder` wewnątrz `AXWebArea`: `AXShowMenu` nie jest
  wypisywane (ma je każdy element strony; menu otwiera prawy przycisk), puste
  grupy przez to znikają, a węzeł, który tylko powtarza nazwę rodzica (łącze w
  łączu, tekst łącza), nie dostaje własnej linii. Opis równy tytułowi jest
  pomijany wszędzie.
- Skill użytkownika `visual-browser-control` przeniesiony do Kosza na prośbę
  właściciela (był pisany pod stare narzędzia).

**Jak (decyzje)**
- Reguła „żadnego narzędzia”, a nie „któregokolwiek brak”: listy w skillach
  użytkownika są luźne („web-research”, dwa alternatywne serwery MCP), więc
  ostrzejsza reguła ukryłaby działające skille. Ta reguła nie ukryłaby
  `visual-browser-control` (miał `Bash`); stąd usunięcie pliku.
- Stan jest skracany w helperze, nie w formatowaniu, żeby indeksy i różnice
  liczyły się na tym samym drzewie.

**Testy (Red → Green)**: `skillsWithinReach` w `project-messages.test.ts`
(Red: `is not a function`); `WebTreeTests` (Red: trzy niespełnione oczekiwania).

**Pomiar**: strona kanału YouTube 55 007 → 22 455 znaków (732 → 386 linii).
Scenariusz Safari, `gpt-6-luna` `xhigh`, jedna próba: sukces, 16 wywołań,
165 s (poprzednio 21 i 187 s), adresy kart sprawdzone niezależnie. Podział
czasu: narzędzia 26 s, oczekiwanie na początek odpowiedzi 27 s, reszta
(ok. 110 s) to generowanie odpowiedzi przez model w 17 żądaniach.

**Walidacja**: `swift test` 173/173; plugin 289/289 (z e2e); sdk 473, core 533,
cli 455, mode-deep-research 33; `pnpm build` 88/88; typecheck, lint,
`check:deps` bez błędów.

**Niezrobione / otwarte**
- Model nadal wysyła jedną akcję na odpowiedź; to teraz główny koszt czasu.
- W tej próbie model załadował skill `browser` zamiast `visual-browser-control`.

## Czarny podgląd na żywo, wygląd PiP i kursora — 2026-10-01

**Zgłoszenie właściciela (test w desktopie):** zadania wykonują się poprawnie,
ale PiP to czarny prostokąt z kropką, a kursor wygląda staro.

**Co**
- `video-preview.ts`: płótno PiP powstaje dopiero po pierwszym kawałku wideo
  (on podaje rozmiar), więc pierwsza klatka kluczowa nie miała gdzie się
  narysować, a nieruchomy ekran nie wysyła następnych. Płótno, które przychodzi
  po rozpoczęciu strumienia, prosi teraz o klatkę kluczową.
- `computer-control.css`, `ComputerPreviewPip.tsx`: PiP i pasek stanu na
  tokenach aplikacji (wcześniej nieistniejące zmienne z wartościami zapasowymi).
  PiP: zaokrąglenie 12 px, cienka ramka, cień nakładki, podpis ze stanem (dioda)
  i przyciskami na obrazie, widoczny po najechaniu lub fokusie; pod paskiem
  stanu, żeby nie zasłaniał „Stop”. Kursor w PiP to ta sama strzałka co na
  ekranie.
- `CursorOverlay.swift`: kursor agenta jako grot o zaokrąglonych rogach z białą
  obwódką i miękkim cieniem; pierścień kliknięcia z wypełnieniem; ramka
  elementu cieńsza, z lekkim wypełnieniem.

**Testy (Red → Green)**: „asks for the picture again when the canvas arrives
after the stream began” (Red: `expected [] to deeply equal [1]`). Wygląd
sprawdzony na statycznej makiecie w obu motywach i na renderze ścieżki kursora.

**Walidacja**: desktop 899/899; `swift test` 173/173; `pnpm build` 88/88;
typecheck i lint bez błędów.

**Niezrobione / otwarte**
- Testów e2e helpera nie uruchomiono po zmianie rysunku kursora (właściciel
  w tym czasie testował aplikację; testy używają prawdziwej myszy).
- Obrazu w PiP nie widziałem w działającej aplikacji; poprawka wynika z kodu
  i testu, potwierdzenie należy do właściciela.

## Okno pełnoekranowe na innym biurku, PiP 30 kl./s — 2026-10-02

**Zgłoszenie właściciela:** obraz w PiP jest; podnieść do 30 klatek i zmierzyć
obciążenie. Zadanie w Arc (nowa karta, Dysk Google, pobranie pliku) skończyło
się po 9 krokach komunikatem „Arc nie dał się uaktywnić”.

**Przyczyna (log sesji + sondy)**
- Arc był w trybie pełnoekranowym, czyli na własnym biurku (Space typu 4,
  `AXFullScreen = 1`, `AXWindows` puste). Stan miał 13 wyłączonych przycisków
  paska, bez strony i bez zrzutu („The window could not be captured”).
- `Foreground.bring` prosił tylko przez accessibility (`AXFrontmost` +
  `AXRaise`). Dla takiego okna oba wywołania zwracają sukces i nic się nie
  dzieje (sonda: 3 s bez zmiany). `NSRunningApplication.activate()` przełącza
  na to biurko w 0,19 s.
- Po nieudanym stanie model sięgnął po narzędzia przeglądarki w oknie Moxxy
  (`browser_tabs`), bo notatka dla przeglądarek kazała tak robić dla każdej
  strony; zadanie przyszło z Telegrama, więc panelu nie było.

**Co**
- `MouseInput.swift`: `Foreground.attempt` próbuje kolejnych sposobów; okno
  dostaje 0,4 s na prośbę przez accessibility, potem aktywację przez workspace.
  Aplikacja bez okna od razu idzie przez workspace (jak dotąd).
- `skills/computer-apps/browsers.md`: gdy użytkownik wskazuje tę przeglądarkę
  albo zadanie wymaga jej kart, kont lub pobrania pliku, praca idzie przez
  Computer Use; narzędzia przeglądarki otwierają inną przeglądarkę. Dodane
  skróty nowej karty i pola adresu.
- `controller.ts`: tempo zależy od rodzaju strumienia: wideo 30 kl./s (maks.
  30), pojedyncze obrazy JPEG 2 (maks. 5), bo każdy to cały obraz. Helpery
  macOS i Windows przyjmują do 30.

**Testy (Red → Green)**: `ForegroundTests` ×3 (Red: `type 'Foreground' has no
member 'attempt'`); „runs video at 30 pictures a second…” i pięć testów
oczekujących `start 30 h264` (Red: `expected [ 'start 2 h264' ]`).

**Sprawdzone na Arc w trybie pełnoekranowym, z innego biurka**
- `computer_get_app_state`: zrzut jest, 974 elementy strony (było 13 i brak zrzutu).
- `computer_press_key super+t`: `delivered` (było `not_frontmost`).

**Pomiar PiP** (helper, okno 1200×760 w ciągłym ruchu, 15 s, M1 Max; procent
jednego rdzenia)

| Strumień | Obrazów/s | kbit/s | Helper | replayd |
|---|---|---|---|---|
| H.264, 2 kl./s | 2,0 | 574 | 0,6% | 0,4% |
| H.264, 15 kl./s | 15,0 | 720 | 3,5% | 1,3% |
| H.264, 30 kl./s | 29,7 | 1210 | 7,0% | 2,1% |
| JPEG, 5 kl./s | 5,1 | 5015 | 5,3% | 0,7% |
| H.264, 30 kl./s, okno nieruchome | 29,8 | 49 | 5,4% | 2,8% |

WindowServer: 42–54% we wszystkich seriach, także bez podglądu (to koszt
samego ruchomego okna); różnicy od tempa nie widać ponad szum.

**Niezrobione / otwarte**
- Całego zadania w Arc nie powtórzono z modelem.
- Koszt po stronie odbiorcy (host, dekoder w oknie desktopu) niezmierzony.
- Windows: zmiana limitu sprawdzona tylko przez CI.

## Nieruchome okno nie jest kodowane — 2026-10-02

**Co**: `Preview.swift`, `ShownPicture`: helper pamięta ostatnio wysłany obraz
i pomija kolejny, jeśli piksele są te same (obie płaszczyzny formatu 420v,
bez dopełnienia wierszy). Informacja systemu o zmienionych obszarach
(`dirtyRects`) nie nadaje się do tego: dla okna podaje cały obszar w każdej
klatce (sprawdzone na Kalkulatorze).

**Testy (Red → Green)**: `ShownPictureTests` ×3 (Red przy wyłączonym
pomijaniu: „Expectation failed: !shown.isNew(picture(10))”).

**Pomiar** (30 kl./s, 10 s): okno nieruchome 0,1 obrazu/s, 3 kbit/s, helper
1,9% (było 29,8 obrazu/s i 5,4%); okno w ruchu 29,8 obrazu/s, helper 8,2%
(porównanie pikseli kosztuje ok. 1–2 pkt). replayd bez zmian (ok. 2,5%): samo
przechwytywanie nadal działa.

**CI Windows dla `0dd72730`**: krok „Repeat real desktop tests” padł w
kontroli wstępnej („Capture did not contain fixture pixel markers”), zanim
uruchomił testy; pierwsze przejście tych samych testów w tym przebiegu było
zielone. Zmiana w Windows to tylko limit tempa podglądu, którego kontrola
wstępna nie używa. Ponowiony przebieg jest zielony.

## Linux L1 — warstwa TypeScript — 2026-10-02

**Decyzje dla helpera Linux**
- Język C++20, biblioteki systemowe: `libatspi` (drzewo i akcje accessibility),
  Xlib + XTest + XComposite (okna, zrzut, wejście), `libjpeg`. Bez nowych
  zależności w npm.
- Zakres: sesje X11. Wayland nie pozwala obcemu procesowi czytać okien ani
  wysyłać wejścia bez portalu z pytaniem przy każdej sesji; `computer_status`
  ma to mówić wprost.
- Podgląd na żywo: obrazy JPEG (bez kodera wideo), więc profil podaje tylko
  `jpeg` i kontroler nie prosi o H.264.
- Ten sam protokół v5 i te same 12 narzędzi modelu.

**Co**
- `artifact.ts`: manifest z `os: "linux"` wymaga 64-bitowego pliku ELF dla
  podanej architektury (x64 → EM_X86_64, arm64 → EM_AARCH64); bez `os` ELF
  jest odrzucany jak dotąd.
- `linux/profile.ts`, `index.ts`: Linux x64/arm64 dostaje profil z helperem
  w `bin/linux-<arch>/`; bez helpera zostaje samo `computer_status` z powodem.
- `keys.ts`, `guidance.ts`: platforma `linux` (skróty systemowe: Alt+F4,
  Alt+Tab, Ctrl+Alt+F1–F12, Super+L i inne; „super” to klawisz Super).
- `access.ts`, `browsers.md`: identyfikatory `.desktop` przeglądarek i terminali.

**Testy (Red → Green)**: „Linux helper artifact” ×2, klawisze systemowe ×6,
kategorie ×4, profil i wybór platformy ×3, wskazówka o klawiszu Super
(Red: 10 testów czerwonych + brak modułu `./linux/profile.js`).
