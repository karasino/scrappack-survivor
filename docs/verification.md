# Проверки и ручная приёмка

## Окружение и команды

Установка описана в [README](../README.md). `npm run check` последовательно выполняет doctor, check:docs, test:core, test:harness, build, test:scenarios, test:combat-ui, test:exploration, test:crafting. Отдельный test:visual не повторяется: входит в боевой набор. Не запускать игровые наборы параллельно: общий порт 4175.

В процессе работы выбирать затронутые наборы. Полный check нужен перед ручной приёмкой изменения игрового кода и при изменении самого harness. После записи подтверждения пользователя достаточно check:docs, если код не менялся.

| Изменение | Целевые проверки |
| --- | --- |
| Энергия, батареи, трансформаторы, атака/броня | Сначала test:core, затем test:combat-ui |
| Вращение, drag, tooltip, рамки/молния, текстуры | test:combat-ui; test:visual для быстрой итерации |
| Обновление открытого tooltip, ожидание кадров | test:slow-ui для быстрой проверки; затем test:combat-ui |
| Движение, AI, RNG, контакты, переходы | Сначала test:core, затем test:exploration |
| Сырьё, компоненты, рецепты, лечение, награды | Сначала test:core, затем test:crafting |
| Владение предметами, режимы RunState, общие блокировки | test:core и затронутые UI-наборы, при сомнении полный check |
| Только документы/приёмка | check:docs |
| Диагностика/runner/валидатор | test:harness; для launcher также test:scenarios; затем полный check |
| CI workflow/окружение | actionlint, чистые npm ci/check, GitHub success и контролируемый failure с JSON/PNG |

## GitHub Actions

[CI](../.github/workflows/ci.yml) содержит два независимых задания на `ubuntu-24.04`, Node берётся из `.nvmrc`. В каждом свой checkout и `npm ci`; npm cache хранит загрузки по lockfile. `Core, harness and build` исполняет check:docs → test:core → test:harness → build без установки Chrome и вызова doctor. `Browser UI (WebGL and Canvas)` устанавливает библиотеки Ubuntu и Chrome for Testing **157.0.8103.78** linux64, экспортирует `CHROME_BIN`, затем исполняет doctor → test:scenarios → test:combat-ui → test:exploration → test:crafting. Это последовательные команды на одном runner; полные маршруты seed 123 остаются только в core, отдельного test:visual/check в CI нет.

Триггеры: pull_request, push в main, workflow_dispatch. Устаревшие запуски отменяются в пределах события и ветки/номера PR; разные PR не смешиваются. Права — только contents: read; checkout не сохраняет credentials. Actions закреплены SHA официальных релизов [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), [upload-artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2). Реальные Node/npm/Chrome версии видны в логах. Код возврата каждой команды сохраняется; после ошибки последующие обычные шаги пропускаются. Пределы jobs: 15 минут для правил, 25 для браузера; установка и каждый browser-набор ограничены пятью минутами, upload — тремя. Внутренний предел browser runner — 240 секунд с ограниченной диагностикой/очисткой, что оставляет время до остановки шага.

`Upload browser diagnostics` выполняется после успеха или ошибки, пока job не отменён. Он загружает `artifacts/` под уникальным именем `diagnostics-browser-<run_id>-<attempt>` на семь дней. При раннем сбое отсутствие файлов даёт warning и сохраняет первоначальный failure; установка/doctor диагностируются по логам шагов. После принудительной остановки всего job загрузка не гарантируется. Скриншот возможен, когда Chrome и страница доступны.

