# Benchmark Computer Use

## Próg (ustalony w planie przed pomiarem)

- co najmniej 90% zadań zakończonych sukcesem,
- 0 fałszywych sukcesów (agent mówi „zrobione”, a stan aplikacji jest inny).

Sukces ocenia się po prawdziwym stanie aplikacji odczytanym niezależnie
(System Events / `osascript`), nigdy po odpowiedzi agenta.

## Zestaw zadań

| # | Obszar | Zadanie | Aplikacja |
|---|---|---|---|
| 1 | formularz | wpisz „Kamil” w pole Name, naciśnij Press 2 razy, podaj status | fixture |
| 2 | montaż (bez AX) | przesuń klip B w lewo na osi czasu, podaj etykietę | fixture |
| 3 | montaż (bez AX) | przytnij klip A z prawej krawędzi | fixture |
| 4 | kalkulator | policz 17 × 23 przyciskami | Kalkulator |
| 5 | edytor | nowy dokument, wpisz tekst z polskimi znakami, nie zapisuj | TextEdit |
| 6 | Finder | utwórz folder w katalogu tymczasowym i zmień mu nazwę | Finder |
| 7 | przeglądarka | odczytaj tytuł otwartej strony (poziom `read`) | Safari |
| 8 | pakiet biurowy | wpisz trzy wartości i sumę w arkuszu | Numbers |
| 9 | montaż | przytnij klip, przesuń go, wyeksportuj | realna aplikacja montażowa |
| 10 | odporność | modal, przesunięcie układu, kontrolka bez efektu, Stop/Przejmij | fixture |

## Wynik A: 12 narzędzi, `reasoning.effort: xhigh` (2026-10-01, wieczór)

macOS, CLI `moxxy --config <xhigh> --model gpt-6-luna -p`, dostawca
`openai-codex`. Żądanie sprawdzone na łączu przy każdej próbie:
`gpt-6-luna {"effort":"xhigh"}`. Każda próba pojedyncza, w tej kolejności,
nic nie pominięto.

| Próba | Zadanie | Wynik | Stan sprawdzony niezależnie |
|---|---|---|---|
| x1 | 1 | sukces (5 wywołań, 62 s) | „Kamil”, „Pressed 2” |
| x2 | 2, cel „B 110+60” | sukces (5 wywołań, 72 s) | „Timeline A 20+80 B 110+60 selected B” |
| x3 | 3, cel „A 20+50” | sukces (4 wywołania, 61 s) | „Timeline A 20+50 B 140+60 selected A” |
| x10 | 10 | sukces (7 wywołań, 114 s) | „Pressed 1” |
| x4 | 4 | sukces (24 wywołania, 360 s; model dwa razy pomylił cyfrę i sam to poprawił) | „17×23”, „391” |
| x5 | 5 | sukces (10 wywołań, 184 s) | dokument „Zażółć gęślą jaźń 123” |
| x6 | 6 | sukces (14 wywołań, 216 s) | folder `Raporty` na dysku |
| x7 | 7, lokalna strona | sukces (3 wywołania, 58 s) | tytuł „Moxxy Trial Page”, nagłówek „Quarterly Report 2026” |
| x8 | 8 | sukces (12 wywołań, 172 s) | 10, 20, 30, 60, `=SUMA(B2:B4)` |
| x9 | 9, przycięcie klipu w CapCut do ok. 3 s | sukces (8 wywołań, 116 s) | `draft_info.json`: 3 000 000 µs |
| x9e | 9, eksport z CapCut z domyślnymi ustawieniami | sukces (7 wywołań, 110 s) | plik `~/Downloads/1001.mp4`, 3 s |

W tej serii: 11 prób, 11 sukcesów, 0 fałszywych sukcesów, 0 nieudanych
wywołań narzędzi. Zadanie 9 nie obejmowało przesunięcia klipu w CapCut
(przesunięcie jest sprawdzone na fixture, x2).

