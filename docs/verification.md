# Проверки и ручная приёмка

## Окружение и команды

Установка описана в [README](../README.md). `npm run check` последовательно выполняет doctor, check:docs, test:core, test:harness, build, test:combat-ui, test:exploration, test:crafting. Отдельный test:visual не повторяется: входит в боевой набор. Не запускать игровые наборы параллельно: общий порт 4175.

В процессе работы выбирать затронутые наборы. Полный check нужен перед ручной приёмкой изменения игрового кода и при изменении самого harness. После записи подтверждения пользователя достаточно check:docs, если код не менялся.

| Изменение | Целевые проверки |
| --- | --- |
| Энергия, батареи, трансформаторы, атака/броня | Сначала test:core, затем test:combat-ui |
| Вращение, drag, tooltip, рамки/молния, текстуры | test:combat-ui; test:visual для быстрой итерации |
| Движение, AI, RNG, контакты, переходы | Сначала test:core, затем test:exploration |
| Сырьё, компоненты, рецепты, лечение, награды | Сначала test:core, затем test:crafting |
| Владение предметами, режимы RunState, общие блокировки | test:core и затронутые UI-наборы, при сомнении полный check |
| Только документы/приёмка | check:docs |
| Диагностика/runner/валидатор | test:harness и полный check |
| CI workflow/окружение | actionlint, чистые npm ci/check, GitHub success и контролируемый failure с JSON/PNG |

## GitHub Actions

[CI](../.github/workflows/ci.yml) содержит два независимых задания на `ubuntu-24.04`, Node берётся из `.nvmrc`. В каждом свой checkout и `npm ci`; npm cache хранит загрузки по lockfile. `Core, harness and build` исполняет check:docs → test:core → test:harness → build без установки Chrome и вызова doctor. `Browser UI (WebGL and Canvas)` устанавливает библиотеки Ubuntu и Chrome for Testing **157.0.8103.78** linux64, экспортирует `CHROME_BIN`, затем исполняет doctor → test:combat-ui → test:exploration → test:crafting. Это последовательные команды на одном runner; seed 123 остаётся только в core, отдельного test:visual/check в CI нет.

Триггеры: pull_request, push в main, workflow_dispatch. Устаревшие запуски отменяются в пределах события и ветки/номера PR; разные PR не смешиваются. Права — только contents: read; checkout не сохраняет credentials. Actions закреплены SHA официальных релизов [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0), [upload-artifact v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2). Реальные Node/npm/Chrome версии видны в логах. Код возврата каждой команды сохраняется; после ошибки последующие обычные шаги пропускаются. Пределы jobs: 15 минут для правил, 25 для браузера; установка и каждый browser-набор ограничены пятью минутами, upload — тремя. Внутренний предел browser runner — 240 секунд с ограниченной диагностикой/очисткой, что оставляет время до остановки шага.

`Upload browser diagnostics` выполняется после успеха или ошибки, пока job не отменён. Он загружает `artifacts/` под уникальным именем `diagnostics-browser-<run_id>-<attempt>` на семь дней. При раннем сбое отсутствие файлов даёт warning и сохраняет первоначальный failure; установка/doctor диагностируются по логам шагов. После принудительной остановки всего job загрузка не гарантируется. Скриншот возможен, когда Chrome и страница доступны.

