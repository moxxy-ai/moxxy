# PRD: Moxxy jak rozmowa z kumplem

Status: po przeglądzie decyzji, do akceptacji · Data: 2026-10-07 · Autor: Kamil

Decyzje, na których stoi ten dokument:
[ADR 0001](../adr/0001-general-personal-agent.md) (osobisty agent, nie tylko dla
programistów),
[ADR 0002](../adr/0002-one-loop-interrupted-by-messages.md) (jedna pętla
przerywana wiadomościami),
[ADR 0003](../adr/0003-agent-stays-in-one-workspace.md) (agent zostaje w jednym
workspace i ma jedną rozmowę). Słownik: [GLOSSARY.md](../../GLOSSARY.md).

## 1. Problem

Moxxy potrafi dużo, ale okazała się za trudna. Ludzie chcą zlecać pracę komuś,
a dostają narzędzie do obsługi.

1. **Trzeba czekać.** Wiadomość wysłana w trakcie pracy stoi w kolejce do końca
   tury. Nie da się powiedzieć „jednak zmień kolor” ani zatrzymać agenta
   sekundę przed publikacją.
2. **Nie widać, co agent ma do zrobienia.** Nie ma listy zadań, która żyje
   razem z rozmową.
3. **Każda rozmowa zaczyna od zera.** Workspace to kilkanaście czatów nazwanych
   pierwszym zdaniem. Żeby wrócić do tematu, szuka się właściwego czatu albo
   zakłada kolejny.
4. **Pamięć jest płytka w czasie.** Po miesiącach szczegóły starych ustaleń
   znikają z wyszukiwania, więc agent może zgadywać zamiast sprawdzić.
5. **Start wymaga wiedzy programisty.** Trzeba wskazać folder projektu, zanim
   napisze się pierwsze zdanie.

## 2. Cel

Człowiek zleca pracę agentowi tak, jak pisze z kimś na komunikatorze. Agent ma
imię i zakres odpowiedzialności, pracuje według widocznej listy, reaguje na
wiadomość w kilka sekund bez porzucania pracy, odzywa się sam, gdy ma sprawę,
i pamięta wspólną historię z datami.

Pod spodem działa to samo co dziś. Kod, pliki, logi, wybór modelu i reszta
funkcji zostają, o krok głębiej zamiast na pierwszym planie.

## 3. Miary sukcesu

Progi obowiązują od początku. Zmieniamy próg tylko wtedy, gdy pomiar bazowy
w etapie 0 pokaże, że jest nieosiągalny (sekcja 12, punkt 1).

| Miara | Próg |
|---|---|
| Oznaczenie wiadomości jako „odebrana” | ≤ 1 s |
| Czas od wysłania wiadomości w trakcie pracy do reakcji agenta | mediana ≤ 5 s |
| Akcje wykonane mimo czekającej wiadomości od człowieka | 0 w testach |
| Trafność odpowiedzi o faktach z historii (zestaw kontrolny) | ≥ 95% |
| Zmyślone odpowiedzi, gdy w historii nie ma zapisu | 0 |
| Odpowiedzi o historii z datą i źródłem | 100% |
| Czas otwarcia strony rozmowy przy 10 tys. i przy 1 mln zdarzeń | bez istotnej różnicy |
| Wyszukiwanie w historii przy 200 tys. zapisów tur | ≤ 0,5 s |
| Stare rozmowy dostępne po przejściu | 100% |
| Obecne zestawy testów przy wyłączonych flagach | 100% zielone, bez zmian w testach |
| Decyzje przed pierwszym promptem | ≤ 2, bez wyboru folderu |

## 4. Słowa, których używamy