To nadal nie jest pomiar progu: każde zadanie poszło raz. Próg (≥90%, 0
fałszywych sukcesów) wymaga powtórzeń tej samej próby na niezmienionym kodzie.

## Wynik D: powtórzenia serii A na niezmienionym kodzie (2026-10-01, noc)

Ten sam kod co w serii A, `gpt-6-luna`, `xhigh`. Zaplanowane 5 powtórzeń;
serię przerwano po dwóch na prośbę właściciela (trwała za długo). Stan przed
każdą próbą przywracany, wynik czytany niezależnie od agenta.

| Zadanie | Powt. 1 | Powt. 2 |
|---|---|---|
| x1 formularz | sukces 75 s (pierwszy przebieg odrzucony: nie odczytano stanu) | sukces 59 s |
| x2 przesunięcie klipu | sukces 58 s | sukces 64 s |
| x3 przycięcie klipu | sukces 61 s | sukces 64 s |
| x10 odporność | sukces 87 s | sukces 91 s |
| x4 Kalkulator | sukces 352 s, 26 wywołań | sukces 405 s, 29 wywołań |
| x5 TextEdit | sukces 69 s | sukces 62 s |
| x6 Finder | **porażka** 734 s, 43 wywołania | **porażka** 3568 s, 102 wywołania |
| x7 Safari | **porażka** (tytuł dobry, nagłówek „strona pusta”) | sukces 45 s |
| x8 Numbers | sukces 171 s | sukces 157 s |
| x9 CapCut przycięcie | sukces 84 s | nie uruchomiono (nie udało się przywrócić stanu) |
| x9e CapCut eksport | **porażka** 317 s | nie uruchomiono |

Razem 21 ocenionych prób, 16 sukcesów (76%), 0 fałszywych sukcesów. Próg ≥90%
**nie jest spełniony**. Seria A (11/11) była szczęśliwym pojedynczym przebiegiem.

Przyczyny czterech porażek i poprawki:

1. **Finder (x6).** Pole zmiany nazwy wisi w drzewie pod aplikacją, nie pod
   oknem, więc model go nie widział; tekst wysłany do zaznaczonego wiersza
   przepadał. Pole z fokusem spoza okna jest teraz dołączane do stanu, a pisanie
   do elementu, który nie przyjmuje tekstu, jest odrzucane z podpowiedzią.
2. **Strażnik pętli (x6, x4).** Każde `computer_get_app_state` z tym samym
   wejściem liczyło się jako powtórka, choć między nimi były akcje. Narzędzia
   patrzące na stan zewnętrzny (`liveState`) liczą się tylko, gdy idą jedno po
   drugim.
3. **Safari (x7).** Stan był czytany, zanim strona się wczytała (`AXWebArea`
   bez dzieci). Dla przeglądarek helper czeka na treść (do 8 × 0,4 s), a gdy jej
   nie ma, model dostaje o tym informację.
4. **CapCut eksport (x9e).** Przyciski Qt przyjmują `AXPress` i nic nie robią.
   Drugie wywołanie tej samej akcji idzie prawdziwym kliknięciem; gdy i ono nic
   nie zmienia, wynik to `ineffective`, a trzecie wywołanie nie jest wysyłane.

Po poprawkach każda z tych prób poszła raz (to nie jest pomiar progu):

| Próba | Wynik |
|---|---|
| x6 Finder | sukces 47 s, 8 wywołań |
| x7 Safari | sukces 26 s, 4 wywołania |
| x9e CapCut eksport | sukces 61 s, 8 wywołań |
| x4 Kalkulator | sukces 84 s, 13 wywołań |

## Wynik E: scenariusz właściciela w Safari (2026-10-01, noc)

Zadanie: otworzyć zamknięte Safari, znaleźć kanał Tivolt na YouTube i podać
najnowszy film, w nowej karcie otworzyć OLX, wyszukać „Tesla” i posortować od
najtańszych.

