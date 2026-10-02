# Przebudowa Computer Use (`computer-use-rebuild`)

Plan odtworzenia działania Computer Use z Codex Desktop i Claude Desktop w
`@moxxy/plugin-computer-control`. Postęp śledzi [`todo.md`](todo.md), a przebieg
prac [`CHANGELOG.md`](CHANGELOG.md). Te trzy pliki są punktem wejścia dla każdej
osoby przejmującej pracę.

## Stan wyjściowy

- **macOS** korzysta z `osascript`/System Events, `screencapture` i `sips`.
  Klika w globalne piksele bez przeliczania współrzędnych, nie widzi drzewa
  dostępności (AX), nie identyfikuje okien i nie daje człowiekowi kontroli
  (Pause/Stop).
- **Windows x64** ma rozbudowany helper C++ (UIA, WGC, SendInput, strażnik wejścia,
  Stop), ale ciężki kontrakt dla modelu: 21 narzędzi, `windowId + observationId +
  elementId` przy każdej akcji i długi prompt reguł, który musi zakazywać modelowi
  wymyślania identyfikatorów.

## Wnioski z raportów Codex i Claude (30.09.2026)

Źródła: raport Claude Desktop 2.16120.0 i raport Codex Desktop (ChatGPT.app)
26.928.21956, oba przygotowane na tym komputerze.

**Wspólne dla obu systemów**

| Cecha | Claude | Codex |
|---|---|---|
| Brak planera w aplikacji; pętlę „obserwuj → działaj → sprawdź” prowadzi model, runtime wymusza ją kontraktami i komunikatami błędów | ✔ | ✔ |
| Osobny proces natywny z JSON-RPC, start leniwy, restart po awarii | `app-cu-helper` (stdio) | `SkyComputerUseService` (socket) |
| ScreenCaptureKit + drzewo AX + CGEvent | ✔ | ✔ |
| Uprawnienia systemowe oddzielone od zgody na aplikację | tier `read`/`click`/`full` | `session`/`always` + polityka |
| Zrzut dla modelu tylko na żądanie | ✔ | ✔ |
| Stop kończy turę bez powtarzania akcji | Escape | Escape, `userIntervened` |
| Wiele akcji w jednym wywołaniu, stan na końcu | `computer_batch` | batch w REPL |
| Treść aplikacji to niezaufane dane | `DATA-ONLY` | instrukcje Skysight |
| Brak AppleScript/System Events do interakcji | ✔ | skill tego zabrania |

**Różnice**

| Obszar | Claude | Codex |
|---|---|---|
| Podstawowa obserwacja | zrzut całego ekranu | tekst drzewa AX okna, zrzut opcjonalny |
| Wskazanie celu | piksele ostatniego zrzutu | `element_index` z drzewa AX |
| Kontrola przed akcją | frontmost, hit-test, łatka pikseli 9×9 | aktualność drzewa i okna |
| Oszczędność tokenów | budżet obrazu 1568 px / 1568 kafelków 28×28 | diff drzewa AX |
| Settling | po stronie modelu | runtime: ~1 s, do 5 s |
| Kursor | prawdziwy wskaźnik z animacją | programowy kursor (`ComputerUseCursor`, `SoftwareCursorStyle`) nad oknem celu |
| Podgląd dla człowieka | `[cu-live-preview]` ≤2 kl./s | PiP: wideo (`RemoteHostedPIPVideoEncoder` → `MediaStreamTrackGenerator`), latest-frame |
| Sygnalizacja | poświata krawędzi | status + PiP |

Wykonanie w obu systemach nie jest bezbłędne: Claude chybił przez przesunięty
układ strony, u Codexa lista się nie rozwinęła, a Kalkulator nie oddał zrzutu.
Skuteczność bierze się z pętli weryfikacji i zmiany metody po porażce.

**SkyLight.** Claude wysyła w tle surowe zdarzenia prywatnym
`SLEventPostToPid`. U Codexa SkyLight pojawia się tylko wewnątrz
ScreenCaptureKit. Plan zakładał, że go nie używamy. Decyzją właściciela
(2026-10-01) używamy go do myszy w tle, z zapasem: gdy wywołań nie ma albo
okno nie reaguje, helper przechodzi na prawdziwe wejście. Symbole są szukane
w czasie działania, nic nie jest linkowane.

## Decyzje