| Po polsku | W słowniku | Znaczenie |
|---|---|---|
| Agent | Agent | Ktoś, komu zlecasz pracę: imię, awatar, zakres. Żyje w jednym workspace i ma jedną rozmowę. |
| Workspace | Workspace | Miejsce pracy: pliki, opis, instrukcje, agenci. |
| Dom | Home | Workspace, który każdy dostaje automatycznie, na pracę spoza projektów. |
| Rozmowa | Conversation | Jedna, trwała wymiana między człowiekiem a agentem. Zastępuje słowo „Run”. |
| Zadanie | Task | Punkt na liście agenta. Nie ma własnego procesu. |
| Skrzynka | Inbox | Miejsce, w którym wiadomości czekają, aż agent je przeczyta. |
| Kanał | Channel | Powierzchnia: desktop, terminal, Telegram. |
| Bot | Bot | Konto agenta w kanale. |
| Grupa | Group | Wspólna rozmowa kilku agentów w workspace (następny PRD). |
| Historia | History | Datowany zapis tego, co się działo w workspace. |
| Pamięć | Memory | Fakty i preferencje zapisane celowo, bez dat zdarzeń. |

„Job” to komenda w tle, „subagent” to chwilowy pomocnik agenta. Żadne z nich
nie jest zadaniem.

## 5. Jak to ma działać

Przykład wzorcowy, na którym sprawdzamy każdy etap:

1. „Zrób w Canvie post na Instagrama.” Agent odpowiada, zakłada listę z jednym
   zadaniem i pracuje.
2. W trakcie: „Potem opublikuj go w drugiej karcie.” Agent czyta to po kilku
   sekundach, dopisuje zadanie, odpowiada jednym zdaniem i pracuje dalej.
3. „A jak ci idzie?” Agent odpowiada i nie tworzy z tego zadania.
4. „Jednak inny obrazek i zmień kolor.” Akcje zaplanowane, ale niezaczęte,
   zostają wstrzymane. Poprawka idzie pierwsza, publikacja wraca do oczekujących.
5. Przed publikacją agent pokazuje podgląd i pyta raz.

Zasady:

- **Wiadomość od człowieka przerywa myślenie i czekanie, nigdy trwającą akcję.**
  Agent wraca do miejsca, w którym przerwał. Komendy dłuższe niż chwila
  uruchamia w tle.
- **Trzy rodzaje wiadomości.** Pytanie dostaje odpowiedź. Prośba dopisuje
  zadanie. Zmiana kierunku aktualizuje zadanie. Agent dopytuje tylko wtedy, gdy
  zły domysł zniszczyłby pracę; w pozostałych przypadkach dopisuje zadanie.
- **Wiadomość ma widoczny stan:** „odebrana”, potem „przeczytana”. Gdy trwa
  długa akcja, widać „przeczytam po bieżącym kroku”.
- **Lista jest jedna, płaska i wspólna.** Należy do rozmowy i przechodzi między
  turami. Kolejność wybiera agent. Lista zamyka się, gdy wszystko jest gotowe
  lub anulowane; zamknięta karta zostaje w czacie, a zadania trafiają do
  historii z datą. Zadanie „czeka na ciebie” trzyma listę otwartą.
- **Zdarzenia automatyczne** (rutyna, webhook, zakończony job) trafiają do tej
  samej skrzynki z oznaczeniem źródła. Agent czyta je przed następnym krokiem,
  ale nie wstrzymują akcji. Ich treść to dane z zewnątrz, nie polecenia.
- **Agent odzywa się sam.** Pisze, gdy ma sprawę: przy kamieniach milowych,
  blokadach i pytaniach, nie przy każdym kliknięciu. Praca wywołana zdarzeniem
  („przyszedł mail, przygotowałem draft”) kończy się zadaniem „czeka na ciebie”
  i powiadomieniem.
- **Nieodwracalne po potwierdzeniu.** Podgląd przed publikacją, wysyłką,
  płatnością lub usunięciem to reguła zachowania agenta. Twardą gwarancją
  pozostaje obecne zatwierdzenie, które pokazuje akcję, cel i zakres danych.
- **Agent zna swoje miejsce.** Opis i instrukcje workspace'u ma od razu. Pliki
  i historię innych rozmów tego workspace'u sprawdza, kiedy ich potrzebuje.
  Historia nigdy nie wychodzi poza workspace.