- Próba właściciela w aplikacji desktopowej: porażka. Po wejściu na kanał każde
  narzędzie zwracało „invalid act/get_app_state result”, więc model nie widział
  strony, którą sam otworzył.
- Przyczyna: na głębokiej stronie klucze elementów były obcinane do 512 znaków,
  dwa elementy dostawały ten sam klucz i kontrakt odrzucał cały stan (63 takie
  klucze na stronie kanału). Limity liczono też w znakach, a kontrakt liczy
  jednostki UTF-16 (emoji).
- Po poprawce, `gpt-6-luna` `xhigh`, jedna próba: sukces, 21 wywołań, 187 s,
  0 nieudanych wywołań. Stan sprawdzony niezależnie (AppleScript): karta 1
  `youtube.com/@TivoltGames`, karta 2
  `olx.pl/motoryzacja/q-Tesla/?search[order]=filter_float_price:asc`. Tytułu
  najnowszego filmu nie sprawdzono niezależnie.

- Po skróceniu stanu stron (ten sam dzień): sukces, 16 wywołań, 165 s, te same
  adresy kart. Narzędzia 26 s, oczekiwanie na początek odpowiedzi 27 s, reszta
  to generowanie odpowiedzi przez model.

W tej samej sesji właściciel zgłosił jeszcze dwa błędy, oba odtworzone:

- Aplikacja ChatGPT (Chromium): `type_text` zwracało `delivered`, a pole
  zostawało puste. Pole przyjmuje tekst przez accessibility i go gubi. Helper
  sprawdza teraz, czy pole albo kursor tekstu się zmieniły, i w razie braku
  zmiany pisze klawiszami. Sprawdzone na prawdziwej aplikacji: „test moxxy”
  pojawia się w polu.
- Kursor agenta rysowany 24 pt poniżej celu, gdy okno dotyka paska menu
  (AppKit zsuwał nakładkę pod pasek). Zmierzone: nakładka na Y=39 zamiast 15;
  po poprawce 15.

## Czas: skąd się brał i co zostało

Pomiar na łączu (czas do nagłówków odpowiedzi dostawcy i czas narzędzia):

- Każde żądanie niosło **513 narzędzi (410 KB, ok. 70 tys. tokenów)**:
  ok. 161 wbudowanych i z pluginów oraz serwery MCP użytkownika. Jedno żądanie
  trwało 7–9 s niezależnie od poziomu rozumowania; z 11 narzędziami 1,5 s.
- Samo narzędzie (kliknięcie + odczekanie + nowy stan) to ok. 1,4 s, czyli
  ok. 10% czasu kroku.
- Kalkulator: 352–405 s przed, 106 s po automatycznym leniwym ładowaniu
  narzędzi, 84 s po zmianie wskazówek. Krok to teraz ok. 5 s przy `xhigh`.
- `low` i `medium` dają ok. 3 s na żądanie i ok. 50 s na zadanie, ale model
  klikał wtedy złe cyfry. Tego nie wprowadzono.
- Zostało: model nadal wysyła zwykle jedną akcję na odpowiedź i czasem woła
  `load_skill` dla umiejętności użytkownika niezwiązanych z zadaniem. Próg 200
  nie obejmuje instalacji bez serwerów MCP (ok. 161 narzędzi).

## Wynik B: zadanie 9 (CapCut) przed poprawkami, `medium` (2026-10-01)

CapCut zainstalowany tego dnia; projekt „1001” z jednym klipem 10 s. Wszystkie
próby szły na `reasoning.effort: medium` (domyślne dostawcy; config nie był
wtedy stosowany przy starcie).