| Temat | Decyzja |
|---|---|
| Wzorzec | Odtwarzamy system Codex + Claude na podstawie ich plików (read-only). Kod piszemy sami. |
| Kontrakt modelu | Jak `cua`/`sky` Codexa, jako osobne narzędzia moxxy (każde przechodzi przez `PermissionEngine`), uzupełniony o mechanizmy Claude'a |
| Kursor | Nakładka (jedno okno wielkości okna celu) tuż nad oknem celu, widoczna, gdy to okno jest na bieżącym ekranie; pozycja jako ułamek okna idzie zawsze do snapshotu (PiP). Prawdziwy wskaźnik porusza się tylko przy fizycznym kliknięciu i wraca na miejsce. Akcje AX nie ruszają myszy. |
| PiP | Strumień dla człowieka, oddzielony od modelu: najpierw JPEG przez Surface, potem H.264 + WebCodecs |
| Poświata krawędzi | Nie robimy; zamiast niej czytelny status sterowania |
| SkyLight | Tylko mysz w tle na płótnie (klik, przeciąganie, kółko), lewy przycisk; prawdziwe wejście jako zapas |
| macOS | 14+, universal binary (arm64 + x86_64) |
| Linux | sesje X11, x64 i arm64; helper C++ (AT-SPI + X11), opis w [`../computer-use-linux.md`](../computer-use-linux.md) |
| Przeglądarki | Domyślnie poziom `read`; zadania webowe idą do `@moxxy/plugin-browser` |

### Dlaczego nowy kontrakt, a nie obecny kontrakt Windows

Skuteczność zależy od jakości obserwacji, ochrony przed nieaktualnym stanem,
settlingu, pętli weryfikacji i zmiany metody po porażce. Liczba identyfikatorów,
które model musi przepisywać, nie ma tu znaczenia. Nowy kontrakt przenosi rygor
do helpera: helper trzyma ostatni stan celu, sprawdza tożsamość elementu i
odrzuca nieaktualny indeks lub punkt. `target_blocked`, rozróżnienie
„dostarczone ≠ zweryfikowane” oraz Pause/Stop zostają. Dochodzą hit-test,
łatka pikseli, frontmost, poziomy zgody i settling.

## Kontrakt dla modelu

| Narzędzie | Wzorzec | Opis |
|---|---|---|
| `computer_status` | własne | uprawnienia i stan helpera; otwiera ustawienia tylko dla brakującego uprawnienia |
| `computer_list_apps` | Codex `list_apps` | aplikacje (+ okna na Windows), `isRunning`, identyfikator |
| `computer_request_access` | Claude `request_access` | zestaw aplikacji, poziomy `read`/`click`/`full`, flagi schowka i skrótów systemowych; zapis w logu sesji |
| `computer_get_app_state` | Codex `get_app_state` | `{app, window_id?, disable_diff}`; drzewo z `element_index` (domyślnie diff) i zawsze obraz okna |
| `computer_click` | Codex + bramki Claude | `element_index` lub `x,y` obrazu okna; przycisk, liczba kliknięć |
| `computer_type_text` | Codex | `{app, text, element_index?}`; bez celu tekst idzie do elementu z fokusem |
| `computer_press_key` | Codex (składnia xdotool) | `{app, key, repeat}`; kombinacje systemowe wymagają flagi |
| `computer_scroll` | Codex | element lub punkt; `pages` |
| `computer_drag` | Codex | `{app, from_x, from_y, to_x, to_y}`, lewy przycisk, 600 ms |
| `computer_set_value` | Codex | na elemencie |
| `computer_perform_secondary_action` | Codex | tylko akcja ujawniona w drzewie |
| `computer_zoom` | Claude | `{app, region}`: wycinek ostatniego zrzutu okna z bliska |

To 12 narzędzi (od 2026-10-01). Wcześniej było 19; `computer_paste`,
`computer_select_text`, `computer_mouse`, `computer_hold_key`,
`computer_batch`, `computer_screenshot` i `computer_wait` zdjęto z listy
modelu, bo `gpt-6-luna` wypełniał każde pole każdego narzędzia i mylił je.
Helpery nadal obsługują te metody (protokół v5 bez zmian, testy e2e helpera
zostały).

Każda akcja zwraca `{outcome: delivered | ineffective | unsupported | blocked,
code, hint}` i domyślnie świeży stan po settlingu.

Kontrakt w kodzie: `packages/plugin-computer-control/src/contract/` — schematy
narzędzi (`tools.ts`), parser klawiszy xdotool (`keys.ts`), budżet obrazu i
mapowanie współrzędnych (`image.ts`), kody błędów z podpowiedziami
(`outcome.ts`), tekst drzewa i diff (`tree.ts`), ogrodzenie danych
niezaufanych (`untrusted.ts`).