- **Historia zamiast zgadywania.** Pytanie o przeszłość kończy się sprawdzeniem
  zapisu. Odpowiedź podaje datę i źródło. Gdy ustalenia sobie przeczą, wygrywa
  nowsze i agent mówi, że się zmieniło. Gdy zapisu nie ma, agent to mówi.

## 6. Zakres

1. Lista zadań: narzędzie, zdarzenie, karta w czacie.
2. Skrzynka w rozmowie, wspólna dla wszystkich powierzchni.
3. Pierwszeństwo wiadomości: wstrzymanie niezaczętych akcji, przerwanie
   odpowiedzi modelu, budzenie czekania na job.
4. Historia z datami, obejmująca wszystkie rozmowy workspace'u.
5. Długa rozmowa: odczyt bez ładowania całości, wyszukiwanie, skok do daty.
6. Kanały, głos i zdarzenia automatyczne przez tę samą skrzynkę.
7. Agenci: profil, formularz tworzenia, kilku agentów w workspace, kopia,
   usunięcie, Dom, nowy pasek boczny, przejście ze starych czatów.
8. Przerwanie czekania na subagentów.

## 7. Poza zakresem

- **Wiadomości agent–agent i grupy.** To następny PRD i jest zobowiązaniem, nie
  pomysłem: agenci w jednym workspace mają móc do siebie pisać, a potem
  pracować razem w grupie. Skrzynka z tego PRD jest projektowana tak, żeby to
  uniosła; wiadomość od innego agenta nie wstrzymuje akcji. Pisania między
  workspace'ami nie planujemy.
- Przenoszenie agenta między workspace'ami i nowa rozmowa z tym samym agentem.
  Tego nie będzie.
- Tworzenie agenta przez rozmowę. Tego nie będzie; jest formularz.
- Osobny agent-rozmówca obok agenta-pracownika.
- Graf zależności zadań i planista.
- Ręczna edycja listy przyciskami. Wracamy do tego po danych z użycia.
- Procenty postępu. Pokazujemy „2 z 3” i bieżącą czynność.
- Twarde oznaczanie narzędzi jako nieodwracalnych i zmiana znaczenia
  auto-approve.
- Drugi magazyn faktów, encji i relacji obok historii i pamięci.
- Pamięć z zasięgiem workspace'u lub agenta.
- Tryb collaborative. Zostaje nietknięty.

## 8. Co mamy, czego brakuje