| Próba | Polecenie | Wynik | Stan sprawdzony niezależnie |
|---|---|---|---|
| luna9a | otwórz CapCut i opisz ekran | sukces (5 wywołań, 1 nieudane) | ekran startowy |
| luna9b | nowy projekt i import pliku | porażka, zgłoszona uczciwie: okno wyboru pliku nie przyjęło skrótu | oś czasu pusta |
| luna9c | import i klip na osi czasu | sukces (23 wywołania) | klip 10 s w projekcie |
| luna9d | przytnij klip do ok. 5 s | porażka, zgłoszona uczciwie: zrzut okna czarny (okno na innym biurku) | 10 000 000 µs |
| luna9e | to samo | porażka, zgłoszona uczciwie: przeciąganie chwytało środek klipu | 10 000 000 µs |
| luna9f | to samo | porażka, zgłoszona uczciwie: zrzut przeskalowany o ok. 1%, model celował 5–7 px obok krawędzi | 10 000 000 µs |
| luna9g | to samo, po poprawce zrzutu | sukces (15 wywołań, 2 nieudane `computer_zoom`) | 4 933 333 µs |

Poprawki z tych prób: ponowny zrzut po wyciągnięciu okna na ekran, zasada
chwytania krawędzi w `skills/computer-apps/video-editors.md`, zrzut przez
ekran (`CaptureRoute`), ponawianie wyszukania okna (`Attempts`).

## Wynik C: 19 narzędzi, `medium` (2026-10-01, wcześniej)

Próby z modelem prowadzi się wyłącznie na `gpt-6-luna`. Wcześniejsze próby na
innym modelu nie liczą się i zostały stąd usunięte (opis w `CHANGELOG.md`).

Wszystkie próby, w kolejności; nic nie pominięto.

| Próba | Zadanie | Wynik | Stan sprawdzony niezależnie |
|---|---|---|---|
| luna1 | 1 | sukces (4 wywołania, 51 s) | „Kamil”, „Pressed 2” |
| luna2 | 2, polecenie „o około 50 punktów” | częściowy: klip przesunięty o 20 pkt | „B 120+60” |
| luna3 | 3, polecenie „o około 30 punktów” | częściowy: klip skrócony o 10 pkt | „A 20+70” |
| luna2b | 2, cel „B 110+60” | sukces (4 wywołania) | „Timeline A 20+80 B 110+60 selected B” |
| luna3b | 3, cel „A 20+50” | sukces (5 wywołań) | „Timeline A 20+50 B 140+60 selected A” |
| luna4 | 4 | porażka, zgłoszona uczciwie; batch odrzucony przez schemat (błąd 1) | wyświetlacz „11×3” |
| luna4b | 4 | sukces po poprawce (8 wywołań) | „17×23”, „391” |
| luna5 | 5 | sukces (7 wywołań) | dokument „Zażółć gęślą jaźń 123” |
| luna6 | 6 | sukces (11 wywołań) | folder `Raporty` na dysku |
| luna7 | 7 | częściowy: tytuł poprawny, nagłówka strony nie odczytał | okno „Example Domain” |
| luna10 | 10 | porażka, zgłoszona uczciwie; indeks i punkt naraz odrzucane (błąd 2) | „Ready” |
| luna10b | 10 | sukces po poprawce (6 wywołań) | „Pressed 1” |
| luna8 | 8 | porażka, zgłoszona uczciwie (błąd 2) | komórki puste |
| luna8b | 8 | porażka, zgłoszona uczciwie (błąd 3) | komórki puste |
| luna8c | 8 | **fałszywy sukces**: model dodał strzałkę po Return, wartości w złych wierszach, zgłosił „B5 = 30” jako wykonane | B2 10, B3 puste, B4 20, B5 30 |
| luna8d | 8 | porażka, zgłoszona uczciwie (reguła „indeks wygrywa” kliknęła kontener zamiast komórki) | komórki puste |
| luna8e | 8 | **fałszywy sukces**: model zamknął edytor formuły przyciskiem X i podał „60” | B2–B4 poprawne, B5 puste |
| luna10c | 10 | sukces (7 wywołań) | „Pressed 1” |
| luna8f | 8 | sukces (8 wywołań) | 10, 20, 30, 60, `=SUMA(B2:B4)` |
| luna4c | 4 | porażka, zgłoszona uczciwie: model pominął cyfrę w batchu | „17×3”, „51” |
| luna7b | 7, lokalna strona z nagłówkiem | sukces po oczyszczeniu drzewa (3 wywołania) | tytuł „Moxxy Trial Page”, nagłówek „Quarterly Report 2026” |