Для обновления Chrome выбрать доступный Stable linux64 в [официальной таблице CfT](https://googlechromelabs.github.io/chrome-for-testing/) или её [JSON](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json), заменить только `CHROME_VERSION` в workflow и актуализировать эту запись. URL содержит полную версию, не latest; установка проверяет вывод браузера. Проверить `deb.deps` из архива и имена библиотек целевой Ubuntu. При обновлении Actions сверить tag → полный commit SHA и входы action.yml с официальным репозиторием. До публикации выполнить `actionlint .github/workflows/ci.yml` (локально проверено 1.7.12), чистые npm ci/check, затем на GitHub подтвердить оба задания и диагностику контролируемой ошибки. Зависимости проекта ради валидатора не меняются.

Контролируемый отказ: только во временной копии/проверочной ветке испортить ожидание существующего browser-check после загрузки страницы, запустить соответствующий набор и проверить exit 1, имя проверки, свежие `failure.json` и `failure.png`. Затем вернуть исходное ожидание и подтвердить исправление. Ошибка запуска Chrome проверяет раннюю диагностику, но не подтверждает screenshot. На GitHub повторить это отдельным PR/проверочной веткой, скачать артефакт и вернуть зелёный запуск; не добавлять постоянный режим намеренной ошибки. Локальные результаты и GitHub-hosted прогоны записаны отдельно [в принятой задаче CI](tasks/done/2026-11-17-ci-checks.md).

## Что уже проверяется

Runner [combat-ui.mjs](../tests/combat-ui.mjs) запускает настоящий Vite и Chrome через CDP. Во всех игровых наборах исполняются Canvas и WebGL. `test:core` отдельно запускает реальные `.ts`-модули core через tsx в Node 24 со стандартными `node:test`/`node:assert/strict`: пять явно перечисленных `.test.mjs` файлов, таймаут 15 с на тест. Набор не вызывает doctor, не загружает Phaser/UI, не запускает Chrome/Vite и не открывает портов. Некорректный CHROME_BIN и занятый 4175 не препятствуют проверке правил. tsx не проверяет типы; `build` по-прежнему выполняет `tsc && vite build`. Production test hooks не вводятся; временные фикстуры размещаются тестом.

Полный маршрут [full-run.mjs](../tests/core/scenarios/full-run.mjs) использует RunState/ExplorationEngine с seed 123 и допустимые команды без телепортаций/добавления ресурсов. Это core-сценарий, не полный проход мышью. Его вызывает только [run.test.mjs](../tests/core/run.test.mjs), один раз за test:core и полный check; UI отдельно проверяется настоящим вводом.

Текущий результат этого маршрута: два сектора, семь боёв, 52 перемещения, две боевые аптечки, 76 HP, рюкзак 5 × 4, Heavy Battery из компонентов в заключительной мастерской. Числа — ориентир текущего прототипа, не замена проверок поведения. Баланс и удобство оценивает пользователь.

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
| Два сектора, размеры, достижимость | `both sectors have authored dimensions and reachable exits and loot` |
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
| Старт, аптечка, лимит, семь рецептов и сырьевая добыча | `starting medkit, empty materials, recipe catalog and raw loot definitions` |
| Частичный подбор/остаток, лимит, выбрасывание, запрет боевых переносов | `partial material pickup retains remainder; limits and rejected combat transfers are atomic` |
| Все семь цен/выходов, точное списание, отказ/атомарность, стабильный ID компонентов | `all recipes debit exact costs and inventory components in stable ID order` |
| Полный рюкзак, стол, неизвестный рецепт, оставленные предметы и переход | `full backpack crafts onto bench and continuation discards leftover output` |
| Полное HP, владение аптечкой, ограничение лечения, исследование/мастерская | `medkits enforce HP and ownership limits in exploration and workshop` |
| Лечение вместо атаки, только энергия брони, отсутствие оружия, ответ врага | `combat healing replaces attack, charges only armor and needs no weapon` |
| Одноразовая медицинская точка, предел HP, ход/бесплатный отказ | `aid station caps healing, costs one turn and cannot be reused` |
| Параметры босса, закрытый выход, одновременная смерть | `live boss blocks exit; simultaneous defeat gives no reward or expansion` |
| Отдельный лечебный энергоплан, отказ частичной оплаты брони | `healing plans armor alone and preserves charge when armor is unaffordable` |
| Лечение до фазы контакта | `healing and aid station apply before monster contact` |
| Исключение создания результата и компонент на столе | `craft output construction failure is atomic; bench components are unavailable` |
| Оба инициатора победы над боссом, позиция/компоненты/расширение | `both boss encounter initiators preserve reward position and apply expansion once` |
| Общий маршрут crafting-run-scenario, ранее два набора × два renderer | [run.test.mjs](../tests/core/run.test.mjs): `seed 123 completes two sectors with earned resources and deterministic final state`; все внутренние проверки [маршрута](../tests/core/scenarios/full-run.mjs) и итог сохранены |

`check:docs` проверяет локальные цели Markdown-ссылок, размер AGENTS/status, поля/разделы/статусы и размещение задач, соответствие active-task. Фрагменты заголовков и смысловая актуальность текста автоматически не подтверждаются. Архив исторической спецификации исключён из проверки старых ссылок, но ссылка на сам архив должна работать.

## Диагностика и артефакты

Если sandbox ограничивает дочерние процессы, node:test может показывать только результаты файлов без имён внутренних тестов. Такой вывод нельзя записывать как подтверждение 77 сценариев: повторить в разрешённой среде с именами и проверить намеренно неверное ожидание во временной копии. Это ограничение среды отдельно от зависимости набора от браузера или порта.

Doctor проверяет Node 24.x, соответствие прямых установленных зависимостей lockfile, Chrome (`CHROME_BIN` либо google-chrome), возможность слушать 127.0.0.1:4175. Для EPERM/EACCES проверить ограничения sandbox; для EADDRINUSE освободить порт обычным завершением его владельца. Doctor сам ничего не устанавливает и не завершает.

Runner ограничивает startup, каждую CDP-команду, общую длительность и cleanup. Сбой сообщает renderer и текущую проверку/группу. JSON и доступный screenshot сохраняются в уникальный каталог `artifacts/harness/`; ошибка screenshot также записывается, исходный сбой не теряется. Временный профиль и только собственные процессы очищаются.

При ожидании готовности Vite ANSI-коды удаляются только из строки для сопоставления адреса: цветной вывод CI может вставлять их между хостом и портом. Исходный stdout остаётся в диагностике. Это покрыто отдельным harness-тестом с реальным дочерним процессом.

Обычные снимки: `artifacts/crafting/`, `artifacts/exploration/`, `artifacts/ui-feedback/`. Снимки визуального прототипа: `SCRAPPACK_VISUAL_CAPTURE=after npm run test:combat-ui`, каталог `artifacts/visual-prototype/after/`. Эти каталоги не коммитятся.

## Ручной чек-лист

После изменения подготовить по-русски действия и ожидаемые результаты с точными английскими надписями. Первые пункты проверяют изменённое поведение, затем связанные регрессии. Для большого изменения отделить обязательный короткий список от дополнительного полного забега.

Обычный пользователь должен получить нужное состояние игровым управлением, без консоли и подмены ресурсов. Указать маршрут/исходную расстановку, если иначе сценарий неочевиден. Недоступные сектора/боссы не включать: для следующих ступеней вместимости есть core-проверки.

Для механики покрыть успех, границу ресурсов/доступности, отказ/отмену и сохранение состояния. Для UI — drag, R, края панелей, компактный вид, resize, blur, когда они затронуты. Ожидаемые особенности объяснять: снятие выбора при drag; исчезновение молнии после разрыва цепи; стоимость лечения; ответ врага после смертельного выстрела.

Результаты автоматических команд записывать отдельно: команда, дата, успех/сбой, существенные ограничения и артефакты. Ручная приёмка остаётся «ожидается» до ответа пользователя; фиксировать только подтверждённые пункты. [Формат задачи](tasks/README.md).
