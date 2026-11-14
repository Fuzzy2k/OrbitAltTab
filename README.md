# OrbitAltTab — v0.7.0

Cover Flow-inspired Alt+Tab window switcher for **GNOME Shell 51** (tested on 51.1 / Wayland).

## Features / Возможности

- Smooth 3D Cover Flow previews with side stacks and adjustable spacing, angle, scale and animation duration. / Плавные 3D-миниатюры Cover Flow, боковые стопки и настройка геометрии и анимаций.
- Optional reflections, icon/title display, caption background and icon placement. / Отражения, иконки, подписи и их оформление.
- Flat mode, compact mode and Blur my Shell compatibility option. / Плоский и компактный режимы, опция совместимости с Blur my Shell.
- Preferences in Russian and English based on system language. / Настройки на русском и английском языках.
- Switching across workspaces and monitors. / Переключение между рабочими столами и мониторами.

## Install / Установка

Extract the ZIP so that `OrbitAltTab@fuzzy2k` is inside `~/.local/share/gnome-shell/extensions/`.

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
unzip -o OrbitAltTab-fuzzy2k-v0.7.0.zip -d ~/.local/share/gnome-shell/extensions/
EXT="$HOME/.local/share/gnome-shell/extensions/OrbitAltTab@fuzzy2k"
glib-compile-schemas --strict "$EXT/schemas"
```

On Wayland, log out and log in again, then run:

```bash
gnome-extensions enable OrbitAltTab@fuzzy2k
gnome-extensions prefs OrbitAltTab@fuzzy2k
```

To disable / Отключение:

```bash
gnome-extensions disable OrbitAltTab@fuzzy2k
```

## Keyboard / Клавиши

- Alt+Tab or Super+Tab: next window / следующее окно
- Alt+Shift+Tab or Super+Shift+Tab: previous window / предыдущее окно
- Arrow keys: change selection / изменить выбор
- Enter or Space: activate / активировать
- Escape: cancel / отмена

## Testing / Тестирование

Tested by the project maintainer on GNOME Shell 51.1 Wayland: dual monitors, multiple workspaces, Blur my Shell enabled/disabled, 10–20 windows, repeated enable/disable, RU/EN preferences. GNOME Shell 51 is the declared target; other GNOME versions have not been verified.

## License / Лицензия

Licensed under **GNU General Public License v3.0 or later (GPL-3.0-or-later)**. See [LICENSE](LICENSE). / Лицензия **GPL-3.0-or-later**; полный текст в файле [LICENSE](LICENSE).

Repository: https://github.com/fuzzy2k/OrbitAltTab

## Release / Публикация

Release tag: `v0.7.0`. The ZIP contains a single top-level directory `OrbitAltTab@fuzzy2k/`. For extensions.gnome.org, follow its upload and review requirements separately; this ZIP is intended for GitHub/manual installation. / Для extensions.gnome.org требуется отдельная проверка и упаковка по правилам сайта.

## Screenshot / Скриншот

![OrbitAltTab running in GNOME Shell](Screenshot%202026-11-15%2001-19-48.png)
