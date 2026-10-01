# Porównanie z `open-computer-use`

Źródło: <https://github.com/iFurySt/open-codex-computer-use> (MIT), commit
`93b8175` (v0.3.6), przejrzane 2026-10-01. To otwarty odpowiednik `sky` z
Codexa. Kodu nie kopiowaliśmy; poniżej różnice i to, co z nich wzięliśmy.

## Co robi inaczej

| Obszar | `open-computer-use` | Moxxy |
|---|---|---|
| Mysz poza accessibility | zdarzenia wysyłane do procesu (`CGEvent.postToPid`), wskaźnik stoi; prawdziwy wskaźnik tylko po włączeniu zmienną środowiskową | najpierw zdarzenia do okna w tle (od 2026-10-01), potem prawdziwe wejście: aplikacja wychodzi na wierzch, wskaźnik rusza się i wraca |
| Klik w tle w oknie zasłoniętym | tryb `sky_click`: prywatne SkyLight i `CGEventSetWindowLocation` | to samo, także dla przeciągania i kółka, z kontrolą skutku i zapasem |
| Narzędzia | 9, minimalne pola; `type_text` i `press_key` bez celu; `element_index` jako tekst | 12 (ich 9 plus `computer_status`, `computer_request_access`, `computer_zoom`), minimalne pola |
| Punkt → element | kandydaci z ramek zapamiętanego stanu, potem hit-test | hit-test systemu, od teraz także ramki stanu |
| Budżet drzewa | 1200 węzłów, 64 poziomy, tekst do 500 znaków, wszystko do zmiany w wywołaniu | 1000 węzłów, bez parametrów |
| Tożsamość uprawnień | ukryta aplikacja-agent; terminal tylko przekazuje żądania | w CLI uprawnienia należą do terminala |
| Wynik `drag` | mówi, którą ścieżką poszedł | `delivered`, metoda (`ax`, `background`, `input`) i świeży stan |
| Sekwencje | REPL JavaScript (`js`) nad narzędziami | brak dla modelu (batch został tylko w helperze) |
| Windows / Linux | PowerShell + UI Automation; Python + AT-SPI | natywny helper C++; Linuksa brak |
| Zgody i bramki | brak zgód per aplikacja, brak łatki pikseli, brak pauzy na wejście użytkownika | poziomy zgody, łatka pikseli, ochrona okna zapisu, Stop / Przejmij, podgląd PiP |

## Sprawdzone u nas

`postToPid` bez prywatnych wywołań nie dociera do widoku AppKit w oknie w tle
(macOS 26, aplikacja testowa za Kalkulatorem): klik, przeciągnięcie i przewijanie
nie zmieniły stanu, także z polami okna 91 i 92 ustawionymi na zdarzeniu. To
zgadza się z ich własną notatką: bez `CGEventSetWindowLocation` zdarzenie nie
dochodzi. Klik w tle na płótnie wymaga więc prywatnego API.

## Co wzięliśmy

- Element pod punktem szukany też w ramkach zapamiętanego stanu. Hit-test
  systemu nie widzi okna na innym biurku (Space); teraz klik w punkt na
  kontrolce i pisanie w punkt działają tam przez accessibility.
- Nazwy akcji własnych (`Name:…\nTarget:…`) pokazywane jako sama nazwa.
- Mysz w tle (decyzja właściciela z 2026-10-01, „opcja 1”). Z ich
  `sky_click` wzięliśmy sposób: `SLEventPostToPid`, pola zdarzenia z numerem
  okna, `CGEventSetWindowLocation`, naciśnięcie wstępne w punkcie (-1,-1) i
  rekord fokusu dla okna. Kod jest napisany od nowa w
  `BackgroundInput.swift` i `MouseInput.swift`. Dodaliśmy to, czego u nich nie
  ma: przeciąganie i kółko tą samą drogą, sprawdzenie skutku (piksele okna do
  0,6 s albo zmiana drzewa) i przejście na prawdziwe wejście, gdy skutku nie
  ma, gdy model prosi o ten sam gest drugi raz, przy prawym i środkowym
  przycisku oraz gdy okna nie ma na bieżącym ekranie.
- Odchudzony zestaw narzędzi (decyzja właściciela, „opcja 2”): 12 zamiast 19.

## Czego nie wzięliśmy i dlaczego

- `postToPid` bez prywatnych wywołań: nie działa na oknie w tle (wyżej).
- Aplikacja-agent dla uprawnień: w desktopie uprawnienia ma już Moxxy.app.
- REPL JavaScript: każde wywołanie ma u nas przejść przez zgody.
