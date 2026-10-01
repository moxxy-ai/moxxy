# Todo: przebudowa Computer Use

Plan: [`README.md`](README.md). Przebieg prac: [`CHANGELOG.md`](CHANGELOG.md).

## Gdzie jesteśmy

- **Bieżący krok:** 10 — przełączenie macOS na nowy backend i sprzątanie
  (krok 9 gotowy).
- **Następna czynność:** test wyboru backendu per platforma w
  `src/index.test.ts` (darwin → nowy backend, brak helpera → tylko
  `computer_status`), potem usunięcie `src/tools/*`, `shell.ts`,
  `temporary-files.ts`, nowy skill i pakowanie helpera.
- **Blokery:** brak.

## Rytuał każdego kroku

1. Przegląd wzorca w plikach Codex/Claude (read-only), notatka w `CHANGELOG.md`.
2. Red: test → uruchomić → potwierdzić porażkę z właściwego powodu.
3. Green: minimalna implementacja → testy zielone.
4. Refactor → testy ponownie.
5. Walidacja: `pnpm --filter <pakiety> test`, typecheck, `pnpm lint`,
   `pnpm build`, `pnpm check:deps`; `swift test` w `native/macos`.
6. Changeset + odhaczenie tutaj + wpis w `CHANGELOG.md`.
7. Commit (bez atrybucji AI) i push na `computer-use-rebuild`. Bez PR i merge.

## Kroki

### Krok 0 — dokumenty planu i przekazania
- [x] `docs/computer-use-rebuild/{README.md, todo.md, CHANGELOG.md}` z mapą plików referencyjnych.
- [x] Pusty changeset, commit i push.

### Krok 1 — wspólny transport helpera
- [x] `src/helper/{transport,protocol,artifact}.ts` (przeniesione z `windows/`), rejestr zdarzeń helpera (`control_state` wbudowany, pozostałe rejestrowane przez profil).
- [x] Weryfikacja artefaktu: PE x64 i Mach-O (universal/arm64/x86_64) + sha256.
- [x] Testy na skrypcie-fixture w Node; przeniesione testy Windows zielone.

### Krok 2 — nowy kontrakt narzędzi (czysta logika TS)
- [x] `src/contract/`: schematy narzędzi, `actionOutcome`, format tekstu drzewa z indeksami (+ diff), opakowanie danych niezaufanych.
- [x] Parser klawiszy w składni xdotool → neutralny opis (`super` → command/windows), kombinacje systemowe, flagi schowka.
- [x] `imageBudget`, `imagePointToScreen` (Retina, ujemny origin), podpowiedzi dla kodów błędów.

### Krok 3 — `ComputerBackend` i zgody per aplikacja
- [x] `src/backend/`: transport per sesja+tura, `TurnControls` (przeniesione z `windows/`), fabryka narzędzi z `computerTools`, `PlatformProfile`, metody helpera v5 (`rpc.ts`).
- [x] Zgody: `computer_request_access`, poziomy `read`/`click`/`full` z kategorii aplikacji, `full_access`, flagi; zapis = wynik narzędzia w logu sesji, stan = fold (`access.ts`).
- [x] Testy cyklu życia (helper-fixture), zgód (`tier_insufficient`, `system_key_combo`) i widoczności zgody z drugiego klienta.

### Krok 4 — szkielet helpera Swift
- [x] Swift Package `native/macos` (macOS 14, Swift 6): `ComputerUseCore` + `moxxy-computer`, `NSApplication` `.accessory`.
- [x] JSON-lines v5, `--parent PID` (DispatchSource), EOF = zakończenie, sterowanie poza kolejką żądań, `status`, `permissions.request`. Deadline operacji przeniesiony do kroku 5 (`AXUIElementSetMessagingTimeout` na wywołaniach AX); do tego czasu limit trzyma transport TS.
- [x] `native/macos/build.sh` → `bin/darwin-universal/moxxy-computer` + manifest; `swift test`; test TS na prawdziwym binarium.

### Krok 5 — stan aplikacji na macOS
- [x] `list_apps` (NSWorkspace + katalogi aplikacji) — 5a.
- [x] Rozwiązywanie `app` (`resolve_apps`: identyfikator → nazwa → ścieżka, `ambiguous`) — 5a.
- [x] Uruchamianie w tle przy `get_app_state` (bez aktywacji; aplikacja właśnie zamykana jest uruchamiana ponownie) — 5b.
- [x] Drzewo AX ze stabilnym `key` i indeksem per element (indeks żyje tak długo jak klucz), akcjami, stanami; pola haseł `secure` (wartość nigdy nieczytana); limity (1000 elementów, 4000 węzłów, głębokość 64, timeout AX 1 s). Tekst i diff robi `contract/tree.ts` — 5b.
- [x] Obraz okna przez ScreenCaptureKit (`desktopIndependentWindow`, dopasowanie po pid + ramce + tytule), budżet zgodny z TS, JPEG, ramki elementów w pikselach obrazu, `CoordinateFrame` zapamiętana dla akcji; brak obrazu z przyczyną — 5c.
- [x] Settling na zdarzeniach `AXObserver` (po uruchomieniu/akcji min 1 s, cisza 0,3 s, spinner `AXBusyIndicator`/`AXElementBusy` wydłuża, max 5 s) — 5d.
- [x] Adapter TS `macosProfile` + test end-to-end `ComputerBackend` → helper → fixture — 5d.