| Obszar | Mamy | Brakuje |
|---|---|---|
| Wiadomość w trakcie tury | Kolejka w oknie desktopu, wysyłana po turze ([useChat.ts](../../packages/client-core/src/useChat.ts)). Boty kanałów odpowiadają „still working” ([turn.ts](../../packages/channel-kit/src/turn.ts)). | Skrzynka w rozmowie: trwała, bez duplikatów, ze stanem wiadomości. |
| Dopisanie wiadomości do tury | Checkpoint dopisuje trwały `user_prompt` z polem `origin`, ale tylko na końcu tury ([checkpoint.ts](../../packages/sdk/src/mode/checkpoint.ts)). | To samo na początku każdej iteracji ([react-loop.ts](../../packages/sdk/src/mode/react-loop.ts)). |
| Wstrzymanie akcji | Narzędzia idą po kolei, przed każdym sprawdzamy przerwanie tury ([tool-dispatch.ts](../../packages/sdk/src/tool-dispatch.ts)). Hak `onToolCall` potrafi odmówić narzędzia. | Sprawdzenie „czy czeka wiadomość od człowieka” przed każdym narzędziem. |
| Przerwanie myślenia | Odpowiedź modelu używa sygnału przerwania całej tury; przerwanie kończy turę. | Osobny sygnał na jedno wywołanie modelu i powrót do pętli. |
| Czekanie na job | `Wait` czeka na zdarzenie, domyślnie do 60 s ([wait.ts](../../packages/tools-builtin/src/wait.ts)). Komenda na pierwszym planie: domyślnie 2 min, najwyżej 10. | `Wait` budzony wiadomością. Reguła „długie komendy w tle”. |
| Czekanie na subagentów | `dispatch_agent` czeka na wszystkie dzieci w jednym wywołaniu ([dispatch-agent.ts](../../packages/plugin-subagents/src/dispatch-agent.ts)). | Czekanie, które wiadomość może przerwać. |
| Lista zadań | Plan w trybie plan ([plan-tool.ts](../../packages/mode-plan/src/plan-tool.ts)), tablica w collaborative. | Narzędzie listy w zwykłym trybie, zdarzenie, blok w [chat-model](../../packages/chat-model). |
| Stan pracy | `SessionInfo.runningTurns` mówi, czy tura trwa. | Zadanie „w toku” bez trwającej tury pokazane jako „przerwane”. |
| Zatwierdzenia | Silnik uprawnień, resolver na każdej powierzchni, auto-approve w sesji. | Żadne narzędzie nie deklaruje nieodwracalności; podgląd jest regułą zachowania. |
| Zdarzenia automatyczne | Harmonogram i webhooki. Zaplanowane zadania uruchamiają się w odizolowanej sesji. | Wynik w rozmowie agenta, zwinięty wpis aktywności, treść oznaczona jako dane z zewnątrz. |
| Głos | Wymiana głosowa w trakcie pracy jest dopisywana po turze. | Zlecenie powiedziane głosem trafia do skrzynki; przerwanie mowy nie anuluje pracy. |
| Historia: zapis | Log tylko do dopisywania, z czasem na każdym zdarzeniu. Jeden zapis na turę, stare składane w rozdziały ([compactor-segments](../../packages/compactor-segments/src/index.ts)). | `/new` i reset sesji kasują dziś log; w nowym modelu dopisują znacznik. |
| Historia: wyszukiwanie | `session_recall` szuka po zapisach, `recall({ turnId })` przywraca turę dosłownie. | Szuka tylko po zapisach aktywnych: po złożeniu 6 zapisów zostaje streszczenie do 900 tokenów. Brak dat. Tylko bieżąca sesja. |
| Długa rozmowa | Transkrypt renderuje tylko widoczne okno i dociąga po 50 starszych. | Każda strona czyta z dysku cały plik logu ([persistence.ts](../../packages/core/src/sessions/persistence.ts)). Brak wyszukiwania i skoku do daty. Największy dzisiejszy log: 152 620 zdarzeń, 85 MB. |
| Agenci | Sesje w workspace, każda z własnym modelem. | Profil, agent jako pojęcie, Dom, pasek boczny, przejście ze starych czatów. |
| Pamięć | `memory_save` / `memory_recall`, model użytkownika, konsolidacja. | Zostaje bez zmian. |
| Protokół runnera | Wersja 24, zasady w skillu `change-runner-protocol`. | Nowe metody i podbicie wersji. |

## 9. Brak regresji

- **Flaga na każdy etap, domyślnie wyłączona.** Przy wyłączonej fladze do logu
  nie trafia żadne nowe zdarzenie, a pętla zachowuje się jak dziś. Po przejściu
  testów etapu włączamy ją wszystkim; po jednym wydaniu flaga znika.
- **Tylko dopisujemy.** Nowe typy zdarzeń i metody protokołu są dodatkiem. Log
  pozostaje niezmienny, projekcje pozostają czystymi foldami.
- **Wiadomość ze skrzynki to zwykły `user_prompt` z polem `origin`.** Kompakcja,
  elizja i strategia cache widzą to, co już znają.
- **Subagenci i agenci collaborative nie mają skrzynki** (`ctx.isSubagent`).
- **Tryby włączamy po kolei.** Najpierw `default`; `goal`, `plan` i reszta po
  osobnym teście.