Na końcowym kodzie każde z zadań 1–8 i 10 ma co najmniej jeden sukces
potwierdzony odczytem stanu. W luna7 strona w Safari nie miała nagłówka
(tekst pojawiał się litera po literze), więc odpowiedź modelu mogła być poprawna.

**Próg nie był spełniony.** Dwie próby (luna8c, luna8e) to fałszywe sukcesy,
a próg wymaga zera. W obu narzędzia zwróciły prawdziwy stan; model go nie
sprawdził. Odsetka sukcesu nie da się uczciwie podać: próby były powtarzane po
poprawkach, a nie losowane.

W luna2 i luna3 polecenie mówiło o „punktach”, a narzędzie liczy piksele zrzutu
(tu 2 piksele na punkt), więc ruch wyszedł o połowę krótszy. Z celem podanym
jako stan (luna2b, luna3b) zadanie wychodzi.

## Błędy znalezione w próbach i naprawione

1. Model wypełnia w kroku batcha także pola innych akcji wartościami niepustymi
   (`repeat: 1`, `direction: "down"`, `path: [[0,0],[0,0]]`). Krok bierze teraz
   tylko pola swojej akcji; nieznane pola nadal są odrzucane.
2. Model podaje naraz `element_index` i punkt. Schemat to odrzucał. Teraz
   prawdziwy punkt jest celem (helper i tak naciska kontrolkę pod punktem przez
   accessibility), a punkt `0,0` obok indeksu jest wypełniaczem.
3. `type_text` z celem „same zera” szło w okno zamiast w element z fokusem.
   Tam, gdzie cel jest opcjonalny, same zera znaczą teraz „element z fokusem”.
4. Podpowiedź przy pisaniu w punkt bez pola tekstowego nie mówiła, co zrobić.
   Teraz mówi: kliknij punkt, potem wyślij tekst bez celu (komórka arkusza,
   płótno).
5. `ArrowDown` i pokrewne nazwy klawiszy nie były znane; są teraz aliasami.
6. Wskazówki dla arkuszy (`skills/computer-apps/office.md`): Return sam
   przechodzi w dół, formułę zatwierdza Return, przycisk X ją odrzuca.
7. Test podglądu bywał niestabilny: `preview.stop` odpowiadał, zanim
   przechwytywanie stanęło, więc jedna klatka mogła przyjść po odpowiedzi.
   `stop` czeka teraz na zatrzymanie.

Wcześniejsze poprawki (wypełniacz `0`/`""`/`null`, aplikacja bez okna,
przetłumaczona nazwa aplikacji) zostają; znalazła je próba na innym modelu.

## Czego nie zmierzono

- Scenariusze Stop/Przejmij, modal, drugi monitor i zabicie helpera: tylko
  testy end-to-end helpera, bez modelu.
- Pełnych 5 powtórzeń po poprawkach z serii D (zrobiono 2 powtórzenia przed
  poprawkami i po jednej próbie po nich).
- Windows: tylko testy na runnerze CI, bez prób z modelem.

## Jak powtórzyć

Aplikacja testowa: `native/macos/build-fixture.sh`, potem
`open -g native/macos/.build/fixture/MoxxyComputerFixture.app`. Zadanie:
`node packages/cli/dist/bin.js --config <plik z context.reasoning.effort: xhigh> --model gpt-6-luna -p "<zadanie>" --allow-tools <narzędzia computer_*> --output-format stream-json < /dev/null`.
Starsza kopia pluginu w `~/.moxxy/plugins` ma pierwszeństwo przed kopią z
repozytorium, więc na czas próby trzeba ją odsunąć.