## Architektura

```
model ─▶ dispatchToolCall + PermissionEngine + PermissionResolver
          │  (+ zgody per aplikacja z logu sesji)
   ComputerBackend (TS, wspólny)
   ├─ HelperTransport (JSON-lines stdio, kolejka, bez retry, zdarzenia)
   ├─ zgody: wynik `computer_request_access` w logu sesji → fold `accessFromLog` (jeden stan dla wszystkich powierzchni)
   │   + aplikacje z `computer_run` zatwierdzonego jako to wywołanie (`decidedNow`) → `approvedThroughRun`, poziom domyślny
   ├─ TurnControls (stan, kursor, cel) ─▶ runner `computer.changed` ─▶ desktop/mobile
   ├─ PreviewController ─▶ Surface `computer-preview` ─▶ `surface.data` ─▶ PiP
   ├─ contract/: schematy, klawisze, obraz, tekst drzewa + diff (wspólne dla helperów)
   └─ narzędzia computer_* (jeden kontrakt, adapter per platforma)
          │ stdin/stdout
   helper natywny: Swift (macOS) / C++ (Windows)
   ├─ stan celu: drzewo AX/UIA ze stabilnymi kluczami i indeksami + obraz okna + ramka
   ├─ settling na zdarzeniach (AXObserver / UIA), deadline
   ├─ bramki: zgoda/poziom, frontmost, hit-test, łatka pikseli, własne okno
   ├─ wykonawca: AX/UIA najpierw, fizyczne wejście jako fallback
   ├─ CursorPresenter (nakładka nad oknem celu, click-through, poza zrzutami)
   ├─ strażnik: Escape = Stop, ingerencja użytkownika = pauza
   └─ strumień podglądu (SCStream / WGC), osobny od obserwacji modelu
```

Zasady przekrojowe:

- wynik techniczny jest oddzielony od weryfikacji;
- każdy zrzut niesie własną ramkę współrzędnych;
- czekamy na zdarzenia, a timer służy tylko jako deadline;
- klatki PiP nigdy nie trafiają do modelu ani do logu sesji;
- komponenty UI są prezentacyjne, a logika siedzi w hookach.

## Warstwa decyzji Jev (`computer_run`) — 2026-10-02

Główny model pisze plan kroków w jednym wywołaniu; `src/jev/` (wspólne dla
macOS, Windows i Linuksa) wykonuje go na żywym drzewie elementów:

- `client.ts` — żądanie do `api.typesafe.ai/v1/systemone` (`jev-latest`),
  limit 8 s, jedno ponowienie przy 429/529, odpowiedzi sprawdzane przez zod.
- `ground.ts` — pytanie Choice „który element” (porcje po 250 opcji, do 1000
  elementów, opcja „none”); prawdopodobieństwo sumowane po przodkach i
  potomkach elementu.
- `ladder.ts` — kolejne sposoby wykonania kroku i ocena wyniku (`done`,
  `retry`, `stop`); kody ostateczne (np. `user_intervened`) kończą bieg.
- `run.ts` — pętla: jedno żądanie na krok (sprawdzenie kroku + element
  następnego), do 4 sposobów na krok, stop na pierwszym nieudanym.

- `memory.ts` — pamięć per aplikacja w `~/.moxxy/computer-use/learned/`:
  element i sposób dla opisu celu, efekt kroku (etykiety, które się pojawiły),
  całe trasy. Powtórzony krok nie pyta Jev o nic.

Kolejność: lekcje dostarczane z moxxy (`learned/` w paczce wtyczki, wypełniane
przez `pnpm --filter @moxxy/plugin-computer-control learned:promote`) → pamięć
tego komputera → Jev.

Bez klucza `computer_run` nie jest oferowany modelowi (hook
`onBeforeProviderCall` usuwa narzędzie i wzmiankę w regułach); reszta Computer
Use działa bez zmian.

Klucz: sekret `TYPESAFE_API_KEY` (vault) albo zmienna środowiskowa. Bez klucza
narzędzie odsyła do pojedynczych narzędzi. Do TypeSafe idzie tekst drzewa
okna, nazwy aplikacji i okna, cel i krok; bez zrzutu ekranu. Wzorzec:
`savka777/jev-use` (planer + ugruntowanie przez Jev), kod własny.

## Mapa plików referencyjnych (tylko do odczytu)