- **Jeden stan, każda powierzchnia.** Skrzynka i lista żyją w sesji, są
  w `SessionInfo` i trafiają do klientów przez `info.changed`. Test obowiązkowy:
  zmiana na jednej powierzchni jest widoczna na drugiej.
- **Żadna praca nie przepada.** Stare sesje zostają na dysku bez migracji
  i zmian. Usunięcie agenta zostawia jego rozmowę jako wcześniejszą rozmowę.
- **Równoległa praca zostaje.** Kilka czatów w jednym workspace to teraz kilku
  agentów.
- **`/clear` zostaje** jako polecenie zaawansowane: opróżnia roboczy kontekst,
  rozmowa i historia zostają. Przestaje kasować log (sekcja 12, punkt 4).
- **Auto-approve i uprawnienia działają jak dziś.** Praca wywołana zdarzeniem
  nie dostaje szerszych uprawnień niż dzisiejsze rutyny.
- **Test powtórki.** Stare logi odtwarzają się identycznie przed i po.
- **Bramka przed każdym PR:** `pnpm build`, typecheck, lint, test, `check:deps`,
  changeset. Zmiany dotykające procesów idą według `windows-parity`.

## 10. Plan wdrożenia

Etapy są w kolejności wykonania. Każdy jest osobno wydawalny.

**Etap 0 — Kontrakt i pomiar bazowy.**
[PRODUCT.md](../../PRODUCT.md): nowa obietnica, odbiorca i lista pojęć według
ADR 0001. Definicje zdarzeń i flag. Zestaw kontrolny historii z dwóch źródeł:
sztuczny log symulujący dwa lata i kopia prawdziwych sesji, czytana lokalnie.
Kategorie: dokładny fakt, zmiana ustalenia, uzasadnienie decyzji, pomylenie
projektów, brak zapisu. Pomiary: dzisiejsza trafność, czas streszczenia tury na
ścieżce odpowiedzi, czas otwarcia strony długiego logu.
*Gotowe, gdy:* wyniki bazowe są zapisane, a każdy próg z sekcji 3 jest uznany
za osiągalny albo zmieniony z zapisanym powodem.

**Etap 1 — Lista zadań.**
Narzędzie, w którym model wysyła całą listę (oczekuje, w toku, gotowe,
anulowane, czeka na ciebie). Zdarzenie w logu, stan w sesji, karta z „N z M”
i bieżącą czynnością. Otwarte zadania przechodzą do następnej tury; po awarii
„w toku” staje się „przerwane”.
*Gotowe, gdy:* przykład wzorcowy pokazuje poprawną listę na desktopie i w TUI.

**Etap 2 — Skrzynka w rozmowie.**
Wiadomość wysłana w trakcie tury trafia do skrzynki sesji: zapis trwały przed
potwierdzeniem, identyfikator przeciw duplikatom, stan „odebrana” i
„przeczytana”. Agent czyta ją przed następnym zapytaniem do modelu. Tura nie
kończy się, póki skrzynka nie jest pusta. Zakończony job trafia do tej samej
skrzynki jako zdarzenie automatyczne.
*Gotowe, gdy:* kroki 2 i 3 przykładu działają, a restart nie gubi ani nie
podwaja wiadomości.

**Etap 3 — Pierwszeństwo wiadomości.**
Sprawdzenie skrzynki przed każdym narzędziem; niezaczęte narzędzia dostają
wynik „wstrzymane, czeka wiadomość”. Wiadomość przerywa trwającą odpowiedź
modelu. `Wait` budzi się wiadomością. Reguły zachowania: długie komendy w tle,
trzy rodzaje wiadomości, podgląd przed akcją nieodwracalną.
*Gotowe, gdy:* cały przykład działa, a test wyścigu („zmień” tuż przed
„opublikuj”) nigdy nie kończy się publikacją.

**Ocena na żywo po etapie 3.** Tryb domyślny, desktop. Decyzja o dalszych
etapach zapada po niej.