Для обновления Chrome выбрать доступный Stable linux64 в [официальной таблице CfT](https://googlechromelabs.github.io/chrome-for-testing/) или её [JSON](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json), заменить только `CHROME_VERSION` в workflow и актуализировать эту запись. URL содержит полную версию, не latest; установка проверяет вывод браузера. Проверить `deb.deps` из архива и имена библиотек целевой Ubuntu. При обновлении Actions сверить tag → полный commit SHA и входы action.yml с официальным репозиторием. До публикации выполнить `actionlint .github/workflows/ci.yml` (локально проверено 1.7.12), чистые npm ci/check, затем на GitHub подтвердить оба задания и диагностику контролируемой ошибки. Зависимости проекта ради валидатора не меняются.

Контролируемый отказ: только во временной копии/проверочной ветке испортить ожидание существующего browser-check после загрузки страницы, запустить соответствующий набор и проверить exit 1, имя проверки, свежие `failure.json` и `failure.png`. Затем вернуть исходное ожидание и подтвердить исправление. Ошибка запуска Chrome проверяет раннюю диагностику, но не подтверждает screenshot. На GitHub повторить это отдельным PR/проверочной веткой, скачать артефакт и вернуть зелёный запуск; не добавлять постоянный режим намеренной ошибки. Локальные результаты и GitHub-hosted прогоны записаны отдельно [в принятой задаче CI](tasks/done/2026-11-17-ci-checks.md).

## Что уже проверяется

Runner [combat-ui.mjs](../tests/combat-ui.mjs) запускает настоящий Vite и Chrome через CDP. Во всех игровых наборах исполняются Canvas и WebGL. `test:core` отдельно запускает реальные `.ts`-модули core через tsx в Node 24 со стандартными `node:test`/`node:assert/strict`: семь явно перечисленных `.test.mjs` файлов, таймаут 15 с на тест. Набор не вызывает doctor, не загружает Phaser/UI, не запускает Chrome/Vite и не открывает портов. Некорректный CHROME_BIN и занятый 4175 не препятствуют проверке правил. tsx не проверяет типы; `build` по-прежнему выполняет `tsc && vite build`. Production test hooks не вводятся; временные фикстуры размещаются тестом.

Полный маршрут [full-run.mjs](../tests/core/scenarios/full-run.mjs) использует RunState/ExplorationEngine с seed 123 и допустимые команды без телепортаций/добавления ресурсов. Это core-сценарий, не полный проход мышью. Его вызывает только [run.test.mjs](../tests/core/run.test.mjs): один проход на прежней авторской фикстуре и один на обычных generated-картах за test:core и полный check. Это разные карты; UI отдельно проверяется настоящим вводом.

Текущий результат авторского маршрута: два сектора, семь боёв, 50 перемещений, два использования Medkit (мастерская и бой), 24 HP, рюкзак 5 × 4, повторно изготовленный Arc Baton в заключительной мастерской. Generated seed 123 даёт тот же итог, но 66 перемещений. Числа — ориентир текущего прототипа, не замена проверок поведения. Баланс и удобство оценивает пользователь.

### Карта перенесённых сценариев

Это семантическая карта прежних чистых блоков. Assertions сохранены по поведению; количество тестов не служит мерой покрытия. Browser setup и UI-assertions остаются на месте. В `combat-ui.mjs` исходы, базовые эффекты, частичная ошибка и отмена выбора связаны с реальными кликами/сценой, поэтому сохранены целиком. Чистые проверки tooltip content/форматирования из `task4-checks.mjs` также остаются в браузере как часть представления.

| Прежний блок | Новые тесты (точные имена или указанный префикс) |
| --- | --- |
| exploration: исходное оборудование, размещение, выбранность, питание, заряд | [inventory.test.mjs](../tests/core/inventory.test.mjs): `starting loadout preserves positions, selection, physical power and charges` |
| crafting: закрытые клетки, четыре поворота Power Core/Precision Mechanism/Medkit | inventory: `closed starting cells and four rotations of components and medkit` |
| crafting: пять синтетических наград, четыре расширения, повторы до/после подтверждения, блокировки, сохранение экземпляров, недопустимые размеры, новый забег | inventory: `boss expansion stages preserve instances, reject invalid sizes and reward replay` |
| energy-plan: неравные прямые/взвешенные источники; равные доли; общий платёж/конфликт; только броня/только оружие; резерв A для брони; разные множители | [energy-combat.test.mjs](../tests/core/energy-combat.test.mjs), префикс `energy plan:`: `unequal direct sources`, `sum of charge is not weighted supply`, `unequal weighted sources`, `equal shares preserved when affordable`, `joint payment`, `both individually feasible but jointly unavailable`, `armor remains available when weapon cannot work alone`, `weapon remains available when armor cannot work alone`, `A reserved for armor and B for weapon`, `joint optimization with different multipliers` |
| energy-plan: порядок источников/инвентаря; положительные остатки ULP | `energy plan is independent of inventory and source order`; `energy plan retains positive ULP remainders` |
| energy-plan: 0.1 + 0.2, реальная нехватка, нулевая стоимость со связью/без связи | Префикс `energy plan:`: `floating point addition cannot overspend`, `real shortage is not machine error`, `connected zero-cost actions are free`, `zero cost still requires a connection` |
| energy-plan: настоящий BFS через трансформатор при заряде 1/3/4/5; устаревший preview | `real transformer chain at charge 1/3/4/5` (четыре отдельных теста); `processTurn replans after a preview becomes stale` |
| power-reason: доступно, no-source, insufficient-charge, shared-charge-conflict, доступность только одного эффекта, два неравных источника; чистота и соответствие boolean API | Семь тестов `power reasons: <JSON options>`: A=5; A=5 без связей; A=0.5; A=2; A=1; A=2/armorCost=3; A=0.5/B=1.5 без выбранной брони |
| task4: общий источник и полное разряжение; нехватка; невыбранная/обесточенная броня; нулевые/отрицательные цены; пустые связи; полная блокировка | Префикс `combat payment:`: `shared source sums weapon and armor`, `shared source removed after full effects`, `insufficient charge keeps source and uses base effects`, `unselected powered armor is free`, `unpowered armor is free`, `zero-cost used items`, `negative costs clamp to zero`, `empty links cannot power effects`, `fully blocking armor still costs energy` |
| task4: дроби, путевые множители вместо глобального 99, совместные/раздельные источники, несколько удалений и один BFS, отрицательные множители, малый положительный заряд | Префикс `combat payment:`: `fractional armor distribution retained`, `per-path multipliers`, `shared source plus separate armor sources`, `multiple deletions recalculate once`, `negative path multiplier clamps to zero`; `combat payment retains tiny positive battery charge` |

Начальные блоки exploration и crafting распределены по именованным тестам ниже; все внутренние проверки отказов, сохранения состояния, циклы и варианты исходных фикстур сохранены.

| Сценарии прежнего exploration core | Тест в [exploration.test.mjs](../tests/core/exploration.test.mjs) |
| --- | --- |
| Два сектора, размеры, достижимость | `both generated sectors have expected dimensions and reachable exits and loot` |
| Границы/диагональ/стена/неприменимое действие, drag и допустимый шаг | `invalid actions and drag preserve world state; cardinal movement spends one turn` |
| Периоды и RNG блуждания | `idle periods schedule seeded wandering`; `blocked idle attempt consumes RNG without movement` |
| BFS, завершение погони, равные пути, чистота обнаружения со стенами | `chase routes around walls without RNG and ends outside radius`; `equal chase paths prefer up before right`; `detection measures paths around walls and remains pure` |
| Оборонительный контакт, прерывание фазы и стабильный ID | `defensive contact starts one encounter and freezes the remaining phase`; `stable enemy ID chooses simultaneous contact` |
| Атакующая победа, награда один раз, замороженные RNG/мир | `offensive victory advances and rewards once without resuming world phase` |
| Многоходовая победа, добыча обеих клеток, обнаружение и следующая AI-фаза | `multi-turn offensive victory preserves both cells loot and refreshes detection` |
| Нападение после свободного шага | `defensive victory after movement keeps hero on source cell` |
| Поражение/одновременная смерть, HP новой встречи, отсутствие наград | `offensive defeat and simultaneous death never advance or reward`; `encounter retains HP; simultaneous death has defeat priority` |
| Победа на выходе, обыск перед контактом и отказ повторного обыска | `victory on exit waits for explicit leave action`; `search reveals loot before contact and cannot duplicate contents` |
| Seed 987, 18 ходов, отсутствие наложений | `same seed reproduces wandering without overlapping monsters` |
| Владение, HP/заряд/выбор/экземпляры, мастерские, финальная блокировка | `workshop transitions preserve resources, instances and selection; completion freezes actions` |

| Сценарии прежнего crafting core | Тест в [crafting.test.mjs](../tests/core/crafting.test.mjs) |
| --- | --- |
| Старт, аптечка, лимит, каталог основ и сырьевая добыча | `starting medkit, empty materials, recipe catalog and raw loot definitions` |
| Частичный подбор/остаток, лимит, выбрасывание, запрет боевых переносов | `partial material pickup retains remainder; limits and rejected combat transfers are atomic` |
| Цены/выходы всех основ, точное списание, отказ/атомарность, стабильный ID компонентов | `all recipes debit exact costs and inventory components in stable ID order` |
| Полный рюкзак, стол, неизвестный рецепт, оставленные предметы и переход | `full backpack crafts onto bench and continuation discards leftover output` |
| Полное HP, владение аптечкой, ограничение лечения, исследование/мастерская | `medkits enforce HP and ownership limits in exploration and workshop` |
| Лечение вместо атаки, только энергия брони, отсутствие оружия, ответ врага | `combat healing replaces attack, charges only armor and needs no weapon` |
| Одноразовая медицинская точка, предел HP, ход/бесплатный отказ | `aid station caps healing, costs one turn and cannot be reused` |
| Параметры босса, закрытый выход, одновременная смерть | `live boss blocks exit; simultaneous defeat gives no reward or expansion` |
| Отдельный лечебный энергоплан, отказ частичной оплаты брони | `healing plans armor alone and preserves charge when armor is unaffordable` |
| Лечение до фазы контакта | `healing and aid station apply before monster contact` |
| Исключение создания результата и компонент на столе | `craft output construction failure is atomic; bench components are unavailable` |
| Оба инициатора победы над боссом, позиция/компоненты/расширение | `both boss encounter initiators preserve reward position and apply expansion once` |
| Общий маршрут crafting-run-scenario, ранее два набора × два renderer | [run.test.mjs](../tests/core/run.test.mjs): `authored fixture seed 123 completes two sectors with earned resources and deterministic final state` и `generated seed 123 completes both sectors with earned resources and deterministic final state`; все внутренние проверки [маршрута](../tests/core/scenarios/full-run.mjs) и итог сохранены |

`check:docs` проверяет локальные цели Markdown-ссылок, размер AGENTS/status, поля/разделы/статусы и размещение задач, соответствие active-task. Фрагменты заголовков и смысловая актуальность текста автоматически не подтверждаются. Архив исторической спецификации исключён из проверки старых ссылок, но ссылка на сам архив должна работать.

## Диагностика и артефакты

`npm run test:slow-ui` запускает [slow-tooltip-checks](../tests/slow-tooltip-checks.mjs) отдельно в Canvas/WebGL. Эта же группа включена в test:combat-ui, значит выполняется в полном check и существующем CI без дополнительного дублирующего шага. Только на время сценария CDP Emulation.setCPUThrottlingRate устанавливает rate:6; finally возвращает rate:1 при успехе и отказе. Это замедление CPU, а не гарантия заданной частоты кадров.

Проверка сначала открывает настоящий tooltip Laser Pistol и дожидается завершения hover timer. Затем без движения курсора подключает Heavy Battery, снижает заряд до 0.005 и возвращает 12: активная строка должна пройти Base → Powered → Base с Insufficient charge → Powered, число источников — 0 → 1. Отдельный hover батареи проверяет Charge и процент для 12 → 0.005 → 0 → 12. Проверка читает видимые Phaser labels, не вызывает show/layout/refresh; фиксированная пауза не служит критерием успеха. Ожидание ограничено пятью секундами, timeout сообщает renderer, этап, ожидаемый и последний видимый текст, цель, курсор и номер кадра. Сбой сохраняет обычные JSON/PNG runner.

Контроль чувствительности выполнять во временной версии теста: после подтверждённого начального hover отключить updateTooltipHover на экземпляре сцены, запустить test:slow-ui и проверить exit 1 на подключении источника со старым Base damage в диагностике. Перед положительным прогоном восстановить тест. Постоянного режима намеренного отказа и production hooks нет.

Если sandbox ограничивает отчётность дочерних процессов, node:test может показывать только успешные результаты файлов. Дополнительный reporter делает такой результат test:core или test:harness отказом с `[core-report] FAIL` и именами файлов без внутренних итогов. Повторить команду нужно в разрешённой среде с полноценным отчётом; автоматического обхода sandbox нет. Это ограничение среды отдельно от зависимости набора от браузера или порта. [Контроль отчёта](#контроль-отчёта-core-и-harness).

Doctor проверяет Node 24.x, соответствие прямых установленных зависимостей lockfile, Chrome (`CHROME_BIN` либо google-chrome), возможность слушать 127.0.0.1:4175. Для EPERM/EACCES проверить ограничения sandbox; для EADDRINUSE освободить порт обычным завершением его владельца. Doctor сам ничего не устанавливает и не завершает.

Runner ограничивает startup, каждую CDP-команду, общую длительность и cleanup. Сбой сообщает renderer и текущую проверку/группу. JSON и доступный screenshot сохраняются в уникальный каталог `artifacts/harness/`; ошибка screenshot также записывается, исходный сбой не теряется. Временный профиль и только собственные процессы очищаются.

При ожидании готовности Vite ANSI-коды удаляются только из строки для сопоставления адреса: цветной вывод CI может вставлять их между хостом и портом. Исходный stdout остаётся в диагностике. Это покрыто отдельным harness-тестом с реальным дочерним процессом.

Обычные снимки: `artifacts/crafting/`, `artifacts/exploration/`, `artifacts/ui-feedback/`. Снимки визуального прототипа: `SCRAPPACK_VISUAL_CAPTURE=after npm run test:combat-ui`, каталог `artifacts/visual-prototype/after/`. Эти каталоги не коммитятся.

## Воспроизводимые ситуации

`npm run scenario -- <id> [--renderer webgl|canvas]` запускает один сценарий в видимом Chrome; renderer по умолчанию `webgl`. Для остановки — Enter в терминале, Ctrl+C либо закрытие игровой вкладки/окна. Новый запуск той же команды восстанавливает фикстуру; refresh страницы начинает обычный забег. Ошибки старта ограничены общим пределом 60 секунд и отдельными CDP/startup-пределами; после `READY` лимита времени для ручных действий нет. Launcher владеет только собственными process groups и временным профилем. При занятом порте 4175 он не завершает его владельца.

Подготовка находится в [browser-fixtures](../tests/browser-fixtures.mjs), общий launcher — [scenario](../scripts/scenario.mjs); production их не импортирует. Она повторно использует `seed`/`freshRun`/`reset` из UI-проверок, создаёт модели каталога и вызывает команды core. Это явные тестовые фикстуры, не replay прохождения. Оба сценария имеют seed **170117**, world turn **0**, начальную ориентацию всех предметов **0**, пустые материалы и землю. В бою мир и RNG заморожены. Координаты ниже — `(столбец, строка)` от нуля.

| ID | Исходное состояние | Проверка обычным управлением |
| --- | --- | --- |
| `transformer-chain` | Специальная сетка **6 × 6**, HP **100/100**, авторский Rad-Scorpion **50/50**, урон **12**. Weak Battery `(0,0)`, заряд **5/5**; Step-up Transformer `(1,0)`; Laser Pistol `(2,0)`. Ничего не выбрано. Встреча создаётся через beginEncounter с явно заданными HP/уроном. | Выбрать Laser Pistol, навести курсор: `► Powered damage: 22`. `END TURN`: враг **28/50**, герой **88/100**, заряд **1/5**. Tooltip теперь `► Base damage: 4`, `! Insufficient charge for powered damage.` Следующий `END TURN`: враг **24/50**, герой **76/100**, заряд остаётся **1/5**. |
| `combat-heal` | Обычная сетка **4 × 4**, HP **60/100**, Rad-Scorpion **24/24**, урон **8**. Heavy Battery `(0,0)`, заряд **12/12**; Laser Pistol `(2,0)`; Weak Battery `(0,2)`, заряд **5/5**; Makeshift Vest `(1,2)`; Medkit `(0,1)`. Оружие и броня выбраны. Подготовка — явный электрический набор по definitionId (отдельно от нового физического старта), затем HP 60 и beginEncounter со scorpion. | `HEAL +25 (1)`: один Medkit израсходован, HP **85/100**, враг остаётся **24/24**, один ход. Его ответ **8** блокирует щит **8**; Weak Battery **4/5**, Heavy Battery **12/12**. `HEAL +25 (0)` недоступна; повторный клик не меняет состояние. |

Drag снимает выбор и извлекает предмет из сети: исчезновение усиления ожидаемо. До завершения переноса атака и лечение заблокированы. R вращает предмет; отказ у края GROUND, blur и resize восстанавливают исходное положение/ориентацию. После возврата оружие нужно выбрать заново. Обычный индикатор оборудования показывает план атаки; HEAL строит отдельный план только брони. Лечение тратит ход, а смертельный выстрел не отменяет ответ врага.

`npm run test:scenarios` проверяет обе пары renderer/ID с настоящим Chrome и повторным запуском, исходный состав/координаты/выбор/заряд/HP/бой, обычный ввод, отмену с R, край панели, blur, compact/resize, нехватку заряда и отказ HEAL. Полный HP в бою проверяется отдельно управляемой фикстурой: один Medkit не позволяет достичь этой границы обычными действиями сценария. Набор также проверяет закрытие вкладки при незавершённом callback, двойной stop, занятый порт, отсутствие Chrome, startup timeout, ошибку с JSON/PNG и SIGINT; профиль удаляется, порт освобождается. Детальные assertions механик остаются в core и существующих UI-наборах; полные маршруты seed 123 не повторяются.

## Ручной чек-лист

После изменения подготовить по-русски действия и ожидаемые результаты с точными английскими надписями. Первые пункты проверяют изменённое поведение, затем связанные регрессии. Для большого изменения отделить обязательный короткий список от дополнительного полного забега.

Обычный пользователь должен получить нужное состояние игровым управлением, без консоли и подмены ресурсов. Указать маршрут/исходную расстановку, если иначе сценарий неочевиден. Недоступные сектора/боссы не включать: для следующих ступеней вместимости есть core-проверки.

Для механики покрыть успех, границу ресурсов/доступности, отказ/отмену и сохранение состояния. Для UI — drag, R, края панелей, компактный вид, resize, blur, когда они затронуты. Ожидаемые особенности объяснять: снятие выбора при drag; исчезновение молнии после разрыва цепи; стоимость лечения; ответ врага после смертельного выстрела.

Результаты автоматических команд записывать отдельно: команда, дата, успех/сбой, существенные ограничения и артефакты. Ручная приёмка остаётся «ожидается» до ответа пользователя; фиксировать только подтверждённые пункты. [Формат задачи](tasks/README.md).


## Вариативные чертежи

В test:core включён [blueprints.test.mjs](../tests/core/blueprints.test.mjs): пулы и совместимость, 1000 seed, связанные тройки/повторы, независимый RNG, закрытие и устаревшие команды, отложенный выбор/поражение, знания/копии, свойства боя и HEAL, скидки путей/циклы/настройка батарей/дробные остатки. Оба core-маршрута seed 123 получают рецепты через оба тайника обычными командами, используют Arc Baton и заработанные ресурсы; результат: HP 24, 7 боёв, 50 шагов на авторской карте / 66 на generated, 2 лечения, рюкзак 5×4, повторно изготовленный Arc Baton.

В test:crafting включён [blueprint-checks](../tests/blueprint-checks.mjs): настоящий E/CLOSE/Escape/LEARN, блокировки и повторы, Canvas/WebGL, четыре viewport, resize/blur, страницы/изготовление, отказ переноса и сохранение варианта. Снимки — artifacts/blueprints. Старые цепи и лечение подготовлены явными электрическими предметами; смена старта не меняет их назначение.

Регрессия tooltip (18.11.2026) в том же blueprint-checks: настоящий hover изготовленного Arc Baton на BENCH (9 подписей), перенос без питания (10 с предупреждением), переход к Dagger и Weak Battery, очистка шкалы заряда, повторное использование пула и последующий клик/drag. Runtime.exceptionThrown собирается браузерным runner: исключение в Phaser Clock считается отказом набора.


## Процедурные сектора

В test:core включён [sectors.test.mjs](../tests/core/sectors.test.mjs): 1000 seed каждого сектора плюс 0x7fffffff/0x80000000/0xffffffff, повторяемость, разнообразие стен/расстановок, 9/11 стен, связность всего пола, свободные соседние старту клетки, прежний состав и награды, отсутствие наложений и безопасный старт по той же метрике обнаружения. Отдельно проверяются загрузка всех позиций в RunState, повторная загрузка, независимость от world RNG/посещений тайников/первого маршрута, атомарный отказ неизвестного сектора и независимость предложений от координат.

[sector-fixtures](../tests/sector-fixtures.mjs) содержит прежние авторские карты и адаптер только тестового экземпляра RunState. Старые проверки явных координат используют freshAuthoredRun; freshRun и production всегда начинают обычный generated-забег. Фикстуры переиспользуют текущие награды и параметры врагов, не создавая вторую таблицу баланса. Полные core-маршруты на обеих картах проверяются отдельно; ни один из них не повторяется в браузере.

В test:exploration включён [sector-checks](../tests/sector-checks.mjs): обычный generated seed 123, повторяемость и seed 124, видимые позиции/hover, настоящий клик и клавиши, граничный отказ, бой с END TURN, E/CLOSE/Escape/LEARN, SEARCH/TAKE, переход в WORKSHOP и CONTINUE с сохранением HP/предметов/заряда/знаний, одноразовая First Aid Station. В этом сценарии нет телепортаций, удаления врагов или выдачи ресурсов. Дополнительно проверяются четыре viewport, B, drag/R, отказ у края GROUND, resize и blur. Оба renderer; снимки в artifacts/sectors. Полный check включает новый файл через существующие core/exploration команды и CI без нового задания.


## Контроль отчёта core и harness

Команды test:core и test:harness запускают свои явно перечисленные файлы один раз с reporter spec и дополнительным [core-report](../scripts/core-report.mjs) в stderr. Общий reporter сохраняет прежний префикс [core-report] в обоих наборах. Контроль использует структурированные [события test:summary Node 24](https://nodejs.org/download/release/v24.15.0/docs/api/test.html#event-testsummary): отдельный внутренний итог каждого выбранного файла и окончательный итог запуска. Имена сценариев, положение в source/helper и текстовый формат spec не используются для решения об успехе. Сейчас core содержит 101 сценарий в 7 файлах, harness — 49 в 4; это наблюдаемый результат, а не константы валидатора.

Для каждого файла нужен хотя бы один завершённый обычный сценарий: counts.tests уже исключает suites; skipped, TODO и cancelled дополнительно исключаются. Пустой файл, пустая suite, пропуски без обычного теста, отсутствующий/невалидный внутренний итог или незавершённый общий отчёт дают exit 1. Штатный неуспех Node сохраняется вместе с исходной диагностикой, успешные ожидаемые TODO не превращаются в обычные failures при наличии выполненного сценария. Перечень ожидаемых файлов берётся из разобранных Node CLI-аргументов, отдельного дублирующего списка нет.

При успехе выводится `[core-report] Verified N executed scenarios across F files.` При отказе сообщение `[core-report] FAIL` объясняет причину и указывает файл. Читаемый файловый pass сам по себе не заменяет этот контроль; полный check останавливается на ненулевом результате любого из двух наборов, следующие шаги не выполняются. CI получает это поведение через существующие npm-команды без изменения workflow. Core по-прежнему не требует Chrome, порта или doctor; harness не требует Chrome, но проверяет локальные порты и дочерние процессы.

[core-report.test.mjs](../tests/core-report.test.mjs) входит в test:harness: проверяет полные/обрезанные отчёты, отсутствие итогов отдельного файла, правдоподобные имена без подтверждения выполнения, suites/skip/TODO/cancelled, штатные ошибки и невалидные итоги. Настоящие CLI-фикстуры проверяют spec + reporter, tsx/ESM, регистрацию через helper, отрицательную пустую фикстуру отдельно и рядом с нормальным файлом, сохранение assertion/import/timeout diagnostics и остановку агрегатора на настоящем отказе reporter в test:core и test:harness. Точная npm-команда test:harness дополнительно запускается в изолированном проекте: каждый выбранный файл регистрирует сценарий; затем средний файл становится пустым, а файлы до и после него остаются рабочими. Положительный запуск проходит, неполный отчёт отклоняется с именем пустого файла. Временные фикстуры удаляются; постоянной опции намеренной ошибки нет.

Для ручной проверки отрицательного результата используется только тестовая [пустая фикстура](../tests/fixtures/core-empty.mjs), которая штатным Node считается прошедшим файлом:

```bash
node --test --test-reporter=./scripts/core-report.mjs tests/fixtures/core-empty.mjs
```

Ожидается exit 1 и `[core-report] FAIL tests/fixtures/core-empty.mjs: no internal node:test summary…`. Ту же фикстуру можно добавить к настоящему harness без правки рабочих файлов:

```bash
npm run test:harness -- tests/fixtures/core-empty.mjs
```

Ожидается exit 1 с именем пустой фикстуры, несмотря на успешные обычные сценарии. Обычные `npm run test:core` и `npm run test:harness` в полноценной среде завершаются с exit 0, именами сценариев и строкой Verified. Это ручная проверка CLI harness; перепрохождение игры не требуется.

## Общий таймаут harness

[run-harness](../scripts/run-harness.mjs) оборачивает test:harness: список файлов остаётся единственным в package.json, оба reporter и индивидуальный --test-timeout=15000 сохраняются. Дополнительные файлы передаются обычными npm-аргументами. Общий лимит по умолчанию 60 000 мс, CLI --timeout-ms принимает целые значения 1…2147483647; неверный ввод даёт exit 2 до запуска тестов. Внешний runner имеет собственный event loop, поэтому зависание worker не блокирует его таймер.

Первый результат сохраняется: таймаут → 124, SIGINT → 130, SIGTERM → 143, гибель дочернего runner от SIGKILL → 137; обычные коды и diagnostics тестов не подменяются. При таймауте/сигнале выводятся причина и затем [test:harness] Cleanup complete. Cleanup выполняется и при обычном завершении, чтобы не оставлять отделённых потомков. Ошибка cleanup получает явную диагностику и превращает успешный итог в отказ; более ранний отказ сохраняется.

Поддержан Linux проекта/CI с доступными stat/environ в /proc; другая платформа получает явный отказ до запуска. Supervisor создаёт отдельную группу Node runner и передаёт только детям уникальную метку SCRAPPACK_HARNESS_OWNERS. Список меток сохраняет владение вложенных запусков. По метке находятся живые потомки после setsid/осиротения; перед сигналом проверяются starttime и PGID, включая повторное чтение stat вокруг environ. Группа supervisor исключена. TERM (при Ctrl+C — INT) сменяется KILL; оба окна ограничены секундой. Обнаружение продолжается при завершении, повторный пустой снимок исключает гонку fork/exit между обходами. Индивидуальный spawnCaptured/stopOwnedProcess не меняется. Поиск по порту/имени и вывод содержимого окружения не используются. Процессы, намеренно удалившие метку или сделавшие environ недоступным, не входят в гарантию; ограничения sandbox этот механизм не снимает.

[harness-timeout.test.mjs](../tests/harness-timeout.test.mjs) проверяет валидатор и реальный отказ CLI, diagnostics assertion, общий deadline, отдельно сгруппированного потомка с игнорированием TERM, смерть лидера, сохранение постороннего процесса, INT/TERM, SIGKILL runner, нормальный выход с оставленным потомком и новой группой в обработчике TERM, вложенный запуск и остановку check с настоящим exit 124 до build. Готовность потомков подтверждается их выводом; завершение — состоянием PID, а не одной паузой. Фикстуры и процессы удаляются после проверки.

Ручной отрицательный запуск использует только тестовую [намеренно зависающую фикстуру](../tests/fixtures/harness-hang.mjs):

```bash
node scripts/run-harness.mjs --timeout-ms 2000 tests/fixtures/harness-hang.mjs
```

После HANG READY ожидаются Timed out after 2000 ms, Cleanup complete и exit 124 без Ctrl+C. Для проверки отмены задать --timeout-ms 30000, дождаться HANG READY и нажать Ctrl+C: ожидается exit 130 с Interrupted и Cleanup complete. Обычный npm run test:harness после этого снова проходит с Verified 49 executed scenarios across 4 files. Фикстуру не следует запускать напрямую через Node без внешнего runner.