### Krok 6 — kursor agenta na macOS
- [x] Nakładka `NSPanel` nad oknem celu: click-through, poza zrzutami, reduced motion, znacznik kliknięcia, obrys elementu (okno spoza bieżącej przestrzeni: bez nakładki, pozycja dalej raportowana).
- [x] Fazy akcji i zdarzenia `cursor` → `TurnControls`; SDK snapshot z `cursor` i `target` (fazy poza `idle` wysyła wykonawca z kroku 7).

### Krok 7 — wykonawca akcji macOS
- [x] Drabina AX → fizyczne wejście, fail-closed, cache `unsupported` (7a: część AX i fail-closed; 7c: fizyczne wejście jako zapas dla kliknięcia i przewijania; 7d2: `DeclineMemory` — 3 odmowy → 5 s pomijania).
- [x] 7a: `act` po indeksie — klik przez `AXPress`/`AXShowMenu`, `set_value`, `perform_secondary_action` z listy elementu, `stale_state`/`no_state`, fazy kursora, świeży stan w odpowiedzi.
- [x] click, type_text, paste, press_key, scroll, drag, set_value, select_text, secondary action, `computer_mouse`, `computer_hold_key` (7a: click po indeksie, set_value, secondary; 7b: type_text, press_key, paste, select_text — w tle; 7c: click/type_text/paste/scroll po punkcie, scroll po indeksie, drag, `computer_mouse`; 7c2: `computer_hold_key`).
- [x] 7b: klawiatura i tekst w tle (AX w miejscu kursora, `postToPid`, ⌘A przez AX, inne ⌘ poza przodem → `not_frontmost`, wklejanie tekstu bez schowka, HTML przez schowek z przywróceniem).
- [x] 7c2: `computer_hold_key` w tle (zwolnienie przy Stop i wyjściu helpera, wcześniejsze przerwanie czekania); skróty ⌘ i wklejanie HTML wyciągają aplikację na wierzch zamiast `not_frontmost` (nigdy podczas pisania użytkownika).
- [x] 7c: fizyczna mysz z bramkami — klik po punkcie (najpierw AXPress kontrolki pod punktem w tle), wielokrotny klik z modyfikatorami, drag ze ścieżką i czasem, `mouse` down/move/up, scroll (AX strona → pasek przewijania → kółko), pisanie/wklejanie w pole pod punktem.
- [x] Bramki: zgoda/poziom, frontmost, hit-test, punkt na ekranie, własne okno, łatka pikseli, ochrona okna zapisu (7c: wszystkie poza ochroną okna zapisu; 7d3: ochrona okna zapisu; zgoda/poziom od kroku 3).
- [x] Przywracanie wskaźnika, strażnik (Escape = Stop, ingerencja = pauza) (7c: przywracanie wskaźnika i zwalnianie przycisku przy wyjściu helpera; 7d1: Escape = Stop przez nasłuchujący tap, pauza/wznowienie z hosta wstrzymuje akcję, czekanie na ciszę przed fizycznym wejściem, przygaszony kursor).
- [x] Wykrywanie braku postępu; wynik + świeży stan po akcji (7d2: `ProgressTracker` w backendzie TS — wspólny dla macOS i Windows).

### Krok 8 — batch, zrzut pełnoekranowy, zoom
- [x] `computer_batch` z bramkami przed każdą akcją i stopem na pierwszym błędzie.
- [x] `computer_screenshot` bez aplikacji bez zgody, `computer_zoom`.

### Krok 9 — status sterowania wypychany zdarzeniami
- [x] Runner `computer.changed` (protokół 23), zdarzenie IPC, `useComputerControl` bez pollingu.
- [x] Komenda `takeover` („Przejmij sterowanie”).
- [x] `ComputerControlStrip`: aplikacja/okno, stan tekstem + ikoną, Stop / Przejmij / Wznów z klawiatury.

### Krok 10 — przełączenie macOS i sprzątanie
- [ ] darwin → nowy backend; bez helpera tylko `computer_status` z powodem.
- [ ] Usunięcie `src/tools/*`, `shell.ts`, `temporary-files.ts`; nowy skill i wskazówki per aplikacja (w tym montaż wideo).
- [ ] Pakowanie helpera w desktopie (`bundle-plugins-seed`, `verify-desktop-resources`).

### Krok 11 — PiP: podgląd JPEG przez Surface
- [ ] Helper `preview.start/stop` (SCStream), zdarzenia `preview_frame`.
- [ ] `PreviewController` (liczniki, latest-frame, stany, sprzątanie) i Surface `computer-preview`.
- [ ] Desktop: `useComputerPreview` + `ComputerPreviewPip` z kursorem.

### Krok 12 — Windows na nowym kontrakcie
- [ ] Helper C++ protokół v5: `list_apps`, `get_app_state {windowId}`, akcje po indeksie/punkcie.
- [ ] Kursor (okno warstwowe, `WDA_EXCLUDEFROMCAPTURE`) i PiP (WGC → JPEG).
- [ ] Usunięcie starych 21 narzędzi; UIPI/UAC → `unsupported`; zielone CI `computer-use-windows.yml`.

### Krok 13 — PiP jako wideo
- [ ] H.264 (VideoToolbox / Media Foundation), zdarzenia `preview_chunk`.
- [ ] WebCodecs w rendererze, negocjacja kodeka, fallback JPEG, porzucanie delt.

### Krok 14 — aplikacja testowa, benchmark, dokumentacja
- [ ] Fixture macOS (w tym płótno bez AX z osią czasu) + skrypt testów.
- [ ] Benchmark z progiem ustalonym przed pomiarem (przeglądarka, biuro, Finder, montaż).
- [ ] `docs/computer-use-macos.md`, aktualizacja docs Windows i strony pakietu.
