# Todo: przebudowa Computer Use

Plan: [`README.md`](README.md). Przebieg prac: [`CHANGELOG.md`](CHANGELOG.md).

## Gdzie jesteśmy

- **Bieżący krok:** kroki 0–14 wykonane; po nich: mysz w tle, 12 narzędzi,
  dokładny zrzut okna, poziom `xhigh`, cztery poprawki z powtórzeń i leniwe
  ładowanie narzędzi (patrz [`CHANGELOG.md`](CHANGELOG.md)).
- **Po krokach, 2026-10-02:** `computer_run` (plan kroków + decyzje Jev) i
  krótsze czekanie helpera macOS po akcji; opis w `../computer-use-macos.md`.
- **Następna czynność:** pozycje z listy „Otwarte” niżej.
- **Blokery:** brak lokalnego Windows (tylko CI). Próby z modelem tylko na
  `gpt-6-luna` z `reasoning.effort: xhigh`.

## Linux

Helper `native/linux` (C++, AT-SPI + X11) na tym samym protokole v5. Budowany
i testowany w kontenerze (`native/linux/docker.sh`), bo na tym komputerze nie
ma Linuksa. Opis: [`../computer-use-linux.md`](../computer-use-linux.md).

- [x] L1: warstwa TS — manifest ELF, profil `linux-x64`/`linux-arm64`, klawisze systemowe, kategorie aplikacji.
- [x] L2: szkielet helpera — protokół, `status`, nadzór rodzica, testy jednostkowe.
- [x] L3: katalog aplikacji, stan aplikacji (drzewo AT-SPI, zrzut okna), aplikacja testowa, e2e.
- [x] L4: akcje (klik, pisanie, klawisze, przewijanie, przeciąganie, wartość, akcja drugorzędna).
- [x] L5: podgląd JPEG, kursor agenta, pauza/Stop/Escape, zoom.
- [x] L6: CI (`computer-use-linux.yml`, x64 i arm64), pakowanie, dokumentacja.

Otwarte dla Linuksa:
- [ ] Próba na prawdziwym pulpicie (GNOME/KDE na Xorg) i z modelem `gpt-6-luna`; dotąd tylko Xvfb + openbox.
- [ ] Przeglądarki i Electron: nie sprawdzono, czy pokazują drzewo strony przez AT-SPI.
- [ ] Wayland (portal RemoteDesktop/ScreenCast + libei) — osobna praca.
- [ ] Czas odczytu dużego drzewa (jedno wywołanie D-Bus na właściwość); kalkulator GNOME (36 elementów): akcja ze świeżym stanem ok. 1,6 s, z czego 1 s to minimalne ustalanie.
- [ ] Brak: `window_id`, ochrona okna zapisu, przewijanie bez prawdziwego wejścia, start aplikacji bez przejęcia fokusu, wideo H.264.

## Otwarte

- [ ] `computer_run`: próba z modelem na zadaniu webowym (Safari) i w
  aplikacji bez elementów; próba w Ustawieniach systemowych przeszła (niżej
  w `CHANGELOG.md`).
- [ ] Pamięć `computer_run`: efekt kroku to do 8 etykiet nowych elementów;
  jeśli te same etykiety są na innym ekranie, krok zostanie uznany za wykonany
  błędnie. Nie zaobserwowano; sprawdzić na aplikacjach z powtarzalnymi ekranami.
- [ ] Pamięć uczy się tylko z kroków z `expect` (sprawdzonych) i z poprawek
  modelu po nieudanym kroku; zwykłe pojedyncze akcje modelu niczego nie uczą,
  bo nie mają opisu celu.
- [ ] Klucz z vaultu jest widoczny dopiero po pierwszym wywołaniu `computer_*`
  w sesji; lista narzędzi zmienia się wtedy raz (jednorazowa utrata cache promptu).
- [ ] `computer_run` nie obsługuje celów bez elementów (płótno, oś czasu) ani
  przeciągania; okno powyżej 1000 elementów nie jest przeszukiwane.