Codex (`/Applications/ChatGPT.app`, 26.928.21956). `OAI` =
`Contents/Resources/cua_node/lib/node_modules/@oai`:

| Plik | Po co |
|---|---|
| `OAI/sky/docs/skills/oai_sky_lib/macos/SKILL.md`, `.../windows/SKILL.md` | instrukcje dla modelu, API `sky` |
| `OAI/cua/docs/tinysky-alt-core-cua-repl.md` | ujednolicone API `cua` |
| `OAI/cua/dist/lib/js/oai_js_cua/src/tinysky_alt/{bind_mac_app,bind_windows_app,get_state,window_result,screenshot_bytes}.js` | wiązanie metod, obserwacje, obrazy |
| `OAI/sky/dist/project/cua/sky_js/src/targets/mac/{client,native-pipe,computer-use-policy,errors}.js` | protokół, polityka zgód, kody błędów |
| `OAI/sky/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService` | symbole: kursor, SCStream, AX (tylko `strings`/`nm`) |
| `Contents/Resources/app.asar` → `.vite/build/main-*.js`, `webview/assets/local-conversation-thread-*.js`, `avatar-overlay-native-page-*.js` | supervisor, PiP, pozycja kursora |

Claude (`/Applications/Claude.app`, 2.16120.0), rozpakowanie:
`npx @electron/asar extract /Applications/Claude.app/Contents/Resources/app.asar <dir>`.

| Plik | Po co |
|---|---|
| `.vite/build/index.chunk-DkY0FFgk.js` | schematy narzędzi, bramki (frontmost, hit-test, poziomy), mapowanie współrzędnych, łatka pikseli |
| `.vite/build/index.chunk-kXuYPTnM.js` | executory macOS/Windows, budżet obrazu, TCC |
| `Contents/Helpers/app-cu-helper`, `@ant/claude-swift/.../computer_use.node` | symbole natywne |

Nazwy chunków zmieniają się między wersjami. W `CHANGELOG.md` zapisujemy
wersję i plik, z którego wzięto wzorzec.

## Ryzyka

- **TCC.** W CLI uprawnienia należą do terminala. Monitorowanie klawiatury może
  wymagać Input Monitoring; sprawdzamy to w kroku 7.
- **Windows.** Lokalnie nie mamy Windows, więc krok 12 walidujemy wyłącznie w CI
  (`computer-use-windows.yml`).
- **Zmiana łamiąca.** Nowe narzędzia zastępują stare. Runner v23 i protokół
  Windows v5 wymagają zgodnego desktopu.
- **Wydajność PiP.** Mierzymy ją w krokach 11 i 13; fps jest konfigurowalne.
- **ScreenCaptureKit przy dwóch helperach.** Dwa procesy helpera naraz
  potrafią zawiesić przechwytywanie okna (odtworzone w kroku 7c). Jeden
  helper na sesję tego nie dotyka; do zbadania przed obsługą wielu sesji.
- **Branch bazowy.** `computer-use-rebuild` wyrasta z `google-gemini-tts`;
  scalenie z `development` tylko za zgodą właściciela.
- **Czas kroku.** Większość czasu to żądanie do dostawcy, nie helper. Przy
  wielu serwerach MCP narzędzia są ładowane leniwie (próg 200); poniżej progu
  każde żądanie nadal niesie wszystkie schematy. `computer_request_access`
  i `computer_run` są wysyłane zawsze (`alwaysLoaded`), więc zadanie nie
  zaczyna się od `load_tool`. Pomiary w
  [`benchmark.md`](benchmark.md).
- **Próg skuteczności.** Powtórzenia dały 76% przed czterema poprawkami; pełna
  seria po poprawkach nie jest jeszcze zrobiona.
- **Strony WWW przez accessibility.** Głębokie strony dają setki elementów i
  długie ścieżki; helper musi trzymać limity kontraktu (klucze, UTF-16), bo
  jedno złamane pole odrzuca cały stan.
- **Przełączniki accessibility.** Helper włącza aplikacjom
  `AXEnhancedUserInterface` i `AXManualAccessibility` (jak Codex) i wyłącza je
  przy wyjściu. Zabity helper (SIGKILL) ich nie cofnie.
- **Indeks skilli.** Skill z `allowed-tools`, z których żadne nie istnieje w
  sesji, nie jest pokazywany modelowi; `load_skill` po nazwie nadal go wczyta.
- **PiP wideo.** Dekoder rysuje tylko na istniejące płótno; płótno powstaje po
  pierwszym kawałku, więc prosi o klatkę kluczową, gdy się pojawi.
