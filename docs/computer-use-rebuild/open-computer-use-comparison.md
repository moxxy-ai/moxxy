# Porównanie z `open-computer-use`

Źródło: <https://github.com/iFurySt/open-codex-computer-use> (MIT), commit
`93b8175` (v0.3.6), przejrzane 2026-10-01. To otwarty odpowiednik `sky` z
Codexa. Kodu nie kopiowaliśmy; poniżej różnice i to, co z nich wzięliśmy.

## Co robi inaczej

| Obszar | `open-computer-use` | Moxxy |
|---|---|---|
| Mysz poza accessibility | zdarzenia wysyłane do procesu (`CGEvent.postToPid`), wskaźnik stoi; prawdziwy wskaźnik tylko po włączeniu zmienną środowiskową | prawdziwe wejście: aplikacja wychodzi na wierzch, wskaźnik rusza się i wraca |
| Klik w tle w oknie zasłoniętym | tryb `sky_click`: prywatne SkyLight i `CGEventSetWindowLocation` | brak; prywatnych API nie używamy (decyzja z planu) |
| Narzędzia | 9, minimalne pola; `type_text` i `press_key` bez celu; `element_index` jako tekst | 16, więcej pól opcjonalnych; model wypełnia je wszystkie, stąd reguły dla wypełniacza |
| Punkt → element | kandydaci z ramek zapamiętanego stanu, potem hit-test | hit-test systemu, od teraz także ramki stanu |
| Budżet drzewa | 1200 węzłów, 64 poziomy, tekst do 500 znaków, wszystko do zmiany w wywołaniu | 1000 węzłów, bez parametrów |
| Tożsamość uprawnień | ukryta aplikacja-agent; terminal tylko przekazuje żądania | w CLI uprawnienia należą do terminala |
| Wynik `drag` | mówi, którą ścieżką poszedł | `delivered` + świeży stan |
| Sekwencje | REPL JavaScript (`js`) nad narzędziami | `computer_batch` |
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

## Czego nie wzięliśmy i dlaczego

- `sky_click`: prywatne API; decyzja użytkownika.
- `postToPid` jako domyślna mysz: nie działa na oknie w tle (wyżej).
- Odchudzenie narzędzi do 9: zmiana kontraktu na obu systemach; do decyzji.
- Aplikacja-agent dla uprawnień: w desktopie uprawnienia ma już Moxxy.app.