- [ ] Czas czekania po akcji w helperach Windows i Linux nie był mierzony ani
  zmieniany (zmiana dotyczy tylko macOS).
- [ ] Klik w tle na macOS nadal ok. 1,9 s ze świeżym stanem; zostało: zrzut
  przed (0,17 s), lot kursora (do 0,25 s), potwierdzenie zmiany (ok. 0,25 s),
  czekanie (0,3–0,4 s), drzewo (0,27 s), zrzut (0,15 s).

- [ ] Próg benchmarku (≥90%, 0 fałszywych sukcesów): 2 powtórzenia przed
  poprawkami dały 16/21 (76%). Po czterech poprawkach trzeba powtórzyć pełne
  5 serii ([`benchmark.md`](benchmark.md), wynik D).
- [ ] Scenariusz Safari: 165 s, z czego ok. 110 s to generowanie odpowiedzi
  modelu (17 żądań). Stan stron jest już o ok. 60% krótszy.
- [ ] Czas kroku ok. 5 s przy `xhigh`: model wysyła jedną akcję na odpowiedź;
  instalacje poniżej 200 narzędzi nadal wysyłają wszystkie schematy.
- [x] CapCut z modelem `gpt-6-luna`: import, przycięcie do 15 s i eksport —
  udane (37 wywołań `computer_*`, 367 s; próba właściciela 2026-10-02).
- [x] Blender z modelem `gpt-6-luna`: kostka usunięta, torus dodany przez F3
  i wygładzony („Shade Smooth”) — udane (20 wywołań `computer_*`, 138 s; próba
  właściciela 2026-10-02 po wskazówce i poprawce skrótów).
- [ ] CapCut, pole nazwy w oknie eksportu: model potrzebował ok. 15 wywołań
  (`type_text`, `set_value`, `super+a`, `ctrl+a`), żeby wpisać nazwę pliku.
  Plik powstał pod właściwą nazwą; przyczyna nie zbadana.
- [ ] CapCut: model odczytał długość eksportu jako 16 s, plik ma 15,28 s —
  przycięcie przez przeciąganie nie trafia dokładnie w 15,00 s.
- [x] CapCut, próba z 03:26 (9 wywołań, 59 s): eksport „1002 (2).mp4” udany;
  pliku nie ma w Pobranych, bo właściciel go usunął (potwierdzone przez niego).
- [ ] Celowanie modelu w małe etykiety okien rysowanych samodzielnie: brak
  ogólnego mechanizmu (wskazówka istnieje tylko dla Blendera).
- [ ] Okno wyboru pliku: wyniki szukania po zmianie zakresu („Pobrane rzeczy”)
  pojawiają się po ustaleniu stanu, więc model widzi pustą listę. Notatka
  odsyła model do „Idź do”; samo czekanie na wyniki nie jest zrobione.
- [ ] Okno wyboru pliku: plik zaznaczony w zwiniętej sekcji listy nie jest
  widoczny w drzewie (widać tylko aktywny przycisk „Import”).
- [ ] Jedno kliknięcie przycisku „anuluj” w polu szukania zwróciło
  `helper_failed` („The window could not be captured”); nieodtworzone.
- [ ] Okno wyboru pliku z fokusem w polu szukania: pierwsze kliknięcie pliku
  bywa zgłaszane jako dostarczone w tle bez efektu (przypuszczalnie migający
  kursor tekstowy liczony jako zmiana obrazu; niesprawdzone). Powtórzenie
  kliknięcia idzie prawdziwą myszą i zaznacza plik.
- [ ] W tle nie działają: skróty z Command, prawy i środkowy przycisk, okno na
  innym biurku (Space) bez przenoszenia.
- [ ] Scenariusz Safari (YouTube → OLX) powtórzyć w aplikacji desktopowej; po
  poprawce poszedł raz w CLI ([`benchmark.md`](benchmark.md), wynik E).