**Etap 4 — Historia z datami.**
Indeks wszystkich zapisów tur, także złożonych w rozdziały, z datami
i z zamkniętymi zadaniami. Indeks jest pochodną logu, ma znacznik „zindeksowane
do”, a resztę czyta wprost z logu. Reguła odpowiedzi z sekcji 5. Odczyt strony
rozmowy bez ładowania całego pliku.
*Gotowe, gdy:* zestaw kontrolny osiąga progi na logu symulującym dwa lata,
a czas otwarcia strony nie rośnie z długością rozmowy.

**Etap 5 — Historia workspace'u i wyszukiwanie.**
Indeks obejmuje wszystkie rozmowy workspace'u, także istniejące; nadrabianie
idzie od najnowszych, w bezczynności. Wynik podaje, z której rozmowy pochodzi.
Wyszukiwanie w rozmowie i skok do znalezionego miejsca lub daty.
*Gotowe, gdy:* pytanie o ustalenie z innej rozmowy tego workspace'u dostaje
odpowiedź z datą i nazwą rozmowy, a nic nie wypływa z innego workspace'u.

**Etap 6 — Kanały, głos i zdarzenia.**
Telegram, Discord, mobile, HTTP i głos używają skrzynki zamiast „still
working”. Bot jest przypięty do rozmowy jednego agenta, więc kanał i desktop to
ta sama rozmowa; wiadomość od sparowanej osoby liczy się jako wiadomość od
człowieka. Lista w kanale tekstowym to jedna wiadomość poprawiana w miejscu.
Zlecenie powiedziane głosem trafia do skrzynki jak napisane; pogawędkę obsługuje
model głosowy, a przerwanie mowy nie anuluje pracy.
Wynik rutyny lub webhooka trafia do rozmowy agenta jako zwinięty wpis. Podbicie
wersji protokołu runnera.
*Gotowe, gdy:* test międzypowierzchniowy przechodzi dla każdej pary, a mail
z poleceniem w treści nie steruje agentem.

**Etap 7 — Agenci, Dom i nowy pasek boczny.**
Profil agenta (imię, awatar, zakres, model). Opis i instrukcje workspace'u.
Formularz tworzenia i kilku agentów w workspace. Kopia agenta przenosi profil,
instrukcje, umiejętności i model, bez rozmowy i historii, i nie jest powiązana
z oryginałem. Usunięcie agenta zostawia jego rozmowę jako wcześniejszą. `/clear`
dopisuje znacznik zamiast kasować log. Dom tworzony przy pierwszym uruchomieniu. Pasek
boczny: workspace'y jako sekcje, pod nimi agenci; agenci z Domu na górze.
Przejście: w każdym workspace jeden domyślny agent, najnowszy czat staje się
jego rozmową z powitaniem, reszta to wcześniejsze rozmowy tylko do odczytu.
PRODUCT.md: ścieżka pierwszego uruchomienia i domyślne powierzchnie.
*Gotowe, gdy:* nowa osoba pisze pierwszą wiadomość bez wyboru folderu,
a dotychczasowy użytkownik znajduje każdą starą rozmowę.

**Etap 8 — Przerwanie czekania na subagentów.**
Wiadomość budzi agenta czekającego na subagentów; oni pracują dalej.
*Gotowe, gdy:* wiadomość w trakcie delegacji dostaje reakcję w czasie
z sekcji 3.

## 11. Ryzyka

