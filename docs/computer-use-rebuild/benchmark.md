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
- Powtórzenia tej samej próby na niezmienionym kodzie (rozrzut wyników).
- Windows: tylko testy na runnerze CI, bez prób z modelem.

## Jak powtórzyć

Aplikacja testowa: `native/macos/build-fixture.sh`, potem
`open -g native/macos/.build/fixture/MoxxyComputerFixture.app`. Zadanie:
`node packages/cli/dist/bin.js --config <plik z context.reasoning.effort: xhigh> --model gpt-6-luna -p "<zadanie>" --allow-tools <narzędzia computer_*> --output-format stream-json < /dev/null`.
Starsza kopia pluginu w `~/.moxxy/plugins` ma pierwszeństwo przed kopią z
repozytorium, więc na czas próby trzeba ją odsunąć.