- [ ] Safari w tle potrafiło nie udostępnić treści strony. Helper budzi teraz
  accessibility aplikacji i w ostateczności wynosi okno na wierzch; samego
  przypadku nie odtworzono.
- [ ] Windows: sprawdzić unikalność i długość kluczy elementów na głębokiej stronie.
- [ ] Zadanie w Arc (nowa karta → Dysk Google → konto → folder → pobranie
  pliku) powtórzyć po poprawce wyciągania okna pełnoekranowego; sprawdzono
  tylko odczyt stanu, zrzut i `super+t`.
- [ ] PiP 30 kl./s: zmierzono helper; koszt dekodowania w oknie desktopu
  i wersja Windows niezmierzone.
- [ ] Windows: próby z modelem, mysz w tle.
- [ ] Aplikacja mobilna nie ma paska stanu Computer Use (kanał już podaje `computer.snapshot` i `computer.changed`).
- [ ] Starsza kopia pluginu w `~/.moxxy/plugins` zasłania kopię z repozytorium.

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
- [x] darwin → nowy backend; bez helpera tylko `computer_status` z powodem.
- [x] Usunięcie `src/tools/*`, `shell.ts`, `temporary-files.ts`; nowy skill i wskazówki per aplikacja (w tym montaż wideo).
- [x] Pakowanie helpera w desktopie (`verify-desktop-resources`, `x64ArchFiles`, kroki CI; digest manifestu niezależny od podpisu).

### Krok 11 — PiP: podgląd JPEG przez Surface
- [x] Helper `preview.start/stop` (SCStream), zdarzenia `preview_frame`.
- [x] `PreviewController` (liczniki, latest-frame, stany, sprzątanie) i Surface `computer-preview`.
- [x] Desktop: `useComputerPreview` + `ComputerPreviewPip` z kursorem.

### Krok 12 — Windows na nowym kontrakcie
- [x] Helper C++ protokół v5: `list_apps`, `resolve_apps`, `get_app_state {app, window_id?}`, akcje po indeksie/punkcie, `batch`, `screenshot`, `zoom`.
- [x] Kursor (okno warstwowe, `WDA_EXCLUDEFROMCAPTURE`) i PiP (WGC → JPEG).
- [x] Usunięcie starych 21 narzędzi i `windows/{backend,contracts,guidance}.ts`; jeden `ComputerBackend` na obu platformach.
- [x] Zielone CI `computer-use-windows.yml` (run 36811088154; poprawki po pierwszej kompilacji w commitach `fix(computer-use): …`).

### Krok 13 — PiP jako wideo
- [x] H.264 na macOS (`VTCompressionSession`), zdarzenia `preview_chunk`, `preview.keyframe`.
- [x] WebCodecs w rendererze, negocjacja kodeka, fallback JPEG, porzucanie delt do klatki kluczowej.
- [x] Pomiar JPEG vs H.264 (`native/macos/measure-preview.mjs`).
- [x] Windows: enkoder Media Foundation (`native/src/video.cpp`), z zapasem JPEG, gdy system go nie ma; sprawdzany tylko w CI.

### Krok 14 — aplikacja testowa, benchmark, dokumentacja
- [x] Fixture macOS: oś czasu bez AX, przesunięcie układu, kontrolka bez efektu, aplikacja bez okna + `native/macos/Tests/run-computer-use-tests.sh`.
- [x] Zestaw benchmarku i próg w [`benchmark.md`](benchmark.md); próby w prawdziwym moxxy: formularz, oś czasu, Kalkulator (sukces), TextEdit (na poziomie narzędzi).
- [ ] Próg ≥90% niepotwierdzony pomiarem: wszystkie zadania 1–10 mają sukces na końcowym kodzie (seria A w `benchmark.md`, 11/11), ale każde poszło raz.
- [x] `docs/computer-use-macos.md`, strona pakietu; `docs/computer-use-windows.md` zaktualizowany w kroku 12.