| Ryzyko | Jak ograniczamy |
|---|---|
| Treść maila lub webhooka steruje agentem. | Zdarzenia są oznaczone jako dane z zewnątrz; uprawnienia nie szersze niż dziś; test w etapie 6. |
| Akcja już wykonana, zanim przyszła wiadomość. | Tego nie cofniemy. Podgląd przed publikacją jest właśnie po to. |
| Seria szybkich wiadomości co chwilę przerywa odpowiedź modelu i marnuje tokeny. | Wszystkie czekające wiadomości czytane razem; pomiar kosztu w etapie 3. |
| Model nie sięga po historię i odpowiada z głowy. | Mierzone w zestawie kontrolnym; w razie potrzeby podpowiedź przez istniejący hak początku iteracji. |
| Streszczenie tury opóźnia reakcję. | Pomiar w etapie 0; jeśli zjada próg, przenosimy je poza ścieżkę odpowiedzi. |
| Wtrącenie w środek kompakcji. | Skrzynka czeka na jej koniec; osobny test. |
| Model zapętli się na aktualizowaniu listy. | Obecny wykrywacz zapętleń obejmuje nowe narzędzie. |
| Log rozmowy rośnie do gigabajtów. | Odczyt bez ładowania całości od etapu 4; test na logu z milionem zdarzeń. |
| Indeks historii rozjedzie się z logiem. | Indeks jest pochodną logu i da się go odbudować od zera. |
| Fakt z pamięci zapisany przy jednym projekcie wypływa w innym. | Stan dzisiejszy, nie pogarszamy go; zasięg pamięci to temat następnego PRD. |
| Rozjazd wersji desktop–runner po aktualizacji. | Podbicie protokołu według `change-runner-protocol`; stary klient dostaje dzisiejsze zachowanie. |
| Użytkownik po przejściu nie rozpoznaje swojej pracy. | Powitanie agenta, wcześniejsze rozmowy w jednym miejscu, etap 7 dopiero po historii. |

## 12. Decyzje techniczne

1. **Progi z sekcji 3 obowiązują od początku.** Zmieniamy próg tylko wtedy, gdy
   pomiar w etapie 0 pokaże, że jest nieosiągalny, i zapisujemy powód tutaj.
2. **Indeks historii to plik SQLite z wyszukiwaniem pełnotekstowym, przez
   wbudowany moduł `node:sqlite`.** Jeden plik na workspace, pochodna logu, do
   odbudowania od zera. Ten sam plik trzyma pozycje zdarzeń w logu, więc stronę
   długiej rozmowy czyta się bez ładowania całości.
   - Nie dochodzi żadna zależność: moduł jest w Node od wersji 22.5, repo
     wymaga 22.19, a desktop ma Node 24.21. Wyszukiwanie pełnotekstowe działa
     w obu (sprawdzone).
   - Pomiar na 200 tys. sztucznych zapisów tur (459 MB tekstu): rzadkie słowo
     i fraza poniżej 1 ms, dwa bardzo częste słowa z rankingiem 0,21 s.
   - Przeszukiwanie w pamięci było szybkie (26 ms), ale wymaga trzymania całej
     historii w RAM: 513 MB na każdy proces agenta. To wyklucza słabsze
     komputery i kilku agentów naraz.
   - Zastrzeżenia: w Node 22 moduł jest oznaczony jako eksperymentalny, więc
     indeks stoi za wąskim interfejsem. Plik indeksu w pomiarze miał 950 MB,
     czyli dwa razy więcej niż tekst; do zmniejszenia w etapie 4. Wyszukiwanie
     nie zna polskiej odmiany, więc agent pyta przedrostkiem i wariantami;
     trafność tego mierzy zestaw kontrolny.
3. **Wstrzymanie akcji jest w pętli, nie w haku pluginu.** To zachowanie
   rdzenia: plugin można wyłączyć, a odmowa z haka wyświetla się jako
   „denied”. Zmiana to jedno sprawdzenie obok istniejącego sprawdzenia
   przerwania tury.
4. **`/clear` dopisuje znacznik zamiast kasować.** Dziś `/new` i reset sesji
   czyszczą log i obcinają plik na dysku. W rozmowie, która się nie kończy,
   znacznik „kontekst wyczyszczony” sprawia, że model zaczyna od pustego
   kontekstu, a wszystko sprzed znacznika zostaje w logu, w czacie i w historii.
   Trwałe usunięcie pozostaje osobną, jawną akcją. Przy wyłączonej fladze
   zachowanie jest dzisiejsze.
